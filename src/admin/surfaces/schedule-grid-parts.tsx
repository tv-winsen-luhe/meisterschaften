import { type CSSProperties } from 'react'
import { Lightbulb } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import {
  absoluteSlot,
  COURT_NUMBERS,
  isFloodlit,
  overlapsSocialMixerBlock,
  type Placement,
  SLOT_INDICES,
  SLOT_SPAN,
  slotTime,
  type SocialMixerBlock,
  withinEveningWindow
} from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { type SettableStatus } from './match-actions'
import { CHIP_CHROME, type GridMatch, MatchCard, useDraggableCard } from './schedule-match-card'
import { PlacedCell } from './schedule-placed-cell'

// The presentational half of the schedule surface (ADR-0038): the backlog, the courts × time grids, and
// the drag overlay chip. Every card here is both draggable (the primary gesture) and tappable (the
// fallback) — dnd-kit's mouse sensor only starts a drag past a movement threshold, so a plain click still
// fires the tap handler. The occupied cell, which grew its own chrome in ADR-0080, lives next door in
// schedule-placed-cell.tsx. The owning surface (schedule-surface.tsx) holds the state and the placement path.

interface BacklogProps {
  matches: GridMatch[]
  selected: number | null
  onSelect: (id: number) => void
}
// The unplaced matches, waiting to be scheduled (#157). Pinned to the top of the scrolling surface
// (`sticky top-0`) so its cards stay in reach — and draggable onto a far cell — however far down the long
// courts × time grid the operator scrolls; the detached DragOverlay means sticky positioning never breaks
// the drag. Its card list caps its own height and scrolls internally, so a large backlog can't eat the
// viewport. Collapses to nothing once every match is placed — there is then nothing left to drag.
export const Backlog = ({ matches, selected, onSelect }: BacklogProps) => {
  if (matches.length === 0) return null
  return (
    <section className="bg-card sticky top-0 z-30 flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Nicht geplant</span>
        <span className="text-muted-foreground text-sm tabular-nums">{matches.length}</span>
      </div>
      <div className="flex max-h-[40vh] flex-wrap gap-2 overflow-y-auto">
        {matches.map(g => (
          <BacklogCard
            key={g.match.id}
            match={g}
            selected={selected === g.match.id}
            onSelect={() => onSelect(g.match.id)}
          />
        ))}
      </div>
    </section>
  )
}

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
  // The Social mixer's resolved block, or `null` when there is none — a cancelled mixer shades nothing
  // (ADR-0064, ADR-0062). Its courts and its day/start both move, so the shading is recomputed per render
  // from the one resolved block the validator also reads.
  socialMixerBlock: SocialMixerBlock | null
  onCellClick: (day: number, slot: number, court: number) => void
  onUnplace: (id: number) => void
  // A placed card's two live affordances (ADR-0080): open the result drawer on that match, and state its
  // status. Both are handed down untouched — the grid draws them, the surface performs them.
  onOpenResult: (id: number) => void
  onSetStatus: (id: number, status: SettableStatus, liveCourt?: number) => void
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
  socialMixerBlock,
  onCellClick,
  onUnplace,
  onOpenResult,
  onSetStatus
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
              <span className="inline-flex items-center gap-1">
                Platz {court}
                {/* The floodlit pair (5 & 6) is marked so the operator sees which courts carry the late
                    overflow — they reach the 22:00 curfew while the dark four stop in daylight (ADR-0040). */}
                {isFloodlit(court) && <Lightbulb className="size-3 text-amber-500" aria-label="Flutlicht" />}
              </span>
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
                    inHand={cell.match.id === inHand}
                    style={{ gridColumn: ci + 2, gridRow: `${slot + 2} / span ${span}` }}
                    onClick={() => onCellClick(day, slot, court)}
                    onUnplace={onUnplace}
                    onOpenResult={onOpenResult}
                    onSetStatus={onSetStatus}
                  />
                )
              }
              // An interior row of a match above is drawn over by that match's card — never its own target.
              if (covered.has(`${slot}-${court}`)) return null
              // A free cell is past the court's evening window when a 90-minute match starting here would
              // run past its bound — daylight on the dark courts 1–4, the 22:00 curfew on the floodlit pair
              // (ADR-0040). Static per court, so the dark courts visibly stop earlier even at rest.
              const pastWindow = !withinEveningWindow(court, day, slot)
              // A free cell is too early when its absolute slot sits before the in-hand match's earliest
              // legal slot (the structural feeder guard, #119) — disabled for both tap and drag.
              const tooEarly = inHand !== null && absoluteSlot(day, slot) < inHandEarliest
              // A free cell inside the Social mixer's reserved block (ADR-0064, ADR-0063): tinted, but
              // still a legal target — it warns on drop, it does not block.
              const reserved =
                socialMixerBlock !== null && overlapsSocialMixerBlock(socialMixerBlock, { court, day, slot })
              return (
                <EmptyCell
                  key={`${day}-${slot}-${court}`}
                  day={day}
                  slot={slot}
                  court={court}
                  inHand={inHand}
                  tooEarly={tooEarly}
                  pastWindow={pastWindow}
                  reserved={reserved}
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

interface EmptyCellProps {
  day: number
  slot: number
  court: number
  inHand: number | null
  tooEarly: boolean
  pastWindow: boolean
  reserved: boolean
  style: CSSProperties
  onClick: () => void
}
// A free cell: a drop target while a match is in hand, and a tap target to drop it. A cell past the
// court's evening window (ADR-0040) or below the in-hand match's earliest slot (the feeder guard, #119)
// is never a legal target — not a droppable, not tappable. The two differ in when they show: the window
// block is static per court (rendered muted even at rest, so the dark courts visibly stop earlier),
// while too-early depends on the match in hand. The droppable carries the target `Placement`, so
// drag-end reads it straight off and reaches the same path a tap does.
//
// A cell inside the Social mixer's reserved block (ADR-0063) is a third, weaker state: tinted so the
// reservation is visible at rest, but **still a legal target** — it warns on drop rather than blocking,
// because the reservation is an organiser agreement the operator may overrule (ADR-0033).
const EmptyCell = ({ day, slot, court, inHand, tooEarly, pastWindow, reserved, style, onClick }: EmptyCellProps) => {
  const blocked = pastWindow || tooEarly
  const { setNodeRef, isOver } = useDroppable({
    id: `${day}-${slot}-${court}`,
    data: { court, day, slot } satisfies Placement,
    disabled: blocked
  })
  const isDropTarget = inHand !== null && !blocked
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      disabled={inHand === null || blocked}
      style={style}
      aria-label={
        pastWindow
          ? `Platz ${court} ist um ca. ${slotTime(day, slot)} nicht mehr bespielbar`
          : reserved
            ? `Platz ${court} ist um ca. ${slotTime(day, slot)} für das Damen Doppel reserviert`
            : undefined
      }
      className={cn(
        'relative rounded-md border border-dashed p-1.5 text-left transition-colors',
        reserved && !pastWindow && 'border-amber-500/30 bg-amber-500/10',
        pastWindow && 'bg-muted/40 cursor-not-allowed border-transparent',
        tooEarly && !pastWindow && 'cursor-not-allowed opacity-40',
        isDropTarget && 'border-foreground/40 bg-foreground/5 hover:bg-foreground/10',
        isOver && 'border-foreground bg-foreground/10',
        inHand === null && !pastWindow && 'cursor-default'
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
