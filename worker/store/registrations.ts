import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm'
import { DEFAULT_LK } from '../../shared'
import { registrations, type NewRegistrationRow, type RegistrationRow } from '../db/schema'

// A confirmed participant as the public list needs it (camelCase, contract shape).
export interface ConfirmedParticipant {
  firstName: string
  lastName: string
  club: string
  competition: string
  lk: string | null
}

// A person within a single Konkurrenz — the key the registration lifecycle matches on.
// email + lastName are compared case-insensitively (the legacy COLLATE NOCASE behaviour).
export interface PersonInCompetition {
  email: string
  lastName: string
  competition: string
}

// A person across all Konkurrenzen — the key a self-service cancellation matches on:
// one cancel withdraws every active entry for this email + last name. Compared
// case-insensitively, like PersonInCompetition.
export interface Person {
  email: string
  lastName: string
}

// A fresh registration as the domain hands it to the Store (status starts at 'new';
// playerId/lk fill in later via the LK match). Mirrors what the legacy INSERT bound.
export interface NewRegistration {
  createdAt: string
  competition: string
  firstName: string
  lastName: string
  club: string
  email: string
  phone: string | null
  note: string | null
  ip: string | null
}

// The fields a revive overwrites on a previously cancelled row — exactly what the legacy
// revive UPDATE set. It deliberately leaves email/competition (the match key) and the
// player_id/lk linkage intact.
export interface ReviveFields {
  createdAt: string
  firstName: string
  lastName: string
  club: string
  phone: string | null
  note: string | null
  ip: string | null
}

// The deep registrations Store. Callers speak domain operations; Drizzle/SQL never
// leaks past this interface. Two adapters back it: D1/Drizzle (prod) and in-memory
// (tests). It grows one transition per slice.
export interface RegistrationsStore {
  /**
   * Confirmed entries for the public list, ordered as the participant list expects:
   * by Konkurrenz, then ascending seeding LK (missing LK counts as DEFAULT_LK), then
   * registration time. The seeding order is load-bearing for the provisional Setzliste.
   */
  listConfirmed(): Promise<ConfirmedParticipant[]>

  /** The still-active entry (new/confirmed) for this person+Konkurrenz, or null. */
  findActiveRegistration(person: PersonInCompetition): Promise<RegistrationRow | null>

  /** A previously cancelled entry for this person+Konkurrenz that a re-registration revives, or null. */
  findCancelledRegistration(person: PersonInCompetition): Promise<RegistrationRow | null>

  /** Insert a new registration and return the persisted row. */
  insert(data: NewRegistration): Promise<RegistrationRow>

  /** Revive a cancelled row back to 'new' with refreshed contact fields; returns the row. */
  revive(id: number, fields: ReviveFields): Promise<RegistrationRow>

  /** Link a row to its nuLiga player id + LK in one write (the LK match). */
  setMatch(id: number, playerId: string, lk: string): Promise<void>

  /**
   * Withdraw every still-active (new/confirmed) entry matching this person across all
   * Konkurrenzen, flipping each to 'cancelled'. Returns the rows that were cancelled
   * (for the cancellation notification); an empty array means nothing matched.
   */
  cancelActiveByPerson(person: Person): Promise<RegistrationRow[]>

  /** Registrations from this IP since the given ISO timestamp — the soft rate-limit input. */
  countRecentByIp(ip: string, sinceIso: string): Promise<number>
}

