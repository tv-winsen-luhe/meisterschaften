import type { Phase } from '../../shared/phase'

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

export interface FrontDoorInput {
  phase: Phase
  /** `GET /api/draw` returned a non-empty `brackets` array — any field is drawn. */
  drawn: boolean
  /** The `published` flag `GET /api/schedule` carries. */
  schedulePublished: boolean
}

export interface FrontDoor {
  /**
   * The tokens the projection matches against `data-phase-lead`. Both the phase-wide token and the
   * stage token are active inside `tournament`, so an element can opt into the whole phase
   * (`"signup tournament"`) or into one stage (`"tournament-draw"`).
   */
  leads: string[]
  /** `marketing` is the document order (signup); `results` puts draw and field directly under the hero. */
  order: 'marketing' | 'results'
}

/**
 * Which lead the front door shows and in which order it presents its sections.
 *
 * Total by construction across the full cross-product, including the combinations the system
 * cannot produce (published without drawn): precedence is published → drawn → neither. A failed
 * extra read is passed in as `false`, which lands on stage 1 — understating what exists is safe,
 * overstating it sends visitors to an empty page (ADR-0060 §8).
 */
export const frontDoorLead = ({ phase, drawn, schedulePublished }: FrontDoorInput): FrontDoor => {
  if (phase === 'signup') return { leads: ['signup'], order: 'marketing' }
  if (phase === 'post-event') return { leads: ['post-event'], order: 'results' }

  const stage = schedulePublished ? 'tournament-schedule' : drawn ? 'tournament-draw' : 'tournament-field'
  return { leads: ['tournament', stage], order: 'results' }
}

/**
 * Whether a `data-phase-lead` attribute value opts into any of the active leads. The value is a
 * whitespace-separated token list (ADR-0060 amendment §3) so one element can serve several phases
 * instead of shipping two identical hidden copies. Tokens match whole — `tournament` must not pull
 * in the stage-specific `tournament-draw` lead.
 */
export const matchesLead = (value: string | null, leads: string[]): boolean =>
  value !== null && value.split(/\s+/).some(token => token !== '' && leads.includes(token))
