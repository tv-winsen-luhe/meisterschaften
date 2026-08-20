import { z } from 'zod'
import { cancelledCompetitionsSchema } from './cancellation'
import { socialMixerCourtsSchema, socialMixerPlacementSchema } from './social-mixer'

// The operator-controlled phase contract (ADR-0006, ADR-0027) — the single source of truth for
// the phase value and the /api/phase + /api/admin/phase JSON shapes, shared by the worker
// (server validation + cron gate) and the client (public surfaces + React admin via `hc`).
// camelCase on the wire, like every other contract here.
//
// Three values, two genuine operator transitions (ADR-0027): `signup` → `tournament` closes
// registration and freezes the seeding (the precondition for any draw), and `tournament` →
// `post-event` ends the event and unlocks the purge. The former `draw`/`live` distinction is
// gone as an operator-set value — within `tournament` the public presentation is derived from
// the per-competition draw state, not flipped by hand.
//
// The phase is the one value every public surface keys off and the only thing the weekly
// nuLiga cron is gated on (it runs only during `signup`). It defaults to `signup`,
// the phase the event is in today. Values are English identifiers; the German names
// signup/tournament are display copy (see the admin's PHASE_LABELS).

export const PHASES = ['signup', 'tournament', 'post-event'] as const
export const phaseSchema = z.enum(PHASES)
export type Phase = z.infer<typeof phaseSchema>

// The phase a fresh app-state record carries before the operator ever toggles it.
export const DEFAULT_PHASE: Phase = 'signup'

// GET /api/phase — the current phase every surface reads at runtime, plus the competitions the operator
// has cancelled (ADR-0062) and where the Social mixer's block currently sits (ADR-0064). Both ride along
// here rather than on their own endpoints: this is the one call every public surface already makes, so it
// is one poll and one signal — and the same Zod schema stays the single source of the wire form
// (ADR-0048). The mixer carries two things that do not replace each other (ADR-0073): its *placement*, the
// operator's own state, and its **resolved court list**, derived here from the confirmed head-count so the
// public line can name the courts without the count ever being published.
export const phaseResponseSchema = z.object({
  phase: phaseSchema,
  cancelledCompetitions: cancelledCompetitionsSchema,
  socialMixerPlacement: socialMixerPlacementSchema,
  socialMixerCourts: socialMixerCourtsSchema
})
export type PhaseResponse = z.infer<typeof phaseResponseSchema>

// POST /api/admin/phase — the operator sets the phase. The enum rejects anything else.
export const setPhaseRequestSchema = z.object({
  phase: z.enum(PHASES, { error: 'Ungültige Phase.' })
})
export type SetPhaseRequest = z.infer<typeof setPhaseRequestSchema>

export const setPhaseResponseSchema = z.object({ ok: z.literal(true), phase: phaseSchema })
export type SetPhaseResponse = z.infer<typeof setPhaseResponseSchema>

// POST /api/admin/social-mixer-block — the operator moves the mixer's block (ADR-0064). The same schema
// the read side uses, so the window bound („bis 20:00 Uhr") is enforced here and not only in the dialog.
export const setSocialMixerBlockRequestSchema = socialMixerPlacementSchema
export type SetSocialMixerBlockRequest = z.infer<typeof setSocialMixerBlockRequestSchema>

export const setSocialMixerBlockResponseSchema = z.object({
  ok: z.literal(true),
  socialMixerPlacement: socialMixerPlacementSchema
})
export type SetSocialMixerBlockResponse = z.infer<typeof setSocialMixerBlockResponseSchema>
