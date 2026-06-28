import { useMemo, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import {
  type AdminRegistration,
  type CompetitionDraw,
  COURT_NUMBERS,
  DAY_INDICES,
  type Match,
  numberMatches,
  type Placement,
  SLOT_INDICES,
  type SlotView,
  slotTime,
  viewSlot
} from '../../../shared'
import { tournament } from '@/data/tournament'
import { cn } from '@/admin/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { competitionLabel } from './registration-detail'

// The schedule surface (UI: „Spielplan", ADR-0005, issue #88): the operator places drawn matches onto a
// courts × time grid, spanning both event days. A tracer bullet — placement only, no validation yet
// (#89). Interaction is select-then-place rather than drag-and-drop: tap a match (in the backlog or on
// the grid) to pick it up, then tap a cell to drop it; the rich drag affordance can layer on later.

// The two event days, labelled from the home of the date copy (src/data/tournament.ts).
const DAYS = [tournament.saturday, tournament.sunday]

interface ScheduleSurfaceProps {
  registrations: AdminRegistration[]
  draws: CompetitionDraw[]
  // Place a match into a cell, move it, or clear it back to the backlog (null). Resolves to whether the
  // write succeeded (the shell toasts + reloads); the surface reflects the new state on the reload.
  onPlace: (id: number, placement: Placement | null) => Promise<boolean>
}

// A match prepared for the grid: its display number, competition, and the two resolved slot labels.
interface GridMatch {
  match: Match
  number: number
  competitionLabel: string
  slot1: string
  slot2: string
}

export const ScheduleSurface = ({ registrations, draws, onPlace }: ScheduleSurfaceProps) => {
  // The match the operator has picked up, waiting for a cell (or a second tap to drop it). Cleared on a
  // successful place.
  const [selected, setSelected] = useState<number | null>(null)

  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const r of registrations) map.set(r.id, `${r.firstName} ${r.lastName}`.trim())
    return map
  }, [registrations])

  // The schedulable matches: a main bracket's real matches (a bye is auto-resolved, never played, so it
  // is never schedulable). An un-revealed bracket's *unplaced* matches stay hidden — projecting the
  // admin must not spoil a draw still being revealed — but a *placed* match is always shown even if its
  // reveal was later rewound, so the operator can still move or unplace it (its placement is already
  // public on the schedule feed). Feeders are resolved per bracket so „Sieger M3" reads stable.
  const gridMatches = useMemo<GridMatch[]>(() => {
    const slotText = (view: SlotView): string =>
      view.kind === 'player'
        ? (nameById.get(view.regId) ?? `#${view.regId}`)
        : view.kind === 'bye'
          ? 'Freilos'
          : `Sieger M${view.matchNumber}`

    const out: GridMatch[] = []
    for (const draw of draws) {
      if (draw.bracket !== 'main') continue
      const revealed = draw.cursor >= draw.total
      const numbers = numberMatches(draw.matches)
      // Index the bracket by round-position once, so each feeder resolves in O(1) rather than a linear
      // scan per slot (O(M) over the bracket for every one of its M matches).
      const byPosition = new Map<string, Match>()
      for (const m of draw.matches) byPosition.set(`${m.round}-${m.position}`, m)
      const matchAt = (round: number, position: number) => byPosition.get(`${round}-${position}`)
      for (const match of draw.matches) {
        if (match.outcome === 'bye') continue
        if (!revealed && match.court === null) continue
        out.push({
          match,
          number: numbers.get(match.id) ?? 0,
          competitionLabel: competitionLabel(draw.competition),
          slot1: slotText(viewSlot(match, 1, numbers, matchAt)),
          slot2: slotText(viewSlot(match, 2, numbers, matchAt))
        })
      }
    }
    return out
  }, [draws, nameById])

  const backlog = gridMatches.filter(g => g.match.court === null)
  const placedByCell = useMemo(() => {
    const map = new Map<string, GridMatch>()
    for (const g of gridMatches) {
      if (g.match.court !== null && g.match.day !== null && g.match.slot !== null) {
        map.set(`${g.match.day}-${g.match.slot}-${g.match.court}`, g)
      }
    }
    return map
  }, [gridMatches])

  const place = async (id: number, placement: Placement | null) => {
    const ok = await onPlace(id, placement)
    if (ok) setSelected(null)
  }

  const onCellClick = (day: number, slot: number, court: number) => {
    const cell = placedByCell.get(`${day}-${slot}-${court}`)
    if (cell) {
      // Tapping an occupied cell picks that match up to move it (a second tap on its own cell deselects).
      setSelected(prev => (prev === cell.match.id ? null : cell.match.id))
    } else if (selected !== null) {
      // An empty cell with a match in hand: drop it here.
      void place(selected, { court, day, slot })
    }
  }

  if (gridMatches.length === 0) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays />
          </EmptyMedia>
          <EmptyTitle>Noch kein Spielplan</EmptyTitle>
          <EmptyDescription>
            Sobald eine Konkurrenz ausgelost ist, erscheinen ihre Matches hier und lassen sich auf Plätze und Zeiten
            verteilen.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <p className="text-muted-foreground text-sm">
          {selected !== null
            ? 'Match aufgenommen — tippe eine freie Zelle, um es zu platzieren.'
            : 'Match wählen (unten oder im Raster), dann eine Zelle antippen.'}
        </p>

        <Backlog
          matches={backlog}
          selected={selected}
          onSelect={id => setSelected(prev => (prev === id ? null : id))}
        />

        {DAY_INDICES.map(day => (
          <DayGrid
            key={day}
            day={day}
            label={`${DAYS[day]?.weekday ?? `Tag ${day + 1}`} · ${DAYS[day]?.short ?? ''}`}
            placedByCell={placedByCell}
            selected={selected}
            onCellClick={onCellClick}
            onUnplace={id => void place(id, null)}
          />
        ))}
      </div>
    </div>
  )
}

