import { z } from 'zod'
import { CLUBS, clubSchema } from './club'
import { competitionSlug } from './competition'
import { BRACKETS, MATCH_OUTCOMES, MATCH_STATUSES, REVEAL_KINDS, seedingEntrySchema } from './draw'
import { REGISTRATION_STATUSES } from './registration'
import { SCHEDULE } from './schedule'

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
// outcome 'bye', §31) and otherwise stay null until results land. `court`/`day`/`slot` are the schedule
// placement (ADR-0005) — all null until the operator places the match on the grid (#88), where they
// travel together; `status` is the live signal (ADR-0032), `planned` until result entry moves it (#90).
export const matchSchema = z.object({
  id: z.number().int().positive(),
  competition: competitionSlug,
  bracket: z.enum(BRACKETS),
  round: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  slot1RegId: z.number().int().positive().nullable(),
  slot2RegId: z.number().int().positive().nullable(),
  winnerRegId: z.number().int().positive().nullable(),
  outcome: z.enum(MATCH_OUTCOMES).nullable(),
  court: z.number().int().min(1).max(SCHEDULE.courts).nullable(),
  day: z
    .number()
    .int()
    .min(0)
    .max(SCHEDULE.days - 1)
    .nullable(),
  slot: z
    .number()
    .int()
    .min(0)
    .max(SCHEDULE.slotsPerDay - 1)
    .nullable(),
  status: z.enum(MATCH_STATUSES)
})
export type Match = z.infer<typeof matchSchema>

// The frozen seed shape (seedingEntrySchema) is owned by the draw module (it produces it) and parsed
// at the store's JSON seam; the wire contract composes that one schema rather than re-declaring it, so
// the API shape and the draw output can never drift.

// A drawn competition as the surface shows it: the field, its draw size, the frozen seeding, and the
// materialized bracket — plus the reveal cursor + total. The surface withholds the bracket until the show
// has fully revealed it (cursor === total), so projecting the admin can't spoil the draw; until then it
// shows only the reveal progress. The show itself still plays back from the cursor-sliced public reveal
// (GET /api/draw), not these matches.
export const competitionDrawSchema = z.object({
  competition: competitionSlug,
  bracket: z.enum(BRACKETS),
  size: z.number().int().positive(),
  // How many reveal steps the show has revealed, and the total step count — the reveal progress the
  // surface reads to gate the bracket (cursor === total ⇒ fully revealed) and show „x/y enthüllt".
  cursor: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
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

// ── Lot-by-lot reveal (ADR-0003, issue #70) ────────────────────────────────────────────────────
// The draw is precomputed atomically, then revealed lot step by lot step (ADR-0003): the reveal cursor
// (how many steps have been shown) advances over the stored reveal sequence — pure playback, never a
// re-roll. The advance is an operator action (the show control is issue #71); the public live bracket
// polls the reveal below.

// POST /api/admin/draw/advance — move the reveal cursor one step forward/back over the main bracket's
// reveal sequence (the only bracket with a reveal show — the consolation bracket publishes directly,
// ADR-0004). Clamped at the route to [0, total]; never re-draws (ADR-0003). `direction` is the lot the
// operator reveals next (forward) or a correction back.
export const advanceRequestSchema = z.object({
  competition: z.enum(competitionSlug.options, { error: 'Ungültige Konkurrenz.' }),
  direction: z.enum(['forward', 'back'], { error: 'Ungültige Richtung.' })
})
export type AdvanceRequest = z.infer<typeof advanceRequestSchema>

// The cursor after the move and the total step count — so the show control knows the bounds (start at
// 0, fully revealed at total).
export const advanceResponseSchema = z.object({
  ok: z.literal(true),
  cursor: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
})
export type AdvanceResponse = z.infer<typeof advanceResponseSchema>

// ── Public live bracket (GET /api/draw) ─────────────────────────────────────────────────────────
// The public draw reveal show polls this (~1–2 s) and renders the bracket *revealed up to the cursor*.
// It is the reveal sequence with each step's player joined in by name + LK (the matches carry only ids),
// plus the cursor and total — enough to render the main bracket's first-round reveal. The bracket *shape*
// (rounds, seed lines) is derived from `size` via the shared bracketStructure (ADR-0025) — there is no
// second topology here. Public like /api/participants and /api/phase; empty until a field is drawn.

// One reveal step as the public show consumes it: the line it places and what lands there. A `bye` step
// (kind 'bye') marks an empty line — `player` is null and the line shows „Freilos". A seeded step
// (seed-fixed/seed-lot) carries its seed number; an unseeded `draw` step has none. The player display
// is null only for a lot-bye line (the §32.4c remaining bye, no player yet); every placed step carries
// its player joined from the registration row the slot references.
export const revealStepPlayerSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  lk: z.string().nullable()
})
export const publicRevealStepSchema = z.object({
  kind: z.enum(REVEAL_KINDS),
  position: z.number().int().nonnegative(),
  seed: z.number().int().positive().nullable(),
  player: revealStepPlayerSchema.nullable()
})
export type PublicRevealStep = z.infer<typeof publicRevealStepSchema>

// One competition's reveal state: its draw size (the bracket shape), the cursor (how many steps are
// shown), the total step count, and the reveal steps. The reveal show is the main bracket only.
export const publicDrawSchema = z.object({
  competition: competitionSlug,
  size: z.number().int().positive(),
  cursor: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  steps: z.array(publicRevealStepSchema)
})
export type PublicDraw = z.infer<typeof publicDrawSchema>

export const publicDrawsResponseSchema = z.object({ draws: z.array(publicDrawSchema) })
export type PublicDrawsResponse = z.infer<typeof publicDrawsResponseSchema>

