import { useMemo, useState } from 'react'
import { Trophy } from 'lucide-react'
import {
  type AdminRegistration,
  bracketDepth,
  type CompetitionDraw,
  type CompetitionSlug,
  COURT_NUMBERS,
  type EnteredOutcome,
  isFullyRevealed,
  type Match,
  type MatchScore,
  type MatchStatus,
  resolveBracket,
  roundLabel,
  slotGames,
  slotLabel,
  type SlotView
} from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Button } from '@/admin/ui/button'
import { Badge } from '@/admin/ui/badge'
import { NativeSelect } from '@/admin/ui/native-select'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { competitionLabel } from './registration-detail'
import { ResultDrawer } from './result-drawer'

// The Ergebnisse surface (UI: „Ergebnisse", ADR-0032, issue #90): the operator's result workbench. It is
// phone-first — one operator at the desk (ADR-0001) — so it reads as a round-grouped list, not a wide
// bracket tree: per competition, every real match (a bye is auto-resolved, never played) with its two
// players (or „Sieger M{n}" / „Verlierer M{n}" feeders until they resolve), its status, court, and score.
// Entering a result advances the winner into the next round and routes a semifinal loser to the third-place
// playoff (the pure transform server-side), so the list itself *is* the per-competition bracket filling in.

// The result the drawer hands back: the winning slot, the outcome (null ⇒ a normal scored result), and the
// fixed best-of-2 + MTB score. The shell posts it to /api/admin/match/result.
export interface ResultPayload {
  winner: 1 | 2
  outcome: EnteredOutcome | null
  score: MatchScore
}

interface ResultsSurfaceProps {
  registrations: AdminRegistration[]
  draws: CompetitionDraw[]
  // Record (or correct) a completed result — the winner advances, a semifinal loser drops to the third-place
  // playoff, a winner change cascade-clears downstream. Resolves to whether it persisted (the drawer closes
  // only on success). Mark a match läuft / beendet, capturing the actual court. Both via the shell's mutate.
  onRecordResult: (id: number, payload: ResultPayload) => Promise<boolean>
  onSetStatus: (id: number, status: MatchStatus, liveCourt?: number) => Promise<boolean>
}

// One match resolved for the list: the wire row plus its display number and two slot views (player names
// joined here, feeders/byes labelled by the shared copy). Both players known ⇒ a result can be entered.
export interface ResultMatch {
  match: Match
  number: number
  roundLabel: string
  slot1: SlotView
  slot2: SlotView
}

const STATUS_LABEL: Record<MatchStatus, string> = { planned: 'geplant', running: 'läuft', done: 'beendet' }

// One bracket's real matches, resolved + numbered over its whole set (so „Sieger M{n}" is stable) and
// grouped by round label in match order — the third-place playoff sorts after the final (it shares the
// final's round but a higher position). Runs per bracket, so the consolation labels read „Nebenrunde · …"
// off its own depth; the caller concatenates a competition's brackets (main first, then consolation).
const matchGroups = (draw: CompetitionDraw): [string, ResultMatch[]][] => {
  const totalRounds = bracketDepth(draw.matches)
  const rows: ResultMatch[] = []
  for (const { match, number, slot1, slot2 } of resolveBracket(draw.matches)) {
    if (match.outcome === 'bye') continue // a bye is never played, so it is never a result row
    rows.push({
      match,
      number,
      roundLabel: roundLabel({ bracket: draw.bracket, round: match.round, totalRounds, thirdPlace: match.thirdPlace }),
      slot1,
      slot2
    })
  }
  const byLabel = new Map<string, ResultMatch[]>()
  for (const r of [...rows].sort((a, b) => a.match.round - b.match.round || a.match.position - b.match.position)) {
    const list = byLabel.get(r.roundLabel) ?? []
    list.push(r)
    byLabel.set(r.roundLabel, list)
  }
  return [...byLabel.entries()]
}

