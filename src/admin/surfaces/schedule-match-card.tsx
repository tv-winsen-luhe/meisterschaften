import { TriangleAlert } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import {
  bracketDepth,
  type CompetitionDraw,
  type CompetitionSlug,
  isFullyRevealed,
  isUnplaced,
  liveCourtNote,
  type Match,
  resolveBracket,
  roundLabel,
  slotLabel,
  type SlotView
} from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { competitionAccent, competitionTextAccent } from './competition-accent'
import { competitionLabel } from './registration-detail'

// The chip chrome — its width and box — so the backlog card and the drag overlay that lifts off it stay
// the same size and shape (a mismatch makes the card visibly jump when picked up).
export const CHIP_CHROME = 'w-52 rounded-lg border p-2 text-left'

// The draggable-card wiring every card shares (ADR-0038's primary gesture): the node ref to attach, the
// listeners + attributes to spread onto the element, and whether this is the card currently lifted (dimmed
// in place while its overlay follows the pointer). Backlog chip, placed cell and drag overlay are all
// draggable the same way; only their chrome differs, so the *how* lives with the card rather than being
// re-declared beside each one.
export const useDraggableCard = (id: number) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  return { setNodeRef, isDragging, dragProps: { ...listeners, ...attributes } }
}

// One contestant line resolved for the grid: its label, and whether the slot is *unresolved*. An
// unresolved line (SlotView `unknown` → „offen") is, on the admin grid, *always* an inconsistency — a
// healthy undecided slot reads „Sieger M{n}", never „offen" — so it is the operator's tell (ADR-0035),
// styled as a warning and repaired by re-running the draw. The public feed renders the same „offen" calmly.
export interface SlotLabel {
  text: string
  unresolved: boolean
}

// A match prepared for the grid: its display number, round label, competition, and the two resolved slot
// labels. The `competition` slug carries the accent (competitionAccent); `competitionLabel` is the copy;
// `roundLabel` is the shared German round name („Achtelfinale" … „Finale", „Nebenrunde · …").
export interface GridMatch {
  match: Match
  number: number
  roundLabel: string
  competition: CompetitionSlug
  competitionLabel: string
  slot1: SlotLabel
  slot2: SlotLabel
}

/**
 * Every drawn bracket's schedulable matches, as the cards the grid draws — the projection the schedule
 * surface renders from, beside the type it produces.
 *
 * A bye is auto-resolved and never played, so it is never schedulable. A main bracket still being revealed
 * keeps its *unplaced* matches hidden — projecting the admin must not spoil the reveal — but a **placed**
 * match is always shown even if its reveal was later rewound, so the operator can still move or unplace it
 * (the public feed withholds it again while the bracket is rewound, ADR-0036 — but the desk must still be
 * able to manage it). The consolation bracket has no reveal show (ADR-0004), so all its matches show at
 * once. Numbering and feeder resolution run **per bracket**, through the same shared resolver the public
 * feed reads (#109), so „Sieger M3" reads stable.
 */
export const gridCards = (draws: readonly CompetitionDraw[], nameById: Map<number, string>): GridMatch[] => {
  // The slot label: a player's name (the grid's own regId join to a name, with a `#id` fallback), or the
  // shared German copy for every undecided slot. The unresolved flag is derivable from the kind —
  // `unknown` is the only unresolved („offen") slot — so it tags the same label, rather than repeating
  // `unresolved: false` on every other branch.
  const slotText = (view: SlotView): SlotLabel => {
    const text = view.kind === 'player' ? (nameById.get(view.regId) ?? `#${view.regId}`) : slotLabel(view)
    return { text, unresolved: view.kind === 'unknown' }
  }

  const out: GridMatch[] = []
  for (const draw of draws) {
    const revealed = draw.bracket !== 'main' || isFullyRevealed(draw)
    // The bracket's depth (its highest round) — the shared `roundLabel` reads round names from the end,
    // so this turns each match's round into „Achtelfinale" … „Finale" (#142).
    const totalRounds = bracketDepth(draw.matches)
    for (const { match, number, slot1, slot2 } of resolveBracket(draw.matches)) {
      if (match.outcome === 'bye') continue
      if (!revealed && isUnplaced(match)) continue
      out.push({
        match,
        number,
        roundLabel: roundLabel({
          bracket: draw.bracket,
          round: match.round,
          totalRounds,
          thirdPlace: match.thirdPlace
        }),
        competition: draw.competition,
        competitionLabel: competitionLabel(draw.competition),
        slot1: slotText(slot1),
        slot2: slotText(slot2)
      })
    }
  }
  return out
}