// ── Schedule (ADR-0005, issue #88) ──────────────────────────────────────────────────────────────
// The grid placement contract and the public schedule feed. The admin grid reads matches (with their
// placement) from the draws response above (matchSchema now carries court/day/slot/status); this
// section adds the *place/move* write and the public *read*. Validation of a placement (feeder order,
// court cap, rest gaps — ADR-0033) is #89's `validatePlacement`; this tracer places without it.

// A grid placement: a court (1..6) and a slot (event day 0/1 + 30-minute start-slot index; a 90-minute
// match spans three, ADR-0040). The three travel as one unit (a half-placement is meaningless), so
// nesting them makes the all-or-nothing structural — `placement: null` is the backlog, a full object is
// a cell. Mirrors the shared `Placement` interface (shared/schedule.ts) the store's `placeMatch` speaks.
export const placementSchema = z.object({
  court: z.number('Ungültiger Platz.').int().min(1).max(SCHEDULE.courts),
  day: z
    .number('Ungültiger Tag.')
    .int()
    .min(0)
    .max(SCHEDULE.days - 1),
  slot: z
    .number('Ungültige Zeit.')
    .int()
    .min(0)
    .max(SCHEDULE.slotsPerDay - 1)
})

// POST /api/admin/match/place — place a match into a court-slot cell, move it to another, or clear it
// back to the backlog (placement null). The nested object is rejected unless court+day+slot all agree.
export const placeMatchRequestSchema = z.object({ id, placement: placementSchema.nullable() })
export type PlaceMatchRequest = z.infer<typeof placeMatchRequestSchema>
export const placeMatchResponseSchema = z.object({ ok: z.literal(true) })
export type PlaceMatchResponse = z.infer<typeof placeMatchResponseSchema>

// What occupies one slot of a scheduled match on the public schedule: a known player (joined by name),
// an empty round-1 bye line („Freilos"), a not-yet-decided feeder labelled by the match it waits on
// („Sieger M{matchNumber}"), or an `unknown` slot („offen") — the graceful degrade when a feeder cannot
// be resolved (ADR-0035). `matchNumber` stays `.positive()`: a real feeder number always is, and the
// degraded case is its own kind rather than a `0` sentinel that would 500 the whole feed. The server
// resolves the shared SlotView (shared/schedule.ts) and joins the player name, so the public page
// renders without the registration list.
export const scheduleSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('player'), firstName: z.string(), lastName: z.string() }),
  z.object({ kind: z.literal('bye') }),
  z.object({ kind: z.literal('feeder'), matchNumber: z.number().int().positive() }),
  z.object({ kind: z.literal('unknown') })
])
export type ScheduleSlot = z.infer<typeof scheduleSlotSchema>

// One placed match as the public schedule shows it: its court + slot (the page derives the „ca." time
// from the slot), its live status, its display number (M{number}), its round + the bracket's total round
// count (so both surfaces derive the round label „Achtelfinale"… via the shared `roundLabel`, #142), and
// its two resolved slots. Only placed, real matches appear (a bye is auto-resolved, never played, so it
// is never scheduled). `round`/`totalRounds` are numeric (English/data, ADR-0028) — the German label is
// computed at the edge, never carried on the wire.
export const scheduleMatchSchema = z.object({
  id: z.number().int().positive(),
  competition: competitionSlug,
  bracket: z.enum(BRACKETS),
  number: z.number().int().positive(),
  round: z.number().int().positive(),
  totalRounds: z.number().int().positive(),
  court: z.number().int().min(1).max(SCHEDULE.courts),
  day: z
    .number()
    .int()
    .min(0)
    .max(SCHEDULE.days - 1),
  slot: z
    .number()
    .int()
    .min(0)
    .max(SCHEDULE.slotsPerDay - 1),
  status: z.enum(MATCH_STATUSES),
  slot1: scheduleSlotSchema,
  slot2: scheduleSlotSchema
})
export type ScheduleMatch = z.infer<typeof scheduleMatchSchema>

// GET /api/schedule — the public schedule feed (ADR-0041): the global publish flag plus the placed
// matches the spectator may see. The page groups by day and orders by slot/court. Public like /api/draw.
// `published` false ⇒ the planned schedule is withheld and the page shows „noch nicht veröffentlicht";
// a running/done match's live truth is served regardless (the plan gate, never a feed kill).
export const scheduleResponseSchema = z.object({ published: z.boolean(), matches: z.array(scheduleMatchSchema) })
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>

// GET /api/admin/schedule — the operator's lightweight publish-state read (ADR-0041): just the global
// flag, so the admin's publish control reflects it on mount without resolving the whole public schedule
// feed. Operator endpoint (behind Access); distinct from the public, gated GET /api/schedule.
export const scheduleStateResponseSchema = z.object({ published: z.boolean() })
export type ScheduleStateResponse = z.infer<typeof scheduleStateResponseSchema>

// POST /api/admin/schedule/publish — reveal the whole planned schedule at once (ADR-0041). No body; the
// flag is global. Returns the resulting state — always published (there is no manual unpublish; only
// „Zurücksetzen" flips it back).
export const schedulePublishResponseSchema = z.object({ ok: z.literal(true), published: z.literal(true) })
export type SchedulePublishResponse = z.infer<typeof schedulePublishResponseSchema>

// POST /api/admin/schedule/reset — clear every `planned` placement back to the backlog and auto-unpublish
// (ADR-0041). No body; confirm-guarded in the admin (the confirm escalates when a match is already
// running/done — those keep their court). The draw, brackets, and results stay intact.
export const scheduleResetResponseSchema = z.object({ ok: z.literal(true), published: z.literal(false) })
export type ScheduleResetResponse = z.infer<typeof scheduleResetResponseSchema>
