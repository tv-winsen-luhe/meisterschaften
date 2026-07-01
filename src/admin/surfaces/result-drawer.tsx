import { useState } from 'react'
import type { EnteredOutcome, MatchScore } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Button } from '@/admin/ui/button'
import { Input } from '@/admin/ui/input'
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
import type { ResultMatch, ResultPayload } from './results-surface'

// The result-entry drawer (ADR-0032, issue #90): a bottom sheet (phone-first) where the operator picks the
// winner, the outcome (a normal scored result, a Walkover, or a Retirement/Aufgabe), and the best-of-2 +
// Match-Tie-Break score — the MTB row appearing only when the two sets are split 1:1, so the common case
// stays minimal. Correcting a finished match's **winner** is never blocked but warns first (it cascade-
// clears dependent downstream results server-side, ADR-0026); a score-only correction saves straight away.

interface ResultDrawerProps {
  editing: ResultMatch | null
  nameById: Map<number, string>
  onClose: () => void
  // Resolves to whether the result persisted — the parent closes the drawer only on success.
  onSubmit: (id: number, payload: ResultPayload) => Promise<boolean>
}

export const ResultDrawer = ({ editing, nameById, onClose, onSubmit }: ResultDrawerProps) => (
  <Drawer open={editing !== null} onOpenChange={open => !open && onClose()}>
    <DrawerContent>
      {/* Keyed on the match so the form re-seeds from each match's own state on open. */}
      {editing && <ResultForm key={editing.match.id} match={editing} nameById={nameById} onSubmit={onSubmit} />}
    </DrawerContent>
  </Drawer>
)

type OutcomeChoice = 'normal' | EnteredOutcome
const OUTCOME_LABELS: Record<OutcomeChoice, string> = {
  normal: 'Normal',
  walkover: 'Walkover',
  retirement: 'Aufgabe'
}

// Two input strings for a set's two slots; '' when not entered.
type Pair = [string, string]
const pairToStrings = (pair: readonly [number, number] | null): Pair =>
  pair ? [String(pair[0]), String(pair[1])] : ['', '']
// The set's winning slot from its two inputs: 0 when either is blank or it is a tie (no winner yet).
const winnerOf = ([a, b]: Pair): 0 | 1 | 2 => {
  if (a === '' || b === '') return 0
  const x = Number(a)
  const y = Number(b)
  return x > y ? 1 : y > x ? 2 : 0
}
const toScorePair = ([a, b]: Pair): [number, number] | null => (a !== '' && b !== '' ? [Number(a), Number(b)] : null)

interface ResultFormProps {
  match: ResultMatch
  nameById: Map<number, string>
  onSubmit: (id: number, payload: ResultPayload) => Promise<boolean>
}
const ResultForm = ({ match: row, nameById, onSubmit }: ResultFormProps) => {
  const { match, number, roundLabel } = row
  // Both slots are known by the time the drawer opens (the row only offers entry then), so the names resolve.
  const name1 = nameById.get(match.slot1RegId ?? -1) ?? 'Slot 1'
  const name2 = nameById.get(match.slot2RegId ?? -1) ?? 'Slot 2'

  // The previously-recorded winning slot, if any — what a winner change is measured against (the cascade warn).
  const prevWinner: 1 | 2 | null =
    match.winnerRegId !== null && match.winnerRegId === match.slot1RegId
      ? 1
      : match.winnerRegId !== null && match.winnerRegId === match.slot2RegId
        ? 2
        : null

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

  const isWinnerChange = prevWinner !== null && winner !== null && winner !== prevWinner

  const buildScore = (): MatchScore =>
    outcome === 'walkover'
      ? { set1: null, set2: null, mtb: null }
      : { set1: toScorePair(set1), set2: toScorePair(set2), mtb: showMtb ? toScorePair(mtb) : null }

  const submit = async () => {
    if (winner === null) return
    setSaving(true)
    try {
      await onSubmit(match.id, { winner, outcome: outcome === 'normal' ? null : outcome, score: buildScore() })
    } finally {
      setSaving(false)
      setConfirming(false)
    }
  }

  const onSave = () => {
    if (winner === null) return
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

        {/* Winner — required; for a Walkover/Retirement it is the only thing entered. */}
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

        {/* Score — hidden for a Walkover (winner advances „ohne Spiel"). */}
        {outcome !== 'walkover' && (
          <div className="flex flex-col gap-3">
            <ScoreRow label="Satz 1" name1={name1} name2={name2} value={set1} onChange={setSet1} />
            <ScoreRow label="Satz 2" name1={name1} name2={name2} value={set2} onChange={setSet2} />
            {showMtb && <ScoreRow label="Match-Tie-Break" name1={name1} name2={name2} value={mtb} onChange={setMtb} />}
          </div>
        )}
      </div>

      <DrawerFooter>
        <Button onClick={onSave} disabled={winner === null || saving}>
          {match.status === 'done' ? 'Ergebnis korrigieren' : 'Ergebnis speichern'}
        </Button>
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

// One set's two score inputs: the two slots' games (or, for the MTB, points), with the player names above.
interface ScoreRowProps {
  label: string
  name1: string
  name2: string
  value: Pair
  onChange: (next: Pair) => void
}
const ScoreRow = ({ label, name1, name2, value, onChange }: ScoreRowProps) => (
  <div className="flex flex-col gap-1">
    <span className="text-muted-foreground text-xs font-medium">{label}</span>
    <div className="flex items-center gap-2">
      <ScoreInput aria-label={`${label} — ${name1}`} value={value[0]} onChange={v => onChange([v, value[1]])} />
      <span className="text-muted-foreground">:</span>
      <ScoreInput aria-label={`${label} — ${name2}`} value={value[1]} onChange={v => onChange([value[0], v])} />
    </div>
  </div>
)

interface ScoreInputProps {
  value: string
  onChange: (value: string) => void
  'aria-label': string
}
const ScoreInput = ({ value, onChange, ...rest }: ScoreInputProps) => (
  <Input
    {...rest}
    type="number"
    inputMode="numeric"
    min={0}
    max={99}
    value={value}
    onChange={e => onChange(e.target.value)}
    className={cn('w-16 text-center tabular-nums')}
  />
)
