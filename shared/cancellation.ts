import { z } from 'zod'
import { COMPETITION_SLUGS, competitionSlug, type CompetitionSlug } from './competition'

// Competition cancellation (CONTEXT: Competition cancellation; ADR-0062) — the one place that answers
// „does this competition take place?" and derives „which ones still count".
//
// A competition that drew too few entries does not happen, and is removed from every public surface. The
// authority is the operator, never the count: the cancelled set is an explicit per-competition act stored
// on the `app_state` singleton row, and it travels on GET /api/phase — one poll, one signal, read by every
// public projection rather than re-derived (the ADR-0048 stance).
//
// The load-bearing difference to `strengthRedacted`, the other per-competition switch: that list is an
// **editorial** decision and therefore a module constant in the code, while this set is **operator state**
// and therefore comes in as a parameter. Nothing here reads a store or a constant list of cancelled
// slugs — these are pure functions of the set they are handed.

// The wire form of the set: an array of competition slugs. An unknown slug is rejected here, which is
// what makes a hand-edited or stale persisted value degrade to „nothing cancelled" rather than leak
// through (the Store's fail-closed read parses against this).
export const cancelledCompetitionsSchema = z.array(competitionSlug)

/**
 * Is this competition cancelled? `competition` is a plain string (a persisted registration/match row
 * speaks `string`, the wire contracts narrow to CompetitionSlug), so every projection can ask the same
 * question about the rows it holds.
 */
export const isCancelledCompetition = (cancelled: readonly string[], competition: string): boolean =>
  cancelled.includes(competition)

/**
 * Which competitions still count — every slug the event offers minus the cancelled ones, in the
 * canonical COMPETITION_SLUGS order. The helper for a surface that starts from the *static* list
 * (the front door's cards, a competition filter) rather than from served rows.
 */
export const activeCompetitions = (cancelled: readonly string[]): CompetitionSlug[] =>
  COMPETITION_SLUGS.filter(slug => !isCancelledCompetition(cancelled, slug))

// POST /api/admin/competition/cancel — the operator cancels one competition, or takes the cancellation
// back. A plain reversible toggle: cancelling materializes nothing, so there is nothing to reconcile on
// the way back. The enum rejects an unknown slug at the edge.
export const setCompetitionCancelledRequestSchema = z.object({
  competition: z.enum(COMPETITION_SLUGS, { error: 'Unbekannte Konkurrenz.' }),
  cancelled: z.boolean()
})
export type SetCompetitionCancelledRequest = z.infer<typeof setCompetitionCancelledRequestSchema>

export const setCompetitionCancelledResponseSchema = z.object({
  ok: z.literal(true),
  cancelledCompetitions: cancelledCompetitionsSchema
})
export type SetCompetitionCancelledResponse = z.infer<typeof setCompetitionCancelledResponseSchema>

// The operator-facing reason a cancellation is refused: a drawn field owns a `draws` row, materialized
// `matches` and possibly schedule placements — hiding that behind a flag would leave exactly the phantom
// load the court-budget exclusion exists to prevent. The path is draw reset (ADR-0029), then cancel.
export const CANCEL_DRAWN_REASON =
  'Diese Konkurrenz ist bereits ausgelost. Erst die Auslosung zurücksetzen, dann absagen.'
