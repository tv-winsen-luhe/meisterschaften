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
