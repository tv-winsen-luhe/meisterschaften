import { sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { MatchStatus, RegistrationStatus } from '../../shared'

// Mirrors the `registrations` table. camelCase in TS, snake_case in D1 — the only naming
// translation, done here in the column mapping; above this line everything is camelCase, below it
// snake_case (no hand converters).
export const registrations = sqliteTable(
  'registrations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    createdAt: text('created_at').notNull(),
    // Last write of any kind (status change, operator edit, or an actual LK change from the weekly
    // sync) — the Store stamps it on every value-changing write, and to createdAt on insert. The
    // backfill migration sets it = created_at for pre-existing rows, so it is effectively never null.
    updatedAt: text('updated_at'),
    competition: text('competition').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    club: text('club').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    note: text('note'),
    playerId: text('player_id'),
    lk: text('lk'),
    status: text('status').$type<RegistrationStatus>().notNull().default('new'),
    ip: text('ip')
  },
  table => [index('idx_registrations_status').on(table.status), index('idx_registrations_player_id').on(table.playerId)]
)

export type RegistrationRow = typeof registrations.$inferSelect
export type NewRegistrationRow = typeof registrations.$inferInsert

// The single-row app-state record (ADR-0006): the master switch every public surface keys
// off and the only value the weekly cron is gated on. One row, pinned at id = 1 — the Store
// reads/writes that row and treats its absence as the `signup` default, so the migration
// stays pure DDL (no data seed). `phase` is validated against the shared Phase enum above
// this layer; the column itself is a plain text default to keep migration generation
// decoupled from the Zod contract.
export const appState = sqliteTable('app_state', {
  id: integer('id').primaryKey(),
  phase: text('phase').notNull().default('signup'),
  // Whether the planned schedule is public (ADR-0041). A global, operator-set flag — off by default — that
  // gates the *planned* public schedule (a not-yet-started match's court/day/slot); the live board's actual
  // court + status are never gated by it. Stored as SQLite 0/1 (`mode: 'boolean'`); it lives beside `phase`
  // because it is the same kind of single-row global state (ADR-0006), not a derivable middle (ADR-0027).
  schedulePublished: integer('schedule_published', { mode: 'boolean' }).notNull().default(false)
})

export type AppStateRow = typeof appState.$inferSelect

// The materialized bracket (ADR-0025): the draw writes real `matches` rows, there is no separate
// bracket blob. A `bracket` discriminator (main/consolation) lets both brackets of a
// competition share one table. Feeders are implicit — a match at (round, position) is fed by
// (round−1, 2·position) and (round−1, 2·position+1), so there are no feeder columns. An empty
// round-1 slot would be a bye; an empty later-round slot is a not-yet-decided feeder — the round
// disambiguates. The draw writes the bracket columns; the Live phase adds the schedule placement
// (court + day + slot) and the live `status` (#88), then the result columns (#90).
export const matches = sqliteTable(
  'matches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    competition: text('competition').notNull(),
    bracket: text('bracket').notNull(),
    round: integer('round').notNull(),
    position: integer('position').notNull(),
    slot1RegId: integer('slot1_reg_id'),
    slot2RegId: integer('slot2_reg_id'),
    winnerRegId: integer('winner_reg_id'),
    outcome: text('outcome'),
    // The third-place playoff (de: „Spiel um Platz 3", CONTEXT: Third-place match): a match materialized at
    // draw time whose two slots are filled by the semifinal **losers** (loser-feeders), not by the implicit
    // winner-feeders the round/position topology expresses. The flag is what marks it, since its feed is
    // unlike every other match's. One per main bracket from four entrants up; null/false everywhere else.
    thirdPlace: integer('third_place', { mode: 'boolean' }).notNull().default(false),
    // Schedule placement (ADR-0005, ADR-0040): the court (1..6) and the slot (event day 0/1 + 30-minute
    // start-slot index; a 90-minute match spans three) the operator placed this match on. All three null
    // ⇒ unscheduled (the grid backlog); they travel together (a half-placed match is meaningless). The
    // column type is unchanged — only the slot's *meaning* narrowed to a 30-minute index (no data
    // migration: no schedule rows exist yet). Validation lives in shared/schedule's `validatePlacement`.
    court: integer('court'),
    day: integer('day'),
    slot: integer('slot'),
    // The live status (ADR-0032): the signal the public board keys off. Defaults to `planned`; result
    // entry moves it (→ running with a live court, → done).
    status: text('status').$type<MatchStatus>().notNull().default('planned'),
    // The **actual** court a running/finished match is on (ADR-0032), captured at the `running` transition —
    // it may differ from the planned `court` (a match often takes whatever court frees up). The public live
    // board reads this, falling back to the planned court before the match starts, so a spectator is never
    // sent to a stale planned court. Null until the match goes running.
    liveCourt: integer('live_court'),
    // The match score (ADR-0032): best-of-2 sets + a Match-Tie-Break at 1:1, universal across every
    // competition, so the shape is fixed columns (set1/set2/MTB × the two slots) — no JSON, no child table
    // (ADR-0021). Each cell is that slot's games (sets) or points (MTB); a null set is one not (yet) played,
    // so the operator can save a completed set opportunistically while a match is ongoing (§20). A bye/
    // walkover carries no score (all null); a retirement keeps its partial score.
    set1Slot1: integer('set1_slot1'),
    set1Slot2: integer('set1_slot2'),
    set2Slot1: integer('set2_slot1'),
    set2Slot2: integer('set2_slot2'),
    mtbSlot1: integer('mtb_slot1'),
    mtbSlot2: integer('mtb_slot2')
  },
  table => [index('idx_matches_competition').on(table.competition)]
)

export type MatchRow = typeof matches.$inferSelect
export type NewMatchRow = typeof matches.$inferInsert

// The draw record (ADR-0003, ADR-0025): the draw-specific data the `matches` aggregate does not need
// — the frozen seeding snapshot, the ordered reveal sequence for playback, and the reveal cursor —
// kept per competition+bracket. Its existence *is* the "already drawn?" lifecycle flag (ADR-0027), so
// (competition, bracket) is unique. `seeding`/`revealSequence` are JSON text (small N, ADR-0021).
export const draws = sqliteTable(
  'draws',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    competition: text('competition').notNull(),
    bracket: text('bracket').notNull(),
    size: integer('size').notNull(),
    seeding: text('seeding').notNull(),
    revealSequence: text('reveal_sequence').notNull(),
    revealCursor: integer('reveal_cursor').notNull().default(0),
    // The Challenger LK cap frozen at the draw (ADR-0024): the threshold the field was judged against,
    // snapshotted here as part of the freeze — no standing DB preference. Null for non-Challenger
    // fields (no cap binds) and for any draw written before this column existed.
    challengerMinLk: integer('challenger_min_lk'),
    createdAt: text('created_at').notNull()
  },
  table => [uniqueIndex('idx_draws_competition_bracket').on(table.competition, table.bracket)]
)

export type DrawRow = typeof draws.$inferSelect
export type NewDrawRow = typeof draws.$inferInsert
