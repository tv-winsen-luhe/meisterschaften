import { useState } from 'react'
import {
  COURT_NUMBERS,
  type MatchStatus,
  scoreLine,
  slotLabel,
  type SlotView,
  STATUS_LABELS,
  winningSlot
} from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Badge } from '@/admin/ui/badge'
import { Button } from '@/admin/ui/button'
import { NativeSelect } from '@/admin/ui/native-select'
import type { ResultMatch } from './results-grouping'

// The Ergebnisse surface's row (results-surface.tsx owns the two readings it sits in). Split out when that
// file hit its line cap, the way schedule-match-card.tsx carves the card off the grid.

// One match row: the number + status chips, the meta line, the two contestant lines (winner emphasised,
// score shown), and the actions — the court + status controls and enter/correct the result. The meta line
// carries whatever the current view's headings do not (ADR-0077 rule 6) — computed by the surface and
// handed in finished, so the row never has to know which reading it is in.
interface MatchRowProps {
  row: ResultMatch
  meta: string[]
  nameById: Map<number, string>
  onOpen: () => void
  onSetStatus: (id: number, status: MatchStatus, liveCourt?: number) => Promise<boolean>
}
export const MatchRow = ({ row, meta, nameById, onOpen, onSetStatus }: MatchRowProps) => {
  const { match, number, slot1, slot2 } = row
  const bothKnown = slot1.kind === 'player' && slot2.kind === 'player'
  // The court the control shows: the actual court if the match is on one, else the planned court, else 1.
  const [court, setCourt] = useState<number>(match.liveCourt ?? match.court ?? COURT_NUMBERS[0])

  // Picking a court while the match runs *is* the write (ADR-0079 rule 1) — the actual court is tracked for
  // the life of the match, so nothing sits between „sie sind jetzt auf Platz 5" and the public board saying
  // so. While the match is still planned the pick only arms the „läuft" the operator has yet to state.
  const pickCourt = (next: number) => {
    setCourt(next)
    if (match.status === 'running') void onSetStatus(match.id, 'running', next)
  }

  // The status control writes what the operator states (ADR-0079 rule 4): „läuft" with the picked court,
  // „geplant" with none — the Store clears the actual court there (rule 5), since an un-started match is on
  // no court. No undo vocabulary and no confirm: the enum is small and the operator says what is true.
  const pickStatus = (next: LiveStatus) => {
    if (next !== match.status) void onSetStatus(match.id, next, next === 'running' ? court : undefined)
  }

  // The winning slot, or null when undecided (CONTEXT: Bracket topology). The load-bearing `winnerRegId ===
  // null` guard lives in `winningSlot`, so an undecided match with an empty feeder slot never bolds a line.
  const winnerSlot = winningSlot(match)

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline" className="tabular-nums">
          M{number}
        </Badge>
        <StatusBadge status={match.status} />
        {meta.length > 0 && <span className="text-muted-foreground text-xs">{meta.join(' · ')}</span>}
      </div>

      <Contestant
        label={slotName(slot1, nameById)}
        score={scoreLine(match.score, 1)}
        winner={winnerSlot === 1}
        muted={slot1.kind !== 'player'}
      />
      <Contestant
        label={slotName(slot2, nameById)}
        score={scoreLine(match.score, 2)}
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
              {/* „Läuft" needs a planned court so the actual court has a home and the match shows on the
                  public schedule (the feed serves only placed matches); an unplaced match is started from
                  the Spielplan first. Once it is placed both controls stay for the whole life of the match:
                  the court, because reality moves it (ADR-0079 rule 1), and the status, because a
                  mis-clicked „läuft" is taken back by stating „geplant", not by an undo (rule 4). */}
              {match.court === null && match.status === 'planned' ? (
                <span className="text-muted-foreground text-xs">Zum Starten erst im Spielplan platzieren</span>
              ) : (
                <div className="flex items-center gap-1">
                  <NativeSelect
                    aria-label="Platz"
                    className="h-8 w-auto"
                    value={court}
                    onChange={e => pickCourt(Number(e.target.value))}
                  >
                    {COURT_NUMBERS.map(c => (
                      <option key={c} value={c}>
                        Platz {c}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label="Status"
                    className="h-8 w-auto"
                    value={match.status}
                    onChange={e => pickStatus(e.target.value as LiveStatus)}
                  >
                    {LIVE_STATUSES.map(s => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
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

// The two states the row's status control moves between. „beendet" is deliberately not among them: it is
// reached by entering a result, and nothing un-finishes a match — leaving `done` would have to decide what
// happens to a winner already advanced into the parent match (ADR-0079 rule 6, a named gap).
const LIVE_STATUSES = ['planned', 'running'] as const satisfies readonly MatchStatus[]
type LiveStatus = (typeof LIVE_STATUSES)[number]

interface StatusBadgeProps {
  status: MatchStatus
}
// The operator sees all three states — this is the desk where a match is moved between them, so „geplant"
// is information here in a way it is not on the public row (#327). The labels come from the shared
// vocabulary rather than a fourth hand-copied literal.
const StatusBadge = ({ status }: StatusBadgeProps) => (
  <Badge variant={status === 'running' ? 'default' : status === 'done' ? 'secondary' : 'outline'}>
    {STATUS_LABELS[status]}
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
