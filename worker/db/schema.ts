import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core'

// Mirrors the existing `registrations` table 1:1 (no column changes). camelCase in
// TS, snake_case in D1 — the only naming translation, done here in the column mapping;
// above this line everything is camelCase, below it snake_case (no hand converters).
export const registrations = sqliteTable(
  'registrations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    createdAt: text('created_at').notNull(),
    competition: text('competition').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    club: text('club').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    note: text('note'),
    playerId: text('player_id'),
    lk: text('lk'),
    status: text('status').notNull().default('new'),
    ip: text('ip')
  },
  table => [index('idx_registrations_status').on(table.status), index('idx_registrations_player_id').on(table.playerId)]
)

export type RegistrationRow = typeof registrations.$inferSelect
export type NewRegistrationRow = typeof registrations.$inferInsert

// The single-row app-state record (ADR-0006): the master switch every public surface keys
// off and the only value the weekly cron is gated on. One row, pinned at id = 1 — the Store
// reads/writes that row and treats its absence as the `anmeldung` default, so the migration
// stays pure DDL (no data seed). `phase` is validated against the shared Phase enum above
// this layer; the column itself is a plain text default to keep migration generation
// decoupled from the Zod contract.
export const appState = sqliteTable('app_state', {
  id: integer('id').primaryKey(),
  phase: text('phase').notNull().default('anmeldung')
})

export type AppStateRow = typeof appState.$inferSelect
