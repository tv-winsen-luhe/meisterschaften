import { z } from 'zod'
import { CLUBS, clubSchema } from './club'
import { competitionSlug } from './competition'
import { BRACKETS, ENTERED_OUTCOMES, MATCH_OUTCOMES, MATCH_STATUSES, REVEAL_KINDS, seedingEntrySchema } from './draw'
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

// One set's score as the two slots' games (or, for the Match-Tie-Break, points): `[slot1, slot2]`,
// each a small non-negative integer. The pair travels together — a single number is meaningless — so the
// tuple makes „both or neither" structural; a set not (yet) played is `null` (the whole tuple), never a
// half-filled pair. The max is loose on purpose (operator-entered, not a scoring engine): a tennis set
// caps near 7 and an MTB near the high teens, so 99 is a typo guard, not a rule.
const setScore = z.tuple([z.number().int().min(0).max(99), z.number().int().min(0).max(99)])

// A match's score (ADR-0032): best-of-2 sets + a Match-Tie-Break at 1:1, the universal shape across every
// competition. Each field is that set's `[slot1, slot2]` pair, or `null` when not played — so the common
// straight-sets case carries `set1` + `set2` with `mtb` null, a 1:1 split adds the `mtb`, and a walkover/
// bye carries all-null. The store reads/writes this from the fixed set columns (set1/set2/MTB × slot).
export const matchScoreSchema = z.object({
  set1: setScore.nullable(),
  set2: setScore.nullable(),
  mtb: setScore.nullable()
})
export type MatchScore = z.infer<typeof matchScoreSchema>

// One match row as the bracket exposes it. Slots are registration ids (the names are joined client
// -side from the admin list); a round-1 slot is a player (or null for a bye), a later-round slot is a
// not-yet-decided feeder (null). `winnerRegId`/`outcome` are set for a round-1 bye (winner advanced,
// outcome 'bye', §31) and once results land (§90). `court`/`day`/`slot` are the planned schedule
// placement (ADR-0005) — all null until the operator places the match on the grid (#88), where they
// travel together; `status` is the live signal (ADR-0032), `planned` until result entry moves it. The
// Live phase (#90) adds `thirdPlace` (the playoff fed by the semifinal losers), `liveCourt` (the actual
// court captured at the `running` transition — may differ from the planned court, read by the public
// board with a fallback to `court`), and `score` (the fixed best-of-2 + MTB columns).
export const matchSchema = z.object({
  id: z.number().int().positive(),
  competition: competitionSlug,
  bracket: z.enum(BRACKETS),
  round: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  thirdPlace: z.boolean(),
  slot1RegId: z.number().int().positive().nullable(),
  slot2RegId: z.number().int().positive().nullable(),
  winnerRegId: z.number().int().positive().nullable(),
  outcome: z.enum(MATCH_OUTCOMES).nullable(),
  score: matchScoreSchema,
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
  status: z.enum(MATCH_STATUSES),
  liveCourt: z.number().int().min(1).max(SCHEDULE.courts).nullable()
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

// POST /api/admin/draw/consolation — draw the consolation bracket (de: „Nebenrunde auslosen", ADR-0004).
// Mirrors the main draw request (just the competition); no Challenger cap rides along — the entrants are a
// subset of the already-admitted main field, so no new cap check binds. The gate ("all first matches
// decided", "not already drawn") is the shared `consolationBlocker`, enforced at the route.
export const consolationDrawRequestSchema = z.object({
  competition: z.enum(competitionSlug.options, { error: 'Ungültige Konkurrenz.' })
})
export type ConsolationDrawRequest = z.infer<typeof consolationDrawRequestSchema>

// The drawn consolation bracket, the same assembled shape as the main draw response (bracket
// 'consolation'). Published directly, with no reveal — its `total` is 0, so it reads as fully revealed.
export const consolationDrawResponseSchema = z.object({ ok: z.literal(true), draw: competitionDrawSchema })
export type ConsolationDrawResponse = z.infer<typeof consolationDrawResponseSchema>

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
  // The third-place playoff's open slots wait on a semifinal *loser* („Verlierer M{n}", #90), distinct from
  // a winner-feeder so the public copy reads correctly and the admin grid never flags it „offen".
  z.object({ kind: z.literal('loser'), matchNumber: z.number().int().positive() }),
  z.object({ kind: z.literal('unknown') })
])
export type ScheduleSlot = z.infer<typeof scheduleSlotSchema>

