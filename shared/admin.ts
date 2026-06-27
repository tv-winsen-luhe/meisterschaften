import { z } from 'zod'
import { CLUBS, clubSchema } from './club'
import { competitionSlug } from './competition'
import { BRACKETS, MATCH_OUTCOMES, seedingEntrySchema } from './draw'
import { REGISTRATION_STATUSES } from './registration'

// The admin (operator) contract — the single source of truth for the /api/admin/* JSON
// shapes, shared by the worker (server validation) and the React admin (typed `hc`).
// camelCase on the wire (Zod is the contract); the snake_case D1 columns are translated
// once in the Drizzle mapping. The legacy admin spoke snake_case only because it read DB
// columns straight through; the React admin is new, so this endpoint family is camelCase
// from the start.
//
// Field-validation messages mirror the legacy admin handler (behaviour-preserving for the
// operator): same German text, so a malformed edit reports exactly as before.
//
// REGISTRATION_STATUSES / RegistrationStatus now live in registration.ts (the status model is a
// lifecycle fact, not an admin one); this contract imports the value for its wire enum.

// A registration as the admin list shows it — the full row minus the internal `ip` column
// (the legacy admin SELECT never exposed it either).
export const adminRegistrationSchema = z.object({
  id: z.number().int().positive(),
  createdAt: z.string(),
  // Last write of any kind; effectively never null (backfilled + stamped by the Store), but typed
  // nullable to match the column.
  updatedAt: z.string().nullable(),
  competition: competitionSlug,
  firstName: z.string(),
  lastName: z.string(),
  club: clubSchema,
  email: z.string(),
  phone: z.string().nullable(),
  note: z.string().nullable(),
  playerId: z.string().nullable(),
  lk: z.string().nullable(),
  status: z.enum(REGISTRATION_STATUSES)
})
export type AdminRegistration = z.infer<typeof adminRegistrationSchema>

export const adminListResponseSchema = z.object({ registrations: z.array(adminRegistrationSchema) })
export type AdminListResponse = z.infer<typeof adminListResponseSchema>

// A row id — the key every mutation targets.
const id = z.number('Ungültige ID.').int('Ungültige ID.').positive('Ungültige ID.')

// A nuLiga player id is "complete" when it is exactly 8 digits. The single source for both the wire
// contract (the playerId schema below) and the admin's LK-pending prediction (confirm-preview), so
// "what counts as a full id" cannot drift between server validation and the badge.
export const isCompletePlayerId = (value: string): boolean => /^\d{8}$/.test(value)

// An optional player id: empty (= no link / "keine nuLiga-ID") or a complete 8-digit id.
const playerId = z
  .string()
  .trim()
  .refine(v => v === '' || isCompletePlayerId(v), 'Spieler-ID muss 8-stellig sein.')

// Confirm (and re-save a confirmed row): apply the editable fields and move the row to
// 'confirmed'. The LK is never sent — it is derived (ADR-0020): a linked player id has its LK
// fetched from nuLiga by the edge, and `noId` is the explicit "keine nuLiga-ID" choice that seeds
// at the default. The domain runs canConfirm on the resulting basis — the authoritative guard —
// so a confirm with neither a linked id nor the no-id choice is rejected.
export const confirmRequestSchema = z.object({
  id,
  competition: competitionSlug,
  club: z.enum(CLUBS, { error: 'Bitte wähle einen gültigen Verein.' }),
  playerId,
  noId: z.boolean()
})
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>

// lkFetched: the LK pulled from nuLiga when a player id was linked on this save (null when
// none was found / no id given) — the toast feedback the legacy admin showed.
export const confirmResponseSchema = z.object({ ok: z.literal(true), lkFetched: z.string().nullable() })
export type ConfirmResponse = z.infer<typeof confirmResponseSchema>

