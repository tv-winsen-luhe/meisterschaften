import { useState } from 'react'
import {
  COURT_NUMBERS,
  courtLabel,
  courtStoppedHint,
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
  // The courts a standing Play suspension stops, as the shell resolved them.
  stoppedCourts: readonly number[]
  onOpen: () => void
  onSetStatus: (id: number, status: MatchStatus, liveCourt?: number) => Promise<boolean>
}
export const MatchRow = ({ row, meta, nameById, stoppedCourts, onOpen, onSetStatus }: MatchRowProps) => {
  const { match, number, slot1, slot2 } = row
  const bothKnown = slot1.kind === 'player' && slot2.kind === 'player'
  // The court the control shows. The server is the truth — the actual court while the match is on one,
  // else the planned court — and `pick` is only the operator's un-written choice on top of it: a court
  // armed for a „läuft" not yet stated, or one being written right now. The row lives for the whole match
  // now, so a court that moved elsewhere (a re-place in the Spielplan, a second device) must reach this
  // select; a `useState` seeded once would keep showing the court the row was mounted with and then write
  // it back as the actual court, manufacturing a divergence nobody stated.
  const [pick, setPick] = useState<number | null>(null)
  const court = pick ?? match.liveCourt ?? match.court ?? COURT_NUMBERS[0]
  // Whether the two controls are on screen at all: „läuft" needs a planned court, so an unplaced match
  // that has not started is sent to the Spielplan instead — and has no court for the hint below to be
  // about either.
  const controllable = match.court !== null || match.status !== 'planned'
  const stoppedHintId = `match-${match.id}-court-stopped`

  // A status write, with the pick handed back to the server afterwards: on success the reload carries the
  // new court, and on a rejected write the select drops back to what the server actually holds rather than
  // asserting a court the match never moved to.
  const write = async (status: SettableStatus, liveCourt?: number) => {
    await onSetStatus(match.id, status, liveCourt)
    setPick(null)
  }

  // Picking a court while the match runs *is* the write (ADR-0079 rule 1) — the actual court is tracked for
  // the life of the match, so nothing sits between „sie sind jetzt auf Platz 5" and the public board saying
  // so. While the match is still planned the pick only arms the „läuft" the operator has yet to state.
  const pickCourt = (next: number) => {
    setPick(next)
    if (match.status === 'running') void write('running', next)
  }

  // The status control writes what the operator states (ADR-0079 rule 4): „läuft" with the picked court,
  // „geplant" with none — the Store clears the actual court there (rule 5), since an un-started match is on
  // no court. No undo vocabulary and no confirm: the enum is small and the operator says what is true.
  const pickStatus = (next: SettableStatus) => {
    if (next !== match.status) void write(next, next === 'running' ? court : undefined)
  }

  // The contradiction between the „läuft" the operator is about to state and a court they have marked as
  // stopped, said out loud and never acted on (ADR-0078 Amendment 2 rule 5). It reads the court the match
  // would actually start on — the pick above, not the reservation — and it neither blocks the write nor
  // releases the court: a start there may simply mean the court dried and nobody has said so yet, and
  // releasing it silently would announce that play has resumed there (ADR-0078 rule 7's reason, one level
  // down).
  //
  // It speaks about the **start**, so only a match still `geplant` carries it. A match already `läuft` on a
  // stopped court is not a contradiction at all — it is the normal shape of a rain delay, a match waiting
  // it out at 4:3 in the second set (ADR-0078 rule 3) — and during a total suspension every running row
  // would otherwise shout the same non-news on the busiest screen of the day.
  const stoppedHint = controllable && match.status === 'planned' ? courtStoppedHint(court, stoppedCourts) : null

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
              {!controllable ? (
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
                        {courtLabel(c)}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label="Status"
                    aria-describedby={stoppedHint ? stoppedHintId : undefined}
                    className="h-8 w-auto"
                    value={match.status}
                    onChange={e => pickStatus(e.target.value as SettableStatus)}
                  >
                    {SETTABLE_STATUSES.map(s => (
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
              {/* Soft, and on its own row on a phone — a hint that shouted would read as a block. */}
              {stoppedHint && (
                <span id={stoppedHintId} className="text-muted-foreground basis-full text-xs">
                  {stoppedHint}
                </span>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}

// The two states the row's status control moves between, in either direction. „beendet" is deliberately not
// among them: it is reached by entering a result, and nothing un-finishes a match — leaving `done` would
// have to decide what happens to a winner already advanced into the parent match (ADR-0079 rule 6, a named
// gap). Not „live" statuses: this event already calls a phase and a court „live", and what these two share
// is only that the control may set them.
const SETTABLE_STATUSES = ['planned', 'running'] as const satisfies readonly MatchStatus[]
type SettableStatus = (typeof SETTABLE_STATUSES)[number]

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
