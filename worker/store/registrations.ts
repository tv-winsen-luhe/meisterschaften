import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm'
import { ACTIVE_STATUSES, isActive, seedingValue, type RegistrationStatus } from '../../shared'
import { registrations, type NewRegistrationRow, type RegistrationRow } from '../db/schema'

// The fields the Setzliste order reads — a structural subset both a RegistrationRow and the D1
// projection satisfy, so the one comparator below sorts either.
interface SeedingOrdered {
  competition: string
  lk: string | null
  createdAt: string
}

// The provisional Setzliste order both listConfirmed adapters share: by Konkurrenz, then ascending
// seeding LK (the rule lives in shared/ seedingValue), then registration time. With small N (ADR-0021)
// listConfirmed sorts in JS rather than SQL, so D1 and the in-memory double run *this* one comparator
// — no SQL CAST/COALESCE vs parseFloat pair kept equal by hand.
const bySeedingThenTime = (a: SeedingOrdered, b: SeedingOrdered): number =>
  a.competition.localeCompare(b.competition) ||
  seedingValue(a.lk) - seedingValue(b.lk) ||
  a.createdAt.localeCompare(b.createdAt)

// Narrow any confirmed row (a full RegistrationRow or the D1 projection) to the public list shape,
// in one place so both adapters' listConfirmed project identically — the comparator and the
// projection are now both shared, so the two adapters can't drift on either.
const toConfirmedParticipant = (r: ConfirmedParticipant): ConfirmedParticipant => ({
  firstName: r.firstName,
  lastName: r.lastName,
  club: r.club,
  competition: r.competition,
  lk: r.lk
})

// updated_at is a persistence fact ("when was this row last written"), stamped here on every
// value-changing write rather than threaded through the domain. Insert/revive use the same
// timestamp as created_at; the change transitions use the write moment.
const nowIso = () => new Date().toISOString()

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

// The editable fields the admin can change on a row (competition/club correction, the
// nuLiga linkage). Absent keys are left untouched; an empty-string/null playerId or lk
// clears it. The domain normalises empties to null before persisting.
export interface EditableFields {
  competition?: string
  club?: string
  playerId?: string | null
  lk?: string | null
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

  /**
   * Every registration for the admin list, ordered as the legacy admin SELECT did
   * (status, then Konkurrenz, then registration time). Also the input syncAll walks.
   */
  listAll(): Promise<RegistrationRow[]>

  /** A single row by id, or null. */
  findById(id: number): Promise<RegistrationRow | null>

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

  /** Apply admin field edits (competition/club/playerId/lk) and return the updated row. */
  setFields(id: number, fields: EditableFields): Promise<RegistrationRow>

  /** Move a row to a new lifecycle status and return the updated row. */
  setStatus(id: number, status: RegistrationStatus): Promise<RegistrationRow>

  /** Set (or clear) a row's LK — the per-row write syncAll uses when refreshing. */
  setLk(id: number, lk: string | null): Promise<void>

