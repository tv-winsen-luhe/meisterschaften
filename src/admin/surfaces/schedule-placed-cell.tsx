import { type CSSProperties, type ReactNode } from 'react'
import { Play, RotateCcw, X } from 'lucide-react'
import { STATUS_LABELS } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { cardActions, type SettableStatus } from './match-actions'
import { type GridMatch, MatchCard, useDraggableCard } from './schedule-match-card'

// The Spielplan's occupied cell, carved off schedule-grid-parts.tsx when that file hit its line cap — the
// way schedule-match-card.tsx carved the card itself off the grid. It is the one place in the admin where
// three affordances share a cell whose width is a single court column (ADR-0080), so it owns both the
// affordance chrome (`CellAction`) and the copy those affordances carry.

interface PlacedCellProps {
  cell: GridMatch
  selected: boolean
  // Whether this is the card currently in hand — picked up by tap or held mid-drag. It is then collapsed
  // to a single row (its interior cells are freed for a nudge) and its chrome says who it is and nothing
  // else: a 4rem box has no room for the action row, and a card being moved is not a card being operated.
  inHand: boolean
  style: CSSProperties
  onClick: () => void
  onUnplace: (id: number) => void
  onOpenResult: (id: number) => void
  onSetStatus: (id: number, status: SettableStatus, liveCourt?: number) => void
}
// An occupied cell: the placed match, draggable to another cell and tappable to pick up. Spans its full
// 90-minute footprint (SLOT_SPAN rows) via the `style` grid placement the day grid hands down. Its chrome
// carries three affordances (ADR-0080): „aus dem Plan nehmen", which clears it back to the backlog, and —
// under the card — the status control and the door into the result drawer. The card's **tap** is
// untouched and still picks the match up: ADR-0038's fallback is the only placement gesture a tablet can
// rely on, so the new affordances are distinct elements beside it, never the card itself (ADR-0080 rule 2).
export const PlacedCell = ({
  cell,
  selected,
  inHand,
  style,
  onClick,
  onUnplace,
  onOpenResult,
  onSetStatus
}: PlacedCellProps) => {
  const { setNodeRef, isDragging, dragProps } = useDraggableCard(cell.match.id)
  const { result, status } = cardActions(cell.match)
  const showActions = !inHand && (result || status !== null)
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      style={style}
      {...dragProps}
      className={cn(
        'bg-background relative flex flex-col rounded-md border p-1.5 text-left transition-colors',
        selected && 'border-foreground ring-foreground/20 ring-2',
        isDragging && 'opacity-40'
      )}
    >
      <div className="min-h-0 flex-1">
        <MatchCard match={cell} reserveAction />
      </div>
      {showActions && (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-2">
          {status && (
            <CellAction
              label={STATUS_ACTION_LABELS[status.next]}
              onActivate={() => onSetStatus(cell.match.id, status.next, status.liveCourt)}
              className={cn(ACTION_CHIP, 'gap-1')}
            >
              {status.next === 'running' ? (
                <Play className="size-3 shrink-0" aria-hidden />
              ) : (
                <RotateCcw className="size-3 shrink-0" aria-hidden />
              )}
              {STATUS_LABELS[status.next]}
            </CellAction>
          )}
          {result && (
            <CellAction
              label={cell.match.status === 'done' ? RESULT_LABELS.correct : RESULT_LABELS.enter}
              onActivate={() => onOpenResult(cell.match.id)}
              className={ACTION_CHIP}
            >
              Ergebnis
            </CellAction>
          )}
        </div>
      )}
      <RemoveControl onRemove={() => onUnplace(cell.match.id)} />
    </button>
  )
}

// The two action chips' chrome: a bordered pill small enough that both fit a single court column beside
// each other, and bordered *because* they must read as controls — the card around them is itself a
// button, so an unboxed word in its foot would look like more card text.
const ACTION_CHIP = 'border px-1.5 py-0.5 text-[11px] font-semibold'

// The status control's two hit-targets name the state they move **to** — the same „geplant"/„läuft"
// vocabulary the Ergebnisse row's select offers (ADR-0079 rule 4), because it is the same control in a
// cell's worth of chrome, not a second grammar. The accessible name spells out the act, since the visible
// label alone reads as a state rather than as a button.
const STATUS_ACTION_LABELS: Record<SettableStatus, string> = {
  running: 'Match starten („läuft")',
  planned: 'Match zurück auf „geplant" setzen'
}
// The result door's accessible name — the word the Ergebnisse row's button carries in each state, since
// it is the same act through the same drawer (ADR-0080 rule 1). The visible chip stays the bare „Ergebnis"
// in both: a court column has no room for „Ergebnis korrigieren", and the card beside it already says
// „beendet" by reading dimmed.
const RESULT_LABELS = { enter: 'Ergebnis eintragen', correct: 'Ergebnis korrigieren' }

interface CellActionProps {
  label: string
  onActivate: () => void
  className?: string
  children?: ReactNode
}
// One affordance inside a placed cell. It is a nested control inside the cell's own button (a real
// <button> would be invalid DOM here), so it carries its own keyboard handler for Enter / Space, and it
// swallows the drag sensors' activator events (mouse + touch) so pressing it never starts a drag of the
// cell beneath — nor, through the click it stops, picks the match up.
const CellAction = ({ label, onActivate, className, children }: CellActionProps) => (
  <span
    role="button"
    tabIndex={0}
    aria-label={label}
    title={label}
    onClick={e => {
      e.stopPropagation()
      onActivate()
    }}
    onKeyDown={e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        onActivate()
      }
    }}
    onMouseDown={e => e.stopPropagation()}
    onTouchStart={e => e.stopPropagation()}
    className={cn(
      'text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center rounded',
      className
    )}
  >
    {children}
  </span>
)

interface RemoveControlProps {
  onRemove: () => void
}
// „Aus dem Plan nehmen" — clears a placed match back to the backlog. Pinned to the corner the card's
// headline keeps free (`reserveAction`). Of the cell's three affordances this is the one that goes if the
// court column ever runs out of room, since a match can also be dragged back to the backlog (ADR-0080).
const RemoveControl = ({ onRemove }: RemoveControlProps) => (
  <CellAction label="Aus dem Plan nehmen" onActivate={onRemove} className="absolute top-1 right-1 size-5">
    <X className="size-3.5" />
  </CellAction>
)