export const createD1RegistrationsStore = (d1: D1Database): RegistrationsStore => {
  const db = drizzle(d1)

  // email + lastName compared case-insensitively (COLLATE NOCASE), competition exact —
  // the legacy match key for revive/uniqueness.
  const personWhere = (person: PersonInCompetition) =>
    and(
      sql`${registrations.email} = ${person.email} collate nocase`,
      sql`${registrations.lastName} = ${person.lastName} collate nocase`,
      eq(registrations.competition, person.competition)
    )

  const findOne = async (where: ReturnType<typeof personWhere>): Promise<RegistrationRow | null> => {
    const rows = await db.select().from(registrations).where(where).limit(1)
    return rows[0] ?? null
  }

  // The cancel match key: email + lastName case-insensitively, across all Konkurrenzen.
  const emailLastNameWhere = (person: Person) =>
    and(
      sql`${registrations.email} = ${person.email} collate nocase`,
      sql`${registrations.lastName} = ${person.lastName} collate nocase`
    )

  return {
    async listConfirmed() {
      return db
        .select({
          firstName: registrations.firstName,
          lastName: registrations.lastName,
          club: registrations.club,
          competition: registrations.competition,
          lk: registrations.lk
        })
        .from(registrations)
        .where(eq(registrations.status, 'confirmed'))
        .orderBy(
          asc(registrations.competition),
          sql`CAST(COALESCE(${registrations.lk}, ${DEFAULT_LK}) AS REAL) ASC`,
          asc(registrations.createdAt)
        )
    },

    findActiveRegistration(person) {
      return findOne(and(personWhere(person), inArray(registrations.status, ['new', 'confirmed'])))
    },

    findCancelledRegistration(person) {
      return findOne(and(personWhere(person), eq(registrations.status, 'cancelled')))
    },

    async insert(data) {
      const values: NewRegistrationRow = { ...data, status: 'new' }
      const rows = await db.insert(registrations).values(values).returning()
      return rows[0]
    },

    async revive(id, fields) {
      const rows = await db
        .update(registrations)
        .set({ status: 'new', ...fields })
        .where(eq(registrations.id, id))
        .returning()
      return rows[0]
    },

    async setMatch(id, playerId, lk) {
      await db.update(registrations).set({ playerId, lk }).where(eq(registrations.id, id))
    },

    async cancelActiveByPerson(person) {
      // One UPDATE … RETURNING flips the matching active rows and hands them back — no
      // SELECT-then-UPDATE race, and the returned rows carry the facts the notifier needs.
      return db
        .update(registrations)
        .set({ status: 'cancelled' })
        .where(and(emailLastNameWhere(person), inArray(registrations.status, ['new', 'confirmed'])))
        .returning()
    },

    async countRecentByIp(ip, sinceIso) {
      const rows = await db
        .select({ c: count() })
        .from(registrations)
        .where(and(eq(registrations.ip, ip), gt(registrations.createdAt, sinceIso)))
      return rows[0]?.c ?? 0
    }
  }
}

// The in-memory adapter holds whole rows so the write transitions have something to
// mutate; tests seed it and drive the domain/seedingLk through their interfaces.
export const createInMemoryRegistrationsStore = (seed: RegistrationRow[] = []): RegistrationsStore => {
  const rows = [...seed]
  let nextId = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1

  // Match the D1 adapter's SQL `CAST(COALESCE(lk, DEFAULT_LK) AS REAL)`: SQLite casts a
  // non-numeric string to 0.0, so coerce NaN → 0 (parseFloat alone would yield NaN and
  // sort differently). Keeps the test double faithful to production ordering.
  const seedingLk = (lk: string | null) => {
    const n = parseFloat(lk ?? DEFAULT_LK)
    return Number.isNaN(n) ? 0 : n
  }

  const eqCi = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const matchesPerson = (r: RegistrationRow, person: PersonInCompetition) =>
    eqCi(r.email, person.email) && eqCi(r.lastName, person.lastName) && r.competition === person.competition
  const byId = (id: number) => {
    const row = rows.find(r => r.id === id)
    if (!row) throw new Error(`registration ${id} not found`)
    return row
  }

  return {
    async listConfirmed() {
      return rows
        .filter(r => r.status === 'confirmed')
        .sort(
          (a, b) =>
            a.competition.localeCompare(b.competition) ||
            seedingLk(a.lk) - seedingLk(b.lk) ||
            a.createdAt.localeCompare(b.createdAt)
        )
        .map(r => ({
          firstName: r.firstName,
          lastName: r.lastName,
          club: r.club,
          competition: r.competition,
          lk: r.lk
        }))
    },

    async findActiveRegistration(person) {
      return rows.find(r => matchesPerson(r, person) && (r.status === 'new' || r.status === 'confirmed')) ?? null
    },

    async findCancelledRegistration(person) {
      return rows.find(r => matchesPerson(r, person) && r.status === 'cancelled') ?? null
    },

    async insert(data) {
      const row: RegistrationRow = { id: nextId++, playerId: null, lk: null, status: 'new', ...data }
      rows.push(row)
      return row
    },

    async revive(id, fields) {
      const row = byId(id)
      Object.assign(row, { status: 'new', ...fields })
      return row
    },

    async setMatch(id, playerId, lk) {
      const row = byId(id)
      row.playerId = playerId
      row.lk = lk
    },

    async cancelActiveByPerson(person) {
      const matched = rows.filter(
        r =>
          eqCi(r.email, person.email) &&
          eqCi(r.lastName, person.lastName) &&
          (r.status === 'new' || r.status === 'confirmed')
      )
      matched.forEach(r => (r.status = 'cancelled'))
      return matched
    },

    async countRecentByIp(ip, sinceIso) {
      return rows.filter(r => r.ip === ip && r.createdAt > sinceIso).length
    }
  }
}
