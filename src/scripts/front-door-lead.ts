import { activeCompetitions } from '../../shared/cancellation'
import { COMPETITION_SLUGS, type CompetitionSlug } from '../../shared/competition'
import type { Phase } from '../../shared/phase'
import { competitions as lineUp } from '../data/tournament'

// The front door's stage rule (ADR-0060). `tournament` is one phase but three very different
// moments — the field is closed and nothing is drawn; a bracket exists (a running reveal counts,
// `/api/draw` is non-empty from its first revealed step); the schedule is published — and the page
// must lead with whichever surface actually has something on it. So the homepage reads the phase
// plus two booleans and derives its presentation here, in one pure function.
//
// This deliberately does not live in `shared/`: that is the wire contract between worker and
// client, while `drawn` and `schedulePublished` are two observations only this page combines
// (ADR-0060 §7). The homepage still does not model the per-competition lifecycle — it reads two
// bits, not a bracket state machine (§3).
//
// The same module also derives *which fields the page shows* (ADR-0062). The front door is rendered
// at build time and its cards come from the static competition list (ADR-0008), so — unlike the
// data-driven surfaces, which are simply served a shorter list — it has to apply the cancellation at
// runtime. That is no contradiction to ADR-0048: the **decision** still arrives as one signal from
// the server (`cancelledCompetitions` on `GET /api/phase`); the static page is only the surface that
// applies it.

/**
 * The closed set of leads an element can opt into via `data-phase-lead`. A union rather than a
 * bare string so a mistyped token is a build error instead of a CTA that silently never appears:
 * the producer below and every consumer in the markup are otherwise coupled by spelling alone.
 */
export type Lead =
  'signup' | 'tournament' | 'tournament-field' | 'tournament-draw' | 'tournament-schedule' | 'post-event'

export interface FrontDoorInput {
  phase: Phase
  /** `GET /api/draw` returned a non-empty `brackets` array — any field is drawn. */
  drawn: boolean
  /** The `published` flag `GET /api/schedule` carries. */
  schedulePublished: boolean
  /** The cancelled competitions, straight off the `cancelledCompetitions` `GET /api/phase` carries. */
  cancelled: readonly string[]
}

export interface FrontDoor {
  /**
   * The tokens the projection matches against `data-phase-lead`. Both the phase-wide token and the
   * stage token are active inside `tournament`, so an element can opt into the whole phase
   * (`"signup tournament"`) or into one stage (`"tournament-draw"`).
   */
  leads: Lead[]
  /** `marketing` is the document order (signup); `results` puts draw and field directly under the hero. */
  order: 'marketing' | 'results'
  /**
   * The section rhythm (ADR-0072). `marketing` is the generous spacing the page ships with; `board`
   * tightens it, because during `tournament` the front door is read like a board, and roughly 280px of
   * empty space between the hero and „Auslosung" is a marketing-page pace applied to one.
   */
  pacing: 'marketing' | 'board'
  /** The fields the page shows — the offered line-up minus the cancelled ones (ADR-0062 §5). */
  competitions: CompetitionSlug[]
  /** The one factual line a cancellation leaves behind, or `null` while nothing is cancelled. */
  cancellationNote: string | null
}

// The public label of each competition, from the one place that owns the line-up's copy — so the
// derived line below cannot drift from the card, the filter chip or the participant list.
const LABELS = new Map(lineUp.map(c => [c.slug, c.label]))

/** „Damen", „Damen und Damen Doppel", „Herren, Damen und Damen Doppel". */
const enumerate = (labels: string[]): string =>
  labels.length < 2 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} und ${labels[labels.length - 1]}`

/**
 * The one line that survives a cancellation, derived from the flag rather than written by hand
 * (ADR-0062 §5): hand-written copy can be forgotten the moment the flag is set, and then the site
 * silently buries a field somebody registered for. The reason is always the same — too few entries —
 * so the competition's label is the only variable. Quiet and factual: this is a FAQ answer, not a
 * second lead over the event.
 */
const cancellationNote = (cancelled: readonly string[]): string | null => {
  const labels = COMPETITION_SLUGS.filter(slug => cancelled.includes(slug)).map(slug => LABELS.get(slug) ?? slug)
  if (labels.length === 0) return null
  const verb = labels.length === 1 ? 'findet' : 'finden'
  return `${enumerate(labels)} ${verb} dieses Jahr nicht statt — dafür gab es zu wenige Anmeldungen. Alle Angemeldeten informiert der Sportwart persönlich.`
}

/**
 * Which lead the front door shows, in which order it presents its sections, and which fields it
 * shows at all.
 *
 * Total by construction across the full cross-product, including the combinations the system
 * cannot produce (published without drawn): precedence is published → drawn → neither. A failed
 * extra read is passed in as `false`, which lands on stage 1 — understating what exists is safe,
 * overstating it sends visitors to an empty page (ADR-0060 §8).
 *
 * The pacing follows the phase alone, not the stage: it answers „is this page a board or a marketing
 * surface", and inside `tournament` it is a board whether or not anything is drawn yet. `post-event`
 * keeps the marketing rhythm even though it reads in the results order — its reader is browsing an
 * archive, not standing at the courts (ADR-0072).
 *
 * The cancellation is independent of the stage: which fields exist and what is going on are two
 * different questions, so a cancelled competition never moves the lead. It is applied in every
 * phase — the phase does not make a cancelled field happen — and an empty set is the common case
 * that leaves the whole line-up standing, including the failed-read fallback.
 */
export const frontDoorLead = ({ phase, drawn, schedulePublished, cancelled }: FrontDoorInput): FrontDoor => {
  const fields = { competitions: activeCompetitions(cancelled), cancellationNote: cancellationNote(cancelled) }
  if (phase === 'signup') return { leads: ['signup'], order: 'marketing', pacing: 'marketing', ...fields }
  if (phase === 'post-event') return { leads: ['post-event'], order: 'results', pacing: 'marketing', ...fields }

  const stage = schedulePublished ? 'tournament-schedule' : drawn ? 'tournament-draw' : 'tournament-field'
  return { leads: ['tournament', stage], order: 'results', pacing: 'board', ...fields }
}

/**
 * Whether a `data-phase-lead` attribute value opts into any of the active leads. The value is a
 * whitespace-separated token list (ADR-0060 amendment §3) so one element can serve several phases
 * instead of shipping two identical hidden copies. Tokens match whole — `tournament` must not pull
 * in the stage-specific `tournament-draw` lead.
 */
export const matchesLead = (value: string | null, leads: readonly string[]): boolean =>
  value !== null && value.split(/\s+/).some(token => token !== '' && leads.includes(token))