  /** Hard-delete a row; returns how many rows were removed (0 if the id was unknown). */
  remove(id: number): Promise<number>

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
      // Fetch confirmed rows and sort in JS (ADR-0021, small N) through the shared comparator, so the
      // seeding order is the one in shared/ seedingValue — not a SQL CAST mirrored by hand. createdAt
      // is selected only to feed the tiebreak, then dropped from the public projection.
      const rows = await db
        .select({
          firstName: registrations.firstName,
          lastName: registrations.lastName,
          club: registrations.club,
          competition: registrations.competition,
          lk: registrations.lk,
          createdAt: registrations.createdAt
        })
        .from(registrations)
        .where(eq(registrations.status, 'confirmed'))
      return rows.sort(bySeedingThenTime).map(toConfirmedParticipant)
    },

    listAll() {
      return db
        .select()
        .from(registrations)
        .orderBy(asc(registrations.status), asc(registrations.competition), asc(registrations.createdAt))
    },

    async findById(id) {
      const rows = await db.select().from(registrations).where(eq(registrations.id, id)).limit(1)
      return rows[0] ?? null
    },

    findActiveRegistration(person) {
      return findOne(and(personWhere(person), inArray(registrations.status, [...ACTIVE_STATUSES])))
    },

    findCancelledRegistration(person) {
      return findOne(and(personWhere(person), eq(registrations.status, 'cancelled')))
    },

    async insert(data) {
      const values: NewRegistrationRow = { ...data, status: 'new', updatedAt: data.createdAt }
      const rows = await db.insert(registrations).values(values).returning()
      return rows[0]
    },

    async revive(id, fields) {
      const rows = await db
        .update(registrations)
        .set({ status: 'new', ...fields, updatedAt: fields.createdAt })
        .where(eq(registrations.id, id))
        .returning()
      return rows[0]
    },

    async setMatch(id, playerId, lk) {
      await db.update(registrations).set({ playerId, lk, updatedAt: nowIso() }).where(eq(registrations.id, id))
    },

    async setFields(id, fields) {
      const rows = await db
        .update(registrations)
        .set({ ...fields, updatedAt: nowIso() })
        .where(eq(registrations.id, id))
        .returning()
      return rows[0]
    },

    async setStatus(id, status) {
      const rows = await db
        .update(registrations)
        .set({ status, updatedAt: nowIso() })
        .where(eq(registrations.id, id))
        .returning()
      return rows[0]
    },

    async setLk(id, lk) {
      await db.update(registrations).set({ lk, updatedAt: nowIso() }).where(eq(registrations.id, id))
    },

    async remove(id) {
      const rows = await db.delete(registrations).where(eq(registrations.id, id)).returning()
      return rows.length
    },

    async cancelActiveByPerson(person) {
      // One UPDATE … RETURNING flips the matching active rows and hands them back — no
      // SELECT-then-UPDATE race, and the returned rows carry the facts the notifier needs.
      return db
        .update(registrations)
        .set({ status: 'cancelled', updatedAt: nowIso() })
        .where(and(emailLastNameWhere(person), inArray(registrations.status, [...ACTIVE_STATUSES])))
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
        .sort(bySeedingThenTime)
        .map(toConfirmedParticipant)
    },

    async listAll() {
      return [...rows].sort(
        (a, b) =>
          a.status.localeCompare(b.status) ||
          a.competition.localeCompare(b.competition) ||
          a.createdAt.localeCompare(b.createdAt)
      )
    },

    async findById(id) {
      return rows.find(r => r.id === id) ?? null
    },

    async findActiveRegistration(person) {
      return rows.find(r => matchesPerson(r, person) && isActive(r.status)) ?? null
    },

    async findCancelledRegistration(person) {
      return rows.find(r => matchesPerson(r, person) && r.status === 'cancelled') ?? null
    },

    async insert(data) {
      const row: RegistrationRow = {
        id: nextId++,
        playerId: null,
        lk: null,
        status: 'new',
        ...data,
        updatedAt: data.createdAt
      }
      rows.push(row)
      return row
    },

    async revive(id, fields) {
      const row = byId(id)
      Object.assign(row, { status: 'new', ...fields, updatedAt: fields.createdAt })
      return row
    },

    async setMatch(id, playerId, lk) {
      const row = byId(id)
      row.playerId = playerId
      row.lk = lk
      row.updatedAt = nowIso()
    },

    async setFields(id, fields) {
      const row = byId(id)
      Object.assign(row, fields)
      row.updatedAt = nowIso()
      return row
    },

    async setStatus(id, status) {
      const row = byId(id)
      row.status = status
      row.updatedAt = nowIso()
      return row
    },

    async setLk(id, lk) {
      const row = byId(id)
      row.lk = lk
      row.updatedAt = nowIso()
    },

    async remove(id) {
      const i = rows.findIndex(r => r.id === id)
      if (i < 0) return 0
      rows.splice(i, 1)
      return 1
    },

    async cancelActiveByPerson(person) {
      const matched = rows.filter(
        r => eqCi(r.email, person.email) && eqCi(r.lastName, person.lastName) && isActive(r.status)
      )
      matched.forEach(r => {
        r.status = 'cancelled'
        r.updatedAt = nowIso()
      })
      return matched
    },

    async countRecentByIp(ip, sinceIso) {
      return rows.filter(r => r.ip === ip && r.createdAt > sinceIso).length
    }
  }
}
