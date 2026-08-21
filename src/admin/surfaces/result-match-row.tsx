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
// score shown), and the actions — start („läuft", with the actual court) and enter/correct the result. The
// meta line carries whatever the current view's headings do not (ADR-0077 rule 6) — computed by the surface
// and handed in finished, so the row never has to know which reading it is in.
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
  // The court a läuft-start defaults to: the actual court if already set, else the planned court, else 1.
  const [court, setCourt] = useState<number>(match.liveCourt ?? match.court ?? COURT_NUMBERS[0])

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
