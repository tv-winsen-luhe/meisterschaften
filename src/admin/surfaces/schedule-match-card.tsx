import { TriangleAlert } from 'lucide-react'
import type { CompetitionSlug, Match } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { competitionAccent } from './competition-accent'

// One contestant line resolved for the grid: its label, and whether the slot is *unresolved*. An
// unresolved line (SlotView `unknown` → „offen") is, on the admin grid, *always* an inconsistency — a
// healthy undecided slot reads „Sieger M{n}", never „offen" — so it is the operator's tell (ADR-0035),
// styled as a warning and repaired by re-running the draw. The public feed renders the same „offen" calmly.
export interface SlotLabel {
  text: string
  unresolved: boolean
}

// A match prepared for the grid: its display number, competition, and the two resolved slot labels.
// The `competition` slug carries the accent (competitionAccent); `competitionLabel` is the copy.
export interface GridMatch {
  match: Match
  number: number
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
}
// The compact match label shared by the backlog chip and a placed cell: M{number} · competition, then
// the two contestants (a player, a „Freilos" bye, a „Sieger M{n}" feeder, or an „offen" warning).
export const MatchCard = ({ match }: MatchCardProps) => (
  <div className={cn('flex flex-col gap-0.5 border-l-4 pl-2', competitionAccent(match.competition))}>
    <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
      <span className="tabular-nums">M{match.number}</span>
      <span aria-hidden>·</span>
      <span className="truncate normal-case">{match.competitionLabel}</span>
    </div>
    <SlotLine label={match.slot1} />
    <SlotLine label={match.slot2} muted />
  </div>
)