export const ResultsSurface = ({ registrations, draws, onRecordResult, onSetStatus }: ResultsSurfaceProps) => {
  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const r of registrations) map.set(r.id, `${r.firstName} ${r.lastName}`.trim())
    return map
  }, [registrations])

  // Only fully-revealed main brackets carry results (a draw still being revealed must not show its pairings
  // here — the same suspense discipline the competitions surface keeps, ADR-0036). The consolation bracket
  // has no reveal show, so it would appear once it exists (#92).
  const fields = useMemo(() => draws.filter(d => d.bracket === 'main' && isFullyRevealed(d)), [draws])

  const [active, setActive] = useState<CompetitionSlug | null>(null)
  // The match whose result drawer is open (null ⇒ closed).
  const [editing, setEditing] = useState<ResultMatch | null>(null)

  // The selected field, defaulting to the first one — held as a fallback so a freshly-drawn field shows
  // without the operator picking it, while an explicit pick still wins.
  const selected = fields.find(f => f.competition === active) ?? fields[0] ?? null

  // The selected competition's consolation bracket, once it is drawn (ADR-0004) — its matches record like
  // the main bracket's, appended below them under „Nebenrunde · …" headings.
  const consolation = useMemo(
    () =>
      selected
        ? (draws.find(d => d.competition === selected.competition && d.bracket === 'consolation') ?? null)
        : null,
    [draws, selected]
  )

  // The selected competition's result rows: the main bracket, then the consolation bracket, each resolved
  // + numbered over its own set and round-grouped (the third-place playoff last under its own heading).
  const groups = useMemo(
    () => (selected ? [...matchGroups(selected), ...(consolation ? matchGroups(consolation) : [])] : []),
    [selected, consolation]
  )

  if (fields.length === 0) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trophy />
          </EmptyMedia>
          <EmptyTitle>Noch keine Ergebnisse</EmptyTitle>
          <EmptyDescription>
            Sobald eine Konkurrenz ausgelost und enthüllt ist, erscheinen ihre Matches hier — zum Starten („läuft") und
            zum Eintragen der Ergebnisse.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {/* The field picker — one tab per drawn field. Hidden when only one field is drawn. */}
        {fields.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {fields.map(f => (
              <Button
                key={f.competition}
                size="sm"
                variant={f.competition === selected?.competition ? 'default' : 'outline'}
                onClick={() => setActive(f.competition)}
              >
                {competitionLabel(f.competition)}
              </Button>
            ))}
          </div>
        )}

        {selected && (
          <div className="flex flex-col gap-6">
            {groups.map(([label, rows]) => (
              <section key={label} className="flex flex-col gap-2">
                <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{label}</h2>
                <div className="flex flex-col gap-2">
                  {rows.map(row => (
                    <MatchRow
                      key={row.match.id}
                      row={row}
                      nameById={nameById}
                      onOpen={() => setEditing(row)}
                      onSetStatus={onSetStatus}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <ResultDrawer
        editing={editing}
        nameById={nameById}
        onClose={() => setEditing(null)}
        onSubmit={async (id, payload) => {
          const ok = await onRecordResult(id, payload)
          if (ok) setEditing(null)
          return ok
        }}
      />
    </div>
  )
}

// One match row: the number + round-status chips, the two contestant lines (winner emphasised, score
// shown), and the actions — start („läuft", with the actual court) and enter/correct the result.
interface MatchRowProps {
  row: ResultMatch
  nameById: Map<number, string>
  onOpen: () => void
  onSetStatus: (id: number, status: MatchStatus, liveCourt?: number) => Promise<boolean>
}
const MatchRow = ({ row, nameById, onOpen, onSetStatus }: MatchRowProps) => {
  const { match, number, slot1, slot2 } = row
  const bothKnown = slot1.kind === 'player' && slot2.kind === 'player'
  // The court a läuft-start defaults to: the actual court if already set, else the planned court, else 1.
  const [court, setCourt] = useState<number>(match.liveCourt ?? match.court ?? COURT_NUMBERS[0])

  // The winning slot, or null when undecided. The `winnerRegId !== null` guard is load-bearing: without it
  // an undecided match (winnerRegId null) whose slot is an empty feeder (regId null) would match `null ===
  // null` and bold the wrong line as the winner.
  const winnerSlot =
    match.winnerRegId === null
      ? null
      : match.winnerRegId === match.slot1RegId
        ? 1
        : match.winnerRegId === match.slot2RegId
          ? 2
          : null

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline" className="tabular-nums">
          M{number}
        </Badge>
        <StatusBadge status={match.status} />
        {match.status === 'running' && match.liveCourt !== null && (
          <span className="text-muted-foreground text-xs">Platz {match.liveCourt}</span>
        )}
      </div>

      <Contestant
        label={slotName(slot1, nameById)}
        score={scoreFor(match.score, 1)}
        winner={winnerSlot === 1}
        muted={slot1.kind !== 'player'}
      />
      <Contestant
        label={slotName(slot2, nameById)}
        score={scoreFor(match.score, 2)}
        winner={winnerSlot === 2}
        muted={slot2.kind !== 'player'}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {match.status === 'done' ? (
          <Button size="sm" variant="outline" onClick={onOpen}>
            Korrigieren
          </Button>
        ) : (
          bothKnown && (
            <>
              {/* „Läuft" needs a planned court so the live court has a home and the match shows on the
                  public schedule (the feed serves only placed matches); an unplaced match is started from
                  the Spielplan first. The dropdown still lets the operator override the actual court. */}
              {match.status === 'planned' &&
                (match.court !== null ? (
                  <div className="flex items-center gap-1">
                    <NativeSelect
                      aria-label="Platz"
                      className="h-8 w-auto"
                      value={court}
                      onChange={e => setCourt(Number(e.target.value))}
                    >
                      {COURT_NUMBERS.map(c => (
                        <option key={c} value={c}>
                          Platz {c}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button size="sm" variant="outline" onClick={() => void onSetStatus(match.id, 'running', court)}>
                      Läuft
                    </Button>
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">Zum Starten erst im Spielplan platzieren</span>
                ))}
              <Button size="sm" onClick={onOpen}>
                Ergebnis
              </Button>
            </>
          )
        )}
      </div>
    </div>
  )
}

interface StatusBadgeProps {
  status: MatchStatus
}
const StatusBadge = ({ status }: StatusBadgeProps) => (
  <Badge variant={status === 'running' ? 'default' : status === 'done' ? 'secondary' : 'outline'}>
    {STATUS_LABEL[status]}
  </Badge>
)

// One contestant line: name (or feeder label), its set/MTB score, the winner emphasised.
interface ContestantProps {
  label: string
  score: string
  winner: boolean
  muted: boolean
}
const Contestant = ({ label, score, winner, muted }: ContestantProps) => (
  <div className="flex items-center justify-between gap-2 py-0.5">
    <span className={cn('truncate text-sm', winner && 'font-bold', muted && 'text-muted-foreground italic')}>
      {label}
    </span>
    {score && <span className="text-muted-foreground shrink-0 text-sm tabular-nums">{score}</span>}
  </div>
)

// A slot's display name: the joined player name, or the shared German label for a feeder/bye/loser/offen.
const slotName = (view: SlotView, nameById: Map<number, string>): string =>
  view.kind === 'player' ? (nameById.get(view.regId) ?? `#${view.regId}`) : slotLabel(view)

// One slot's score across the three sets, e.g. „6 4 10" — the shared `slotGames` (the single „which
// games" rule, reused by the public live board #91), joined for this surface with a wider gap.
const scoreFor = (score: MatchScore, slot: 1 | 2): string => slotGames(score, slot).join('  ')
