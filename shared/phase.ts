import { z } from 'zod'

// The operator-controlled phase contract (ADR-0006) — the single source of truth for the
// phase value and the /api/phase + /api/admin/phase JSON shapes, shared by the worker
// (server validation + cron gate) and the client (public surfaces + React admin via `hc`).
// camelCase on the wire, like every other contract here.
//
// The phase is the one value every public surface keys off and the only thing the weekly
// nuLiga cron is gated on (it runs only during `anmeldung`). It defaults to `anmeldung`,
// the phase the event is in today.

export const PHASES = ['anmeldung', 'auslosung', 'live', 'post-event'] as const
export const phaseSchema = z.enum(PHASES)
export type Phase = z.infer<typeof phaseSchema>

// The phase a fresh app-state record carries before the operator ever toggles it.
export const DEFAULT_PHASE: Phase = 'anmeldung'

// GET /api/phase — the current phase every surface reads at runtime.
export const phaseResponseSchema = z.object({ phase: phaseSchema })
export type PhaseResponse = z.infer<typeof phaseResponseSchema>

// POST /api/admin/phase — the operator sets the phase. The enum rejects anything else.
export const setPhaseRequestSchema = z.object({
  phase: z.enum(PHASES, { error: 'Ungültige Phase.' })
})
export type SetPhaseRequest = z.infer<typeof setPhaseRequestSchema>

export const setPhaseResponseSchema = z.object({ ok: z.literal(true), phase: phaseSchema })
export type SetPhaseResponse = z.infer<typeof setPhaseResponseSchema>
