import { X } from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { absoluteSlot, COURT_NUMBERS, type Placement, SLOT_INDICES, slotTime } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { type GridMatch, MatchCard } from './schedule-match-card'

// The presentational half of the schedule surface (ADR-0038): the backlog, the courts × time grids, and
// the drag overlay chip. Every card here is both draggable (the primary gesture) and tappable (the
// fallback) — dnd-kit's mouse sensor only starts a drag past a movement threshold, so a plain click still
// fires the tap handler. The owning surface (schedule-surface.tsx) holds the state and the placement path.

// The shared chip chrome — its width and box — so the backlog card and the drag overlay that lifts off it
// stay the same size and shape (a mismatch makes the card visibly jump when picked up).
const CHIP_CHROME = 'w-52 rounded-lg border p-2 text-left'

// The draggable-card wiring shared by the backlog chip and a placed cell: the node ref to attach, the
// listeners + attributes to spread onto the element, and whether it is the card currently lifted (dimmed
// in place while its overlay follows the pointer). Both cards are draggable the same way; only their
// chrome differs.
const useDraggableCard = (id: number) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  return { setNodeRef, isDragging, dragProps: { ...listeners, ...attributes } }
}

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
          <BacklogCard
            key={g.match.id}
            match={g}
            selected={selected === g.match.id}
            onSelect={() => onSelect(g.match.id)}
          />
        ))}
      </div>
    )}
  </section>
)

interface BacklogCardProps {
  match: GridMatch
  selected: boolean
  onSelect: () => void
}
// A backlog chip: draggable onto a cell (the primary gesture) and tappable to pick up (the fallback).
const BacklogCard = ({ match, selected, onSelect }: BacklogCardProps) => {
  const { setNodeRef, isDragging, dragProps } = useDraggableCard(match.match.id)
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      {...dragProps}
      className={cn(
        CHIP_CHROME,
        'transition-colors',
        selected ? 'border-foreground bg-foreground/5 ring-foreground/20 ring-2' : 'hover:bg-muted/50',
        isDragging && 'opacity-40'
      )}
    >
      <MatchCard match={match} />
    </button>
  )
}

interface DayGridProps {
  day: number
  label: string
  placedByCell: Map<string, GridMatch>
  selected: number | null
  inHand: number | null
  inHandEarliest: number
  onCellClick: (day: number, slot: number, court: number) => void
  onUnplace: (id: number) => void
}
// One day's courts × time grid: a row per slot (its „ca." time), a column per court.
export const DayGrid = ({
  day,
  label,
  placedByCell,
  selected,
  inHand,
  inHandEarliest,
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
              // A free cell is too early when its absolute slot sits before the in-hand match's earliest
              // legal slot (the structural feeder guard, #119) — disabled for both tap and drag.
              const tooEarly = inHand !== null && cell === undefined && absoluteSlot(day, slot) < inHandEarliest
              return (
                <GridCell
                  key={court}
                  day={day}
                  slot={slot}
                  court={court}
                  cell={cell}
                  selected={selected}
                  inHand={inHand}
                  tooEarly={tooEarly}
                  onCellClick={onCellClick}
                  onUnplace={onUnplace}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  </section>
)

interface GridCellProps {
  day: number
  slot: number
  court: number
  cell: GridMatch | undefined
  selected: number | null
  inHand: number | null
  tooEarly: boolean
  onCellClick: (day: number, slot: number, court: number) => void
  onUnplace: (id: number) => void
}
// One grid cell. An occupied cell renders a draggable match (drag it to another cell to move it; tap it
// to pick it up). A free cell is a drop target (tap to drop the in-hand match, or release a drag over it),
// greyed and inert when the structural guard marks it too early.
const GridCell = ({ day, slot, court, cell, selected, inHand, tooEarly, onCellClick, onUnplace }: GridCellProps) =>
  cell ? (
    <PlacedCell
      cell={cell}
      selected={selected === cell.match.id}
      onClick={() => onCellClick(day, slot, court)}
      onUnplace={onUnplace}
    />
  ) : (
    <EmptyCell
      day={day}
      slot={slot}
      court={court}
      inHand={inHand}
      tooEarly={tooEarly}
      onClick={() => onCellClick(day, slot, court)}
    />
  )

interface PlacedCellProps {
  cell: GridMatch
  selected: boolean
  onClick: () => void
  onUnplace: (id: number) => void
}
// An occupied cell: the placed match, draggable to another cell and tappable to pick up. The „aus dem
// Plan nehmen" affordance clears it back to the backlog.
const PlacedCell = ({ cell, selected, onClick, onUnplace }: PlacedCellProps) => {
  const { setNodeRef, isDragging, dragProps } = useDraggableCard(cell.match.id)
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      {...dragProps}
      className={cn(
        'bg-background relative min-h-16 rounded-md border p-1.5 text-left transition-colors',
        selected && 'border-foreground ring-foreground/20 ring-2',
        isDragging && 'opacity-40'
      )}
    >
      <MatchCard match={cell} />
      <RemoveControl onRemove={() => onUnplace(cell.match.id)} />
    </button>
  )
}

interface RemoveControlProps {
  onRemove: () => void
}
// „Aus dem Plan nehmen" — clears a placed match back to the backlog. A nested control inside the cell
// button (a real <button> would be invalid DOM here), so it carries its own keyboard handler for Enter /
// Space, and it swallows the drag sensors' activator events (mouse + touch) so pressing it never starts a
// drag of the cell beneath.
const RemoveControl = ({ onRemove }: RemoveControlProps) => (
  <span
    role="button"
    tabIndex={0}
    aria-label="Aus dem Plan nehmen"
    onClick={e => {
      e.stopPropagation()
      onRemove()
    }}
    onKeyDown={e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        onRemove()
      }
    }}
    onMouseDown={e => e.stopPropagation()}
    onTouchStart={e => e.stopPropagation()}
    className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded"
  >
    <X className="size-3.5" />
  </span>
)

interface EmptyCellProps {
  day: number
  slot: number
  court: number
  inHand: number | null
  tooEarly: boolean
  onClick: () => void
}
// A free cell: a drop target while a match is in hand, and a tap target to drop it. Disabled (and skipped
// as a drop target) when nothing is in hand or the structural guard marks it too early. The droppable
// carries the target `Placement`, so drag-end reads it straight off and reaches the same path a tap does.
const EmptyCell = ({ day, slot, court, inHand, tooEarly, onClick }: EmptyCellProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `${day}-${slot}-${court}`,
    data: { court, day, slot } satisfies Placement,
    disabled: tooEarly
  })
  const isDropTarget = inHand !== null && !tooEarly
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      disabled={inHand === null || tooEarly}
      className={cn(
        'relative min-h-16 rounded-md border border-dashed p-1.5 text-left transition-colors',
        tooEarly && 'cursor-not-allowed opacity-40',
        isDropTarget && 'border-foreground/40 bg-foreground/5 hover:bg-foreground/10',
        isOver && 'border-foreground bg-foreground/10',
        inHand === null && 'cursor-default'
      )}
    />
  )
}

interface DragChipProps {
  match: GridMatch
}
// The card that follows the pointer during a drag (DragOverlay): the same MatchCard in the same chip
// chrome as the backlog card it lifted off, boxed with a shadow to read as lifted.
export const DragChip = ({ match }: DragChipProps) => (
  <div className={cn(CHIP_CHROME, 'bg-background shadow-lg')}>
    <MatchCard match={match} />
  </div>
)
