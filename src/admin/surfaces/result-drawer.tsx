import { useState } from 'react'
import type { EnteredOutcome, Match, MatchScore } from '../../../shared'
import {
  RESULT_SCORE_ERROR_MESSAGE,
  checkNormalScore,
  legalMtb,
  legalSet,
  resultScoreError,
  winningSlot
} from '../../../shared'
import { Button } from '@/admin/ui/button'
import { Label } from '@/admin/ui/label'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/admin/ui/drawer'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/admin/ui/alert-dialog'
import { changedSets, offersPartialSave, type SetWrite } from './result-save'
import { type Pair, ScoreRow } from './result-score-row'

// The result-entry drawer (ADR-0032/0045, issue #90): a bottom sheet (phone-first) where the operator picks
// the outcome (a normal scored result, a Walkover, or a Retirement) and the two-set + Match-Tie-
// Break score. For a **normal** result the winner is *derived from the score* (`2:0` → that player, `1:1` →
// the MTB winner) and shown read-only — no separate Sieger tap, and it can never contradict the score. Only
// a Walkover (no score) or Retirement (the leader may retire) needs an explicit Sieger. The score is
// hard-validated against the closed legal space (ADR-0045): Save is disabled with an inline reason and the
// offending row is flagged until the result is legal and decisive — it is never silently greyed. Correcting
// a finished match's **winner** warns first (it cascade-clears dependent downstream results, ADR-0026).
//
// The drawer has a **second** save path (ADR-0032, Amendment 2026-08-20): while a match is `running` and its
// score is legal but not yet decisive, the button that used to sit disabled becomes „Zwischenstand speichern"
// and posts each changed set to /api/admin/match/set — the operator's interim score, which the public
// surfaces print in their score column beside the „läuft" badge. It never resolves the match and never moves
// its status. Which path a given drawer state takes lives in result-save.ts.

// The result the drawer hands back: the winning slot, the outcome (null ⇒ a normal scored result), and the
// fixed best-of-2 + MTB score. The caller posts it to /api/admin/match/result. It lives with the drawer
// rather than with either surface, because both surfaces now open this drawer (ADR-0080).
export interface ResultPayload {
  winner: 1 | 2
  outcome: EnteredOutcome | null
  score: MatchScore
}

// The match the drawer needs: the match itself, and the two things its header says. Narrower than either
// caller's row on purpose — Ergebnisse's `ResultMatch` and the Spielplan's `GridMatch` both satisfy it
// structurally, which is how one drawer serves two doors (ADR-0080 rule 1) without the grid having to
// build a results row or the drawer knowing which surface opened it. The slot *names* are not part of it:
// the drawer resolves them from the match's own regIds through `nameById`, which both surfaces hold.
export interface DrawerMatch {
  match: Match
  number: number
  roundLabel: string
}

interface ResultDrawerProps {
  editing: DrawerMatch | null
  nameById: Map<number, string>
  onClose: () => void
  // Resolves to whether the result persisted — the parent closes the drawer only on success.
  onSubmit: (id: number, payload: ResultPayload) => Promise<boolean>
  // Save an interim score: one /api/admin/match/set call per changed set. Resolves like onSubmit.
  onSaveSets: (id: number, writes: SetWrite[]) => Promise<boolean>
}

export const ResultDrawer = ({ editing, nameById, onClose, onSubmit, onSaveSets }: ResultDrawerProps) => (
  <Drawer open={editing !== null} onOpenChange={open => !open && onClose()}>
    <DrawerContent>
      {/* Keyed on the match so the form re-seeds from each match's own state on open. */}
      {editing && (
        <ResultForm
          key={editing.match.id}
          match={editing}
          nameById={nameById}
          onSubmit={onSubmit}
          onSaveSets={onSaveSets}
        />
      )}
    </DrawerContent>
  </Drawer>
)

type OutcomeChoice = 'normal' | EnteredOutcome
const OUTCOME_LABELS: Record<OutcomeChoice, string> = {
  normal: 'Normal',
  walkover: 'Walkover',
  retirement: 'Aufgabe'
}

const pairToStrings = (pair: readonly [number, number] | null): Pair =>
  pair ? [String(pair[0]), String(pair[1])] : ['', '']
// The set's winning slot from its two inputs: 0 when either is blank or it is a tie (no winner yet). Drives
// only the MTB row's visibility here; the authoritative winner comes from the shared score rules.
const winnerOf = ([a, b]: Pair): 0 | 1 | 2 => {
  if (a === '' || b === '') return 0
  const x = Number(a)
  const y = Number(b)
  return x > y ? 1 : y > x ? 2 : 0
}
const toScorePair = ([a, b]: Pair): [number, number] | null => (a !== '' && b !== '' ? [Number(a), Number(b)] : null)

