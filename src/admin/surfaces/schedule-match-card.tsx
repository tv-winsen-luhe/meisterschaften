import { TriangleAlert } from 'lucide-react'
import type { CompetitionSlug, Match } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { competitionAccent, competitionTextAccent } from './competition-accent'

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
      <div
        className={cn(
          'truncate text-[11px] font-semibold tracking-wide uppercase',
          competitionTextAccent(match.competition)
        )}
      >
        {match.competitionLabel}
      </div>
      <div className="mt-auto flex flex-col gap-0.5 pt-0.5">
        <SlotLine label={match.slot1} />
        <SlotLine label={match.slot2} muted />
      </div>
    </div>
  )
}
