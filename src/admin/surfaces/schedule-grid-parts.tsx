import { X } from 'lucide-react'
import { absoluteSlot, COURT_NUMBERS, SLOT_INDICES, slotTime } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { type GridMatch, MatchCard } from './schedule-match-card'

interface BacklogProps {
  matches: GridMatch[]
  selected: number | null
  onSelect: (id: number) => void
}
// The unplaced matches, waiting to be scheduled. Empty once everything is on the grid.
export const Backlog = ({ matches, selected, onSelect }: BacklogProps) => (
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
  selectedEarliest: number
  onCellClick: (day: number, slot: number, court: number) => void
  onUnplace: (id: number) => void
}
// One day's courts × time grid: a row per slot (its „ca." time), a column per court.
export const DayGrid = ({
  day,
  label,
  placedByCell,
  selected,
  selectedEarliest,
  onCellClick,
  onUnplace
}: DayGridProps) => (
  <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
    <span className="font-semibold">{label}</span>
    <div className="overflow-x-auto">
      <div
        className="grid gap-1"
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
              const abs = absoluteSlot(day, slot)
              const tooEarly = selected !== null && cell === undefined && abs < selectedEarliest
              const isDropTarget = cell === undefined && selected !== null && !tooEarly
              return (
                <button
                  key={court}
                  type="button"
                  onClick={() => onCellClick(day, slot, court)}
                  disabled={(cell === undefined && selected === null) || tooEarly}
                  className={cn(
                    'relative min-h-16 rounded-md border p-1.5 text-left transition-colors',
                    cell ? 'bg-background' : 'border-dashed',
                    isSelected && 'border-foreground ring-foreground/20 ring-2',
                    tooEarly && 'cursor-not-allowed opacity-40',
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