interface ResultFormProps {
  match: DrawerMatch
  nameById: Map<number, string>
  onSubmit: (id: number, payload: ResultPayload) => Promise<boolean>
  onSaveSets: (id: number, writes: SetWrite[]) => Promise<boolean>
}
const ResultForm = ({ match: row, nameById, onSubmit, onSaveSets }: ResultFormProps) => {
  const { match, number, roundLabel } = row
  // Both slots are known by the time the drawer opens (the row only offers entry then), so the names resolve.
  const name1 = nameById.get(match.slot1RegId ?? -1) ?? 'Slot 1'
  const name2 = nameById.get(match.slot2RegId ?? -1) ?? 'Slot 2'

  // The previously-recorded winning slot, if any — what a winner change is measured against (the cascade
  // warn). One definition (CONTEXT: Bracket topology) rather than a locally-phrased guard.
  const prevWinner = winningSlot(match)

  // The explicit Sieger — used only for Walkover/Aufgabe, where the score cannot decide the winner. A normal
  // result derives its winner from the score instead (below).
  const [winner, setWinner] = useState<1 | 2 | null>(prevWinner)
  const [outcome, setOutcome] = useState<OutcomeChoice>(
    match.outcome === 'walkover' ? 'walkover' : match.outcome === 'retirement' ? 'retirement' : 'normal'
  )
  const [set1, setSet1] = useState<Pair>(pairToStrings(match.score.set1))
  const [set2, setSet2] = useState<Pair>(pairToStrings(match.score.set2))
  const [mtb, setMtb] = useState<Pair>(pairToStrings(match.score.mtb))
  // The winner-change confirm (cascade warning), held until the operator confirms or cancels.
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  // The Match-Tie-Break decides a 1:1 split — show its row only then, so the straight-sets case stays minimal.
  const showMtb =
    outcome !== 'walkover' && winnerOf(set1) !== 0 && winnerOf(set2) !== 0 && winnerOf(set1) !== winnerOf(set2)

  const score: MatchScore =
    outcome === 'walkover'
      ? { set1: null, set2: null, mtb: null }
      : { set1: toScorePair(set1), set2: toScorePair(set2), mtb: showMtb ? toScorePair(mtb) : null }

  // For a normal result the winner is a function of the (legal, decisive) score; for a special outcome it is
  // the operator's explicit pick. `normalCheck` is the same authority the server refines against (ADR-0045),
  // so the client's Save gate and the server's 400 never disagree. The read-only winner is shown only when
  // the score is legal *and* decisive, so an illegal (unsaveable) score never names a winner beside its red row.
  const normalCheck = outcome === 'normal' ? checkNormalScore(score) : null
  const derivedWinner: 1 | 2 | null = normalCheck?.ok ? normalCheck.winner : null
  const effectiveWinner: 1 | 2 | null = outcome === 'normal' ? derivedWinner : winner
  const canSave = outcome === 'normal' ? Boolean(normalCheck?.ok) : winner !== null

  // The second save path (ADR-0032, Amendment 2026-08-20): a running match whose score is legal but not yet
  // decisive saves a **Zwischenstand** instead — the changed sets, one /set call each. With nothing changed
  // there is nothing to save, so the button stays disabled and says so.
  const enteredOutcome = outcome === 'normal' ? null : outcome
  const partial = offersPartialSave(match.status, enteredOutcome, score)
  const setWrites: SetWrite[] = partial ? changedSets(match.score, score, showMtb) : []
  const canSavePartial = partial && setWrites.length > 0

  // Why Save is disabled — surfaced inline so the button is never mysteriously greyed (the reported bug). A
  // normal result's reason flows through the shared validator + message map (one owner, ADR-0045); a special
  // outcome only needs an explicit Sieger.
  const normalError = outcome === 'normal' ? resultScoreError(null, score, effectiveWinner ?? 1) : null
  const disabledReason: string | null = saving
    ? null
    : partial
      ? // The Zwischenstand path: saveable ⇒ nothing to explain; nothing changed ⇒ say that rather than
        // „der Sieger steht noch nicht fest", which is the point of this state, not an obstacle in it.
        canSavePartial
        ? null
        : 'Noch kein geänderter Satz.'
      : outcome === 'normal'
        ? normalError
          ? RESULT_SCORE_ERROR_MESSAGE[normalError]
          : null
        : winner === null
          ? 'Bitte Sieger wählen.'
          : null

  // A row is flagged only for a normal result (a retirement's score is legitimately partial), once both slots
  // are filled and the pair is not a legal set / MTB.
  const rowInvalid = (pair: Pair, kind: 'set' | 'mtb'): boolean => {
    if (outcome !== 'normal') return false
    const p = toScorePair(pair)
    if (p === null) return false
    return kind === 'set' ? !legalSet(p) : !legalMtb(p)
  }

  const isWinnerChange = prevWinner !== null && effectiveWinner !== null && effectiveWinner !== prevWinner

  const submit = async () => {
    if (effectiveWinner === null) return
    setSaving(true)
    try {
      await onSubmit(match.id, { winner: effectiveWinner, outcome: outcome === 'normal' ? null : outcome, score })
    } finally {
      setSaving(false)
      setConfirming(false)
    }
  }

  // Save the interim score: one call per changed set (at most three), no winner and no status move — the
  // match stays on court and keeps the actual court the operator gave it when starting it.
  const submitPartial = async () => {
    setSaving(true)
    try {
      await onSaveSets(match.id, setWrites)
    } finally {
      setSaving(false)
    }
  }

  const onSave = () => {
    if (canSavePartial) {
      void submitPartial()
      return
    }
    if (!canSave || effectiveWinner === null) return
    // Changing a recorded winner cascade-clears downstream results — warn first; everything else saves directly.
    if (isWinnerChange) setConfirming(true)
    else void submit()
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col">
      <DrawerHeader>
        <DrawerTitle>
          M{number} · {roundLabel}
        </DrawerTitle>
        <DrawerDescription>
          {name1} vs {name2}
        </DrawerDescription>
      </DrawerHeader>

      <div className="flex flex-col gap-5 px-4">
        {/* Outcome — the straight-sets default plus the two special outcomes. */}
        <div className="flex flex-col gap-2">
          <Label>Ergebnistyp</Label>
          <div className="flex gap-2">
            {(Object.keys(OUTCOME_LABELS) as OutcomeChoice[]).map(o => (
              <Button
                key={o}
                type="button"
                size="sm"
                variant={outcome === o ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setOutcome(o)}
              >
                {OUTCOME_LABELS[o]}
              </Button>
            ))}
          </div>
        </div>

        {/* Winner — explicit only for a Walkover/Retirement, where the score can't decide it. */}
        {outcome !== 'normal' && (
          <div className="flex flex-col gap-2">
            <Label>Sieger</Label>
            <div className="flex flex-col gap-2">
              {([1, 2] as const).map(slot => {
                const name = slot === 1 ? name1 : name2
                return (
                  <Button
                    key={slot}
                    type="button"
                    variant={winner === slot ? 'default' : 'outline'}
                    className="justify-start"
                    onClick={() => setWinner(slot)}
                  >
                    {name}
                  </Button>
                )
              })}
            </div>
          </div>
        )}

        {/* Score — hidden for a Walkover (winner advances „ohne Spiel"). */}
        {outcome !== 'walkover' && (
          <div className="flex flex-col gap-3">
            <ScoreRow
              label="Satz 1"
              name1={name1}
              name2={name2}
              value={set1}
              onChange={setSet1}
              invalid={rowInvalid(set1, 'set')}
            />
            <ScoreRow
              label="Satz 2"
              name1={name1}
              name2={name2}
              value={set2}
              onChange={setSet2}
              invalid={rowInvalid(set2, 'set')}
            />
            {showMtb && (
              <ScoreRow
                label="Match-Tie-Break"
                name1={name1}
                name2={name2}
                value={mtb}
                onChange={setMtb}
                invalid={rowInvalid(mtb, 'mtb')}
              />
            )}
          </div>
        )}

        {/* Normal — the derived winner, read-only, so it can never disagree with the score above. */}
        {outcome === 'normal' && (
          <div className="flex flex-col gap-1">
            <Label>Sieger</Label>
            <div className="rounded-md border px-3 py-2 text-sm">
              {derivedWinner === null ? (
                <span className="text-muted-foreground">Ergibt sich aus dem Ergebnis</span>
              ) : (
                <span className="font-medium">{derivedWinner === 1 ? name1 : name2}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <DrawerFooter>
        <Button onClick={onSave} disabled={(!canSave && !canSavePartial) || saving}>
          {partial
            ? 'Zwischenstand speichern'
            : match.status === 'done'
              ? 'Ergebnis korrigieren'
              : 'Ergebnis speichern'}
        </Button>
        {disabledReason && <p className="text-muted-foreground text-center text-xs">{disabledReason}</p>}
      </DrawerFooter>

      <AlertDialog open={confirming} onOpenChange={open => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sieger ändern?</AlertDialogTitle>
            <AlertDialogDescription>
              Der bisherige Sieger ist bereits in die nächste Runde aufgestiegen. Wenn du den Sieger änderst, werden
              davon abhängige Folge-Ergebnisse zurückgesetzt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit()}>Sieger ändern</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