interface BacklogProps {
  matches: GridMatch[]
  selected: number | null
  onSelect: (id: number) => void
}
// The unplaced matches, waiting to be scheduled. Empty once everything is on the grid.
const Backlog = ({ matches, selected, onSelect }: BacklogProps) => (
  <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
    <div className="flex items-center justify-between">
      <span className="font-semibold">Nicht geplant</span>
      <span className="text-muted-foreground text-sm tabular-nums">{matches.length}</span>
    </div>
    {matches.length === 0 ? (
      <p className="text-muted-foreground text-sm">Alle Matches sind verteilt.</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {matches.map(g => (
          <button
            key={g.match.id}
            type="button"
            onClick={() => onSelect(g.match.id)}
            className={cn(
              'w-52 rounded-lg border p-2 text-left transition-colors',
              selected === g.match.id
                ? 'border-foreground bg-foreground/5 ring-foreground/20 ring-2'
                : 'hover:bg-muted/50'
            )}
          >
            <MatchCard match={g} />
          </button>
        ))}
      </div>
    )}
  </section>
)

interface DayGridProps {
  day: number
  label: string
  placedByCell: Map<string, GridMatch>
  selected: number | null
  onCellClick: (day: number, slot: number, court: number) => void
  onUnplace: (id: number) => void
}
// One day's courts × time grid: a row per slot (its „ca." time), a column per court.
const DayGrid = ({ day, label, placedByCell, selected, onCellClick, onUnplace }: DayGridProps) => (
  <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
    <span className="font-semibold">{label}</span>
    <div className="overflow-x-auto">
      <div
        className="grid min-w-max gap-1"
        style={{ gridTemplateColumns: `auto repeat(${COURT_NUMBERS.length}, minmax(13rem, 1fr))` }}
      >
        {/* Header row: an empty corner, then the court labels. */}
        <div />
        {COURT_NUMBERS.map(court => (
          <div key={court} className="text-muted-foreground px-2 pb-1 text-center text-xs font-semibold">
            Platz {court}
          </div>
        ))}

        {SLOT_INDICES.map(slot => (
          <div key={slot} className="contents">
            <div className="text-muted-foreground flex items-center justify-end pr-2 text-xs font-semibold tabular-nums">
              ca. {slotTime(slot)}
            </div>
            {COURT_NUMBERS.map(court => {
              const cell = placedByCell.get(`${day}-${slot}-${court}`)
              const isSelected = cell !== undefined && cell.match.id === selected
              const isDropTarget = cell === undefined && selected !== null
              return (
                <button
                  key={court}
                  type="button"
                  onClick={() => onCellClick(day, slot, court)}
                  disabled={cell === undefined && selected === null}
                  className={cn(
                    'relative min-h-16 rounded-md border p-1.5 text-left transition-colors',
                    cell ? 'bg-background' : 'border-dashed',
                    isSelected && 'border-foreground ring-foreground/20 ring-2',
                    isDropTarget && 'border-foreground/40 bg-foreground/5 hover:bg-foreground/10',
                    cell === undefined && selected === null && 'cursor-default'
                  )}
                >
                  {cell ? (
                    <>
                      <MatchCard match={cell} />
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Aus dem Plan nehmen"
                        onClick={e => {
                          e.stopPropagation()
                          onUnplace(cell.match.id)
                        }}
                        className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded"
                      >
                        <X className="size-3.5" />
                      </span>
                    </>
                  ) : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  </section>
)

interface MatchCardProps {
  match: GridMatch
}
// The compact match label shared by the backlog chip and a placed cell: M{number} · competition, then
// the two contestants (a player, a „Freilos" bye, or a „Sieger M{n}" feeder).
const MatchCard = ({ match }: MatchCardProps) => (
  <div className="flex flex-col gap-0.5">
    <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
      <span className="tabular-nums">M{match.number}</span>
      <span aria-hidden>·</span>
      <span className="truncate normal-case">{match.competitionLabel}</span>
    </div>
    <div className="truncate text-sm">{match.slot1}</div>
    <div className="text-muted-foreground truncate text-sm">{match.slot2}</div>
  </div>
)