// The hint behind an „offen" line's warning treatment — it names the repair, since the underlying fix
// is re-running the draw, not anything on this grid (ADR-0035).
const UNRESOLVED_HINT = 'Konnte nicht aufgelöst werden — bitte Auslosung erneut durchführen.'

interface SlotLineProps {
  label: SlotLabel
  muted?: boolean
}
// One contestant line: a resolved slot is plain text (the second line muted); an unresolved one gets
// the warning treatment SlotLabel describes — amber + a warning icon + the repair hint.
const SlotLine = ({ label, muted }: SlotLineProps) =>
  label.unresolved ? (
    <div className="flex items-center gap-1 text-sm font-medium text-amber-700" title={UNRESOLVED_HINT}>
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label.text}</span>
    </div>
  ) : (
    <div className={cn('truncate text-sm', muted && 'text-muted-foreground')}>{label.text}</div>
  )

interface MatchCardProps {
  match: GridMatch
  // Reserve the card's top-right corner for the placed cell's un-place „X" (#157). A placed cell draws the
  // X there, so its match number must keep clear of that corner; a backlog chip has no X and passes this
  // false, keeping the round label's full width.
  reserveAction?: boolean
}
// The redesigned match card shared by the backlog chip and a placed cell (#142): the round name as the
// headline with M{number} alongside, the competition in its accent colour + a matching left border, then
// the two contestants pushed to the foot so the card fills its 90-minute (3-row) footprint. The grid
// position already encodes the time + court, so neither is repeated here. A running/finished match reads
// lighter — it is live truth on the board, not something still to be placed (ADR-0032).
export const MatchCard = ({ match, reserveAction }: MatchCardProps) => {
  const settled = match.match.status === 'running' || match.match.status === 'done'
  const note = liveCourtNote(match.match)
  return (
    <div
      className={cn(
        'flex h-full flex-col gap-1 border-l-4 pl-2',
        competitionAccent(match.competition),
        settled && 'opacity-60'
      )}
    >
      {/* Round name as the headline with M{n} pinned right after it („Halbfinale · M3", #157) — grouped at
          the start so the card's top-right corner stays free for the placed cell's un-place „X". The round
          label truncates; the match number never does, so it stays readable however long the label runs. */}
      <div className={cn('flex items-baseline gap-1', reserveAction && 'pr-7')}>
        <span className="truncate text-sm font-semibold">{match.roundLabel}</span>
        <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tabular-nums">· M{match.number}</span>
      </div>
      {/* The competition, and — pinned right — where the match actually is when that has left the cell it
          sits in (ADR-0079 rule 3). „→ Platz 5" is the whole of what the grid says about reality: the card
          stays parked on its reservation, because the cell's position *is* the reservation, and the write
          court's write lever lives on the Ergebnisse row. It is full ink rather than a warning colour — a moved match is
          normal tournament day, not a fault. */}
      <div className="flex items-baseline justify-between gap-1">
        <span
          className={cn(
            'truncate text-[11px] font-semibold tracking-wide uppercase',
            competitionTextAccent(match.competition)
          )}
        >
          {match.competitionLabel}
        </span>
        {note && <span className="shrink-0 text-[11px] font-semibold tabular-nums">{note}</span>}
      </div>
      <div className="mt-auto flex flex-col gap-0.5 pt-0.5">
        <SlotLine label={match.slot1} />
        <SlotLine label={match.slot2} muted />
      </div>
    </div>
  )
}