// One placed match as the public schedule shows it: its court + slot (the page derives the „ca." time
// from the slot), its live status, its display number (M{number}), its round + position (the bracket
// topology the public draw joins on to annotate each matchup, #159) + the bracket's total round count (so
// both surfaces derive the round label „Achtelfinale"… via the shared `roundLabel`, #142), its two
// resolved slots, and — once play begins — its live result (#91). Only placed, real matches appear (a bye
// is auto-resolved, never played, so it is never scheduled). `round`/`position`/`totalRounds` are numeric
// (English/data, ADR-0028) — the German label is computed at the edge, never carried on the wire.
export const scheduleMatchSchema = z.object({
  id: z.number().int().positive(),
  competition: competitionSlug,
  bracket: z.enum(BRACKETS),
  number: z.number().int().positive(),
  round: z.number().int().positive(),
  // Whether this is the third-place playoff (de: „Spiel um Platz 3"), which shares the final's round —
  // so the page can label it correctly instead of deriving „Finale" from round === totalRounds (#90).
  thirdPlace: z.boolean(),
  // The 0-based bracket position within the round — the topology address the public draw looks each node
  // up by (#159). Numbered round-major like `number`, but carried explicitly so the join keys on topology.
  position: z.number().int().min(0),
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
  // The live result, so the board shows what happened without a second fetch (#91, ADR-0032): the winning
  // **slot** (1/2, so the page bolds the winner without a regId join; null until the match is decided), the
  // entered `outcome` (walkover/retirement, or null for a normal scored result — a `bye` never reaches the
  // feed, it is filtered upstream), and the best-of-2 + MTB `score`. `score` is carried even while
  // `running` so an opportunistically-saved set („Satz 1: 6:3") shows before the match is over (§20).
  winner: z.union([z.literal(1), z.literal(2)]).nullable(),
  outcome: z.enum(ENTERED_OUTCOMES).nullable(),
  score: matchScoreSchema,
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

// ── Result entry + bracket advancement (ADR-0032, ADR-0026, issue #90) ────────────────────────────
// The operator records what happened on court and the bracket moves itself. Three writes, all under
// /api/admin/* (behind Access): the live status transition (with the actual court), the result (which
// advances the winner and routes a semifinal loser to the third-place playoff), and an opportunistic
// per-set save while a match is ongoing. The winner is sent as the **slot** that won (1/2), not a regId —
// the server resolves it against the match's own slots, so a winner outside the match cannot be sent.

// The winning slot of a match: 1 or 2. Sent instead of a registration id so the result is always one of
// the match's two players (the server reads the slot's regId); `winner` over `winnerRegId` makes that
// structural. A literal union, not a number range, so anything but 1/2 is rejected.
const winnerSlot = z.union([z.literal(1), z.literal(2)], { error: 'Ungültiger Sieger.' })

// POST /api/admin/match/status — move a match's live status (ADR-0032). `liveCourt` is the **actual** court
// the match is on; it is required when going `running` (the operator picks it, defaulting client-side to the
// planned court) and ignored otherwise. The status enum is the shared MATCH_STATUSES (English wire values).
export const matchStatusRequestSchema = z.object({
  id,
  status: z.enum(MATCH_STATUSES, { error: 'Ungültiger Status.' }),
  liveCourt: z.number().int().min(1).max(SCHEDULE.courts).optional()
})
export type MatchStatusRequest = z.infer<typeof matchStatusRequestSchema>
export const matchStatusResponseSchema = z.object({ ok: z.literal(true) })
export type MatchStatusResponse = z.infer<typeof matchStatusResponseSchema>

// POST /api/admin/match/result — record (or correct) a completed result, advancing the bracket (ADR-0026).
// `winner` is the winning slot; `outcome` is null for a normal scored result, or walkover/retirement for a
// special one (a `bye` is never entered — it auto-resolves at draw time). `score` carries the set columns:
// a normal result fills `set1`+`set2` (+`mtb` at 1:1), a walkover carries all-null, a retirement its
// partial score. The server resolves the winner's regId, applies the pure Advancement transform (winner →
// parent, semifinal loser → third place), and — when the winner changes — cascade-clears dependent results.
export const matchResultRequestSchema = z.object({
  id,
  winner: winnerSlot,
  outcome: z.enum(ENTERED_OUTCOMES, { error: 'Ungültiges Ergebnis.' }).nullable(),
  score: matchScoreSchema
})
export type MatchResultRequest = z.infer<typeof matchResultRequestSchema>
export const matchResultResponseSchema = z.object({ ok: z.literal(true) })
export type MatchResultResponse = z.infer<typeof matchResultResponseSchema>

// The set a per-set save targets: 1 or 2 for the two sets, 3 for the Match-Tie-Break (the 1:1 decider).
const setIndex = z.union([z.literal(1), z.literal(2), z.literal(3)], { error: 'Ungültiger Satz.' })

// POST /api/admin/match/set — opportunistically save (or clear) one set's score while a match is ongoing
// (ADR-0032 §20), so the live board can show „Satz 1: 6:3 · Satz 2 läuft". It never resolves the match —
// no winner, no advancement; that is the result endpoint. `score` null clears the set back to unplayed.
export const matchSetRequestSchema = z.object({
  id,
  set: setIndex,
  score: setScore.nullable()
})
export type MatchSetRequest = z.infer<typeof matchSetRequestSchema>
export const matchSetResponseSchema = z.object({ ok: z.literal(true) })
export type MatchSetResponse = z.infer<typeof matchSetResponseSchema>
