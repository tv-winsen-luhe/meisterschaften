import { type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { absoluteSlot, COURT_NUMBERS, type Placement, SLOT_INDICES, SLOT_SPAN, slotTime } from '../../../shared'
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
// One day's courts × time grid: a row per 30-minute slot (its „ca." time), a column per court. A placed
// 90-minute match spans SLOT_SPAN rows (ADR-0040), so cells are placed explicitly on the grid lines and
// the two interior rows of an occupied span are skipped entirely (not drop targets). The grid scrolls
// inside a bounded box with the court headers pinned (`sticky top-0`), so they stay visible on the now-
// taller grid (#137); horizontal scroll within the same box keeps all six courts reachable on a phone.
export const DayGrid = ({
  day,
  label,
  placedByCell,
  selected,
  inHand,
  inHandEarliest,
  onCellClick,
  onUnplace
}: DayGridProps) => {
  // The interior rows covered by a placed match's 90-minute footprint, keyed `slot-court` for this day —
  // a match starting at slot s on a court owns slots s+1 … s+SLOT_SPAN−1, which its 3-row card draws over
  // and which must therefore not render their own drop target. The match currently *in hand* is excluded:
  // while it is being moved its card collapses to one row (below), freeing its own interior cells so it
  // can be nudged a step or two on the same court instead of having to be removed first.
  const covered = new Set<string>()
  for (const g of placedByCell.values()) {
    const { id, day: d, slot, court } = g.match
    if (id === inHand || d !== day || slot === null || court === null) continue
    for (let s = 1; s < SLOT_SPAN; s++) covered.add(`${slot + s}-${court}`)
  }

  // Column 1 holds the „ca." times; court c (1-based) sits in grid column c+1. Row 1 is the header; slot s
  // sits in grid row s+2. A spanning card and the rows beyond the last slot use `gridAutoRows` for height.
  const colHeader = (column: number) => ({ gridColumn: column, gridRow: 1 }) satisfies CSSProperties

  return (
    <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <span className="font-semibold">{label}</span>
      <div className="max-h-[70vh] overflow-auto">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `auto repeat(${COURT_NUMBERS.length}, minmax(13rem, 1fr))`,
            gridTemplateRows: `auto repeat(${SLOT_INDICES.length}, minmax(4rem, auto))`,
            gridAutoRows: 'minmax(4rem, auto)'
          }}
        >
          {/* Header row, pinned while the grid scrolls vertically: an empty corner, then the court labels. */}
          <div className="bg-card sticky top-0 z-20" style={colHeader(1)} />
          {COURT_NUMBERS.map((court, ci) => (
            <div
              key={`h-${court}`}
              className="bg-card text-muted-foreground sticky top-0 z-20 px-2 pb-1 text-center text-xs font-semibold"
              style={colHeader(ci + 2)}
            >
              Platz {court}
            </div>
          ))}

          {/* The „ca." time labels, one per slot row. */}
          {SLOT_INDICES.map(slot => (
            <div
              key={`t-${slot}`}
              className="text-muted-foreground flex items-center justify-end pr-2 text-xs font-semibold tabular-nums"
              style={{ gridColumn: 1, gridRow: slot + 2 }}
            >
              ca. {slotTime(day, slot)}
            </div>
          ))}

          {/* The court cells: a placed match's 3-row card, a free drop target, or nothing (interior span). */}
          {SLOT_INDICES.flatMap(slot =>
            COURT_NUMBERS.map((court, ci) => {
              const cell = placedByCell.get(`${day}-${slot}-${court}`)
              if (cell) {
                // The card fills its 90-minute footprint (SLOT_SPAN rows) — except the one in hand, which
                // collapses to a single row so its freed interior cells become drop targets for a nudge.
                const span = cell.match.id === inHand ? 1 : SLOT_SPAN
                return (
                  <PlacedCell
                    key={`${day}-${slot}-${court}`}
                    cell={cell}
                    selected={selected === cell.match.id}
                    style={{ gridColumn: ci + 2, gridRow: `${slot + 2} / span ${span}` }}
                    onClick={() => onCellClick(day, slot, court)}
                    onUnplace={onUnplace}
                  />
                )
              }
              // An interior row of a match above is drawn over by that match's card — never its own target.
              if (covered.has(`${slot}-${court}`)) return null
              // A free cell is too early when its absolute slot sits before the in-hand match's earliest
              // legal slot (the structural feeder guard, #119) — disabled for both tap and drag.
              const tooEarly = inHand !== null && absoluteSlot(day, slot) < inHandEarliest
              return (
                <EmptyCell
                  key={`${day}-${slot}-${court}`}
                  day={day}
                  slot={slot}
                  court={court}
                  inHand={inHand}
                  tooEarly={tooEarly}
                  style={{ gridColumn: ci + 2, gridRow: slot + 2 }}
                  onClick={() => onCellClick(day, slot, court)}
                />
              )
            })
          )}
        </div>
      </div>
    </section>
  )
}

interface PlacedCellProps {
  cell: GridMatch
  selected: boolean
  style: CSSProperties
  onClick: () => void
  onUnplace: (id: number) => void
}
// An occupied cell: the placed match, draggable to another cell and tappable to pick up. Spans its full
// 90-minute footprint (SLOT_SPAN rows) via the `style` grid placement the day grid hands down. The „aus
// dem Plan nehmen" affordance clears it back to the backlog.
const PlacedCell = ({ cell, selected, style, onClick, onUnplace }: PlacedCellProps) => {
  const { setNodeRef, isDragging, dragProps } = useDraggableCard(cell.match.id)
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      style={style}
      {...dragProps}
      className={cn(
        'bg-background relative rounded-md border p-1.5 text-left transition-colors',
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
  style: CSSProperties
  onClick: () => void
}
// A free cell: a drop target while a match is in hand, and a tap target to drop it. Disabled (and skipped
// as a drop target) when nothing is in hand or the structural guard marks it too early. The droppable
// carries the target `Placement`, so drag-end reads it straight off and reaches the same path a tap does.
const EmptyCell = ({ day, slot, court, inHand, tooEarly, style, onClick }: EmptyCellProps) => {
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
      style={style}
      className={cn(
        'relative rounded-md border border-dashed p-1.5 text-left transition-colors',
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
