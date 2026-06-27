import { z } from 'zod'
import { competitionSlug } from './competition'

// The debug-reset contract (ADR-0029): the JSON shapes for the flag-gated reset levers, shared by
// the worker (server validation + the flag guard) and the React admin (the Debug surface via `hc`).
// camelCase on the wire, like every other contract here.
//
// Reset is a debug-only capability, not an operator feature: it deliberately reverses the forward
// transitions the model otherwise treats as final (the draw — ADR-0026/0027 — and confirm). It is
// gated by the `RESET_ENABLED` env flag and absent in production. The three levers mirror the three
// forward transitions and tear down in dependency order (registrations → draw → results):
//
//   - undraw (per competition)  reverses „Jetzt auslosen": deletes the draw record + its matches
//   - readmit (global)          reverses confirm: every `confirmed` entry back to `new`
//   - back-to-signup (global)   reverses the phase: setPhase('signup'), cascading an undraw of all
//
// readmit guards (refuses while any draw exists); back-to-signup cascades (undraws all first). Only
// the top-level lever tears down dependent artifacts automatically — the surgical levers stay atomic.

// GET /api/admin/reset — whether the debug levers exist in this environment (the `RESET_ENABLED`
// flag). The admin reads it to decide whether to render the Debug surface; the server stays the
// authority (every reset route enforces the flag regardless).
export const resetCapabilityResponseSchema = z.object({ enabled: z.boolean() })
export type ResetCapabilityResponse = z.infer<typeof resetCapabilityResponseSchema>

// POST /api/admin/reset/undraw — undraw one competition (deletes its draw record + matches, all
// brackets), returning it to „not drawn". `undrawn` is the number of draw records removed (0 when the
// field was not drawn — an idempotent no-op, not an error).
export const undrawRequestSchema = z.object({
  competition: z.enum(competitionSlug.options, { error: 'Ungültige Konkurrenz.' })
})
export type UndrawRequest = z.infer<typeof undrawRequestSchema>

export const undrawResponseSchema = z.object({ ok: z.literal(true), undrawn: z.number().int().nonnegative() })
export type UndrawResponse = z.infer<typeof undrawResponseSchema>

// POST /api/admin/reset/readmit — set every `confirmed` entry back to `new` (leaving `new` and
// `cancelled` untouched). Refused while any draw exists (a drawn player cannot be un-confirmed). On
// success `readmitted` is the number of rows moved back to `new`.
export const readmitResponseSchema = z.object({ ok: z.literal(true), readmitted: z.number().int().nonnegative() })
export type ReadmitResponse = z.infer<typeof readmitResponseSchema>

// POST /api/admin/reset/back-to-signup — cascade an undraw of every competition, then set the phase
// back to `signup`. Registration status is left untouched (confirmed entries are valid during
// signup; readmit is the separate lever). `undrawn` is how many draw records the cascade removed.
export const backToSignupResponseSchema = z.object({
  ok: z.literal(true),
  phase: z.literal('signup'),
  undrawn: z.number().int().nonnegative()
})
export type BackToSignupResponse = z.infer<typeof backToSignupResponseSchema>