// Operator cancel, keyed by a single registration id (ADR-0018). Distinct from the public
// self-service cancel (by person, `cancelRequestSchema` in registration.ts): the operator
// records a drop-out who told the desk, sends no member notification, and converges on the
// same terminal `cancelled` state. Same shape the former `hide` carried — a bare id.
export const cancelRegistrationRequestSchema = z.object({ id })
export type CancelRegistrationRequest = z.infer<typeof cancelRegistrationRequestSchema>
export const cancelRegistrationResponseSchema = z.object({ ok: z.literal(true) })
export type CancelRegistrationResponse = z.infer<typeof cancelRegistrationResponseSchema>

export const deleteRequestSchema = z.object({ id })
export type DeleteRequest = z.infer<typeof deleteRequestSchema>
export const deleteResponseSchema = z.object({ ok: z.literal(true), deleted: z.number().int().nonnegative() })
export type DeleteResponse = z.infer<typeof deleteResponseSchema>

export const refreshLkResponseSchema = z.object({ ok: z.literal(true), updated: z.number().int().nonnegative() })
export type RefreshLkResponse = z.infer<typeof refreshLkResponseSchema>

// ── Draw / Competitions (ADR-0025, ADR-0027) ──────────────────────────────────────────────────
// The wire contract for the per-competition draw the competitions surface (UI: „Konkurrenzen") reads and triggers.
// camelCase, like every other contract here; the snake_case D1 columns are translated once in the
// Drizzle mapping. Match rows are the materialized bracket (feeders implicit via round/position).

// One match row as the bracket exposes it. Slots are registration ids (the names are joined client
// -side from the admin list); a round-1 slot is a player (or null for a bye), a later-round slot is a
// not-yet-decided feeder (null). `winnerRegId`/`outcome` are set for a round-1 bye (winner advanced,
// outcome 'bye', §31) and otherwise stay null until results land.
export const matchSchema = z.object({
  id: z.number().int().positive(),
  competition: competitionSlug,
  bracket: z.enum(BRACKETS),
  round: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  slot1RegId: z.number().int().positive().nullable(),
  slot2RegId: z.number().int().positive().nullable(),
  winnerRegId: z.number().int().positive().nullable(),
  outcome: z.enum(MATCH_OUTCOMES).nullable()
})
export type Match = z.infer<typeof matchSchema>

// The frozen seed shape (seedingEntrySchema) is owned by the draw module (it produces it) and parsed
// at the store's JSON seam; the wire contract composes that one schema rather than re-declaring it, so
// the API shape and the draw output can never drift.

// A drawn competition as the surface shows it: the field, its draw size, the frozen seeding, and the
// materialized bracket. (The reveal sequence + cursor live in the draw record but aren't surfaced
// yet — no animation this epic.)
export const competitionDrawSchema = z.object({
  competition: competitionSlug,
  bracket: z.enum(BRACKETS),
  size: z.number().int().positive(),
  seeding: z.array(seedingEntrySchema),
  matches: z.array(matchSchema)
})
export type CompetitionDraw = z.infer<typeof competitionDrawSchema>

// GET /api/admin/draws — every drawn competition (main bracket). The surface combines this with the
// registrations list it already holds to derive each field's "already drawn?" lifecycle.
export const drawsResponseSchema = z.object({ draws: z.array(competitionDrawSchema) })
export type DrawsResponse = z.infer<typeof drawsResponseSchema>

// POST /api/admin/draw — start the draw for one competition (the draw button, UI: „Jetzt auslosen").
// `challengerMinLk` is the operator-tuned Challenger cap snapshotted into the draw record (ADR-0024);
// omitted ⇒ the shared CHALLENGER_MIN_LK default. Only the Challenger field is gated on it. The LK
// scale runs 1.0–25.0, so a positive integer threshold; there is no per-player override path.
export const drawRequestSchema = z.object({
  competition: z.enum(competitionSlug.options, { error: 'Ungültige Konkurrenz.' }),
  challengerMinLk: z.number().int().positive().optional()
})
export type DrawRequest = z.infer<typeof drawRequestSchema>

export const drawResponseSchema = z.object({ ok: z.literal(true), draw: competitionDrawSchema })
export type DrawResponse = z.infer<typeof drawResponseSchema>
