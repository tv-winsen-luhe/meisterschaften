import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm'
import { ACTIVE_STATUSES, compareForCut, type DrawPlayer, seedingValue, type RegistrationStatus } from '../../shared'
import { registrations, type NewRegistrationRow, type RegistrationRow } from '../db/schema'

// The fields the seeding list order reads — a structural subset both a RegistrationRow and the D1
// projection satisfy, so the one comparator below sorts either.
interface SeedingOrdered {
  competition: string
  lk: string | null
  createdAt: string
}

// The strongest-first seeding order: by competition, then ascending seeding LK (the rule lives in shared/
// seedingValue), then registration time. This is the order the **draw** seeds every field on — including a
// Challenger field, which is admitted first-come-first-served but still seeded by LK in the bracket
// (ADR-0043) — so confirmedForDraw feeds drawBracket its strongest-first precondition from here. With small
// N (ADR-0021) the order is computed in JS, so D1 and the in-memory double run *this* one comparator — no
// SQL CAST/COALESCE vs parseFloat pair kept equal by hand.
export const bySeedingThenTime = (a: SeedingOrdered, b: SeedingOrdered): number =>
  a.competition.localeCompare(b.competition) ||
  seedingValue(a.lk) - seedingValue(b.lk) ||
  a.createdAt.localeCompare(b.createdAt)

// The public participant-list order: by competition, then the **field-type cut order** (ADR-0043, shared
// compareForCut) — a championship field strongest-first by LK, a Challenger field by registration date.
// The public list is the visible expression of the admission rule, so it orders by the same key the cut
// uses (first-come-first-served for the protected field), never by a strength its public surface hides
// (ADR-0011: that order is owned once, in compareForCut). The draw still seeds by LK — bySeedingThenTime.
export const byListOrder = (a: SeedingOrdered, b: SeedingOrdered): number =>
  a.competition.localeCompare(b.competition) || compareForCut(a.competition)(a, b)

// Narrow any confirmed row (a full RegistrationRow or the D1 projection) to the public list shape,
// in one place so both adapters' listConfirmed project identically — the comparator and the
// projection are now both shared, so the two adapters can't drift on either.
export const toConfirmedParticipant = (r: ConfirmedParticipant): ConfirmedParticipant => ({
  firstName: r.firstName,
  lastName: r.lastName,
  club: r.club,
  competition: r.competition,
  lk: r.lk
})

// updated_at is a persistence fact ("when was this row last written"), stamped here on every
// value-changing write rather than threaded through the domain. Insert/revive use the same
// timestamp as created_at; the change transitions use the write moment.
export const nowIso = () => new Date().toISOString()

// A confirmed participant as the public list needs it (camelCase, contract shape).
export interface ConfirmedParticipant {
  firstName: string
  lastName: string
  club: string
  competition: string
  lk: string | null
}

// The display fields the public draw reveal joins onto each reveal step by registration id (the
// matches/reveal sequence carry only ids). Name + the frozen LK — what a bracket slot shows.
export interface RevealPlayer {
  firstName: string
  lastName: string
  lk: string | null
}

// A person within a single competition — the key the registration lifecycle matches on.
// email + lastName are compared case-insensitively (the legacy COLLATE NOCASE behaviour).
export interface PersonInCompetition {
  email: string
  lastName: string
  competition: string
}

// A person across all competitions — the key a self-service cancellation matches on:
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
   * by competition, then ascending seeding LK (missing LK counts as DEFAULT_LK), then
   * registration time. The seeding order is load-bearing for the provisional seeding list.
   */
  listConfirmed(): Promise<ConfirmedParticipant[]>

  /**
   * Every registration for the admin list, ordered as the legacy admin SELECT did
   * (status, then competition, then registration time). Also the input syncAll walks.
   */
  listAll(): Promise<RegistrationRow[]>

  /**
   * The confirmed entries of one competition in seeding order (the same comparator the public list
   * uses: ascending seeding LK, then registration time) — the draw's input. Projected to just the
   * id + LK the draw needs: the id the bracket slots reference, the LK it snapshots (ADR-0010).
   * Seeding order stays owned here, beside the comparator, not re-encoded in the draw.
   */
  confirmedForDraw(competition: string): Promise<DrawPlayer[]>

  /**
   * Display fields (name + LK) for the given registration ids, keyed by id — the public draw reveal's
   * name join onto the reveal sequence (which carries only ids). Missing ids are simply absent from
   * the map; an empty input returns an empty map.
   */
  revealPlayers(ids: number[]): Promise<Map<number, RevealPlayer>>

  /** A single row by id, or null. */
  findById(id: number): Promise<RegistrationRow | null>

  /** The still-active entry (new/confirmed) for this person+competition, or null. */
  findActiveRegistration(person: PersonInCompetition): Promise<RegistrationRow | null>

  /** A previously cancelled entry for this person+competition that a re-registration revives, or null. */
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
   * competitions, flipping each to 'cancelled'. Returns the rows that were cancelled
   * (for the cancellation notification); an empty array means nothing matched.
   */
  cancelActiveByPerson(person: Person): Promise<RegistrationRow[]>

  /** Registrations from this IP since the given ISO timestamp — the soft rate-limit input. */
  countRecentByIp(ip: string, sinceIso: string): Promise<number>

  /**
   * Move every `confirmed` entry back to `new` (debug-only, ADR-0029): the "readmit" lever that
   * reverses confirm so each entry must be admitted again. Leaves `new` and `cancelled` untouched
   * (reviving `cancelled` is the member's act alone, ADR-0018). Returns how many rows were moved.
   */
  readmitAllConfirmed(): Promise<number>
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

  // The cancel match key: email + lastName case-insensitively, across all competitions.
  const emailLastNameWhere = (person: Person) =>
    and(
      sql`${registrations.email} = ${person.email} collate nocase`,
      sql`${registrations.lastName} = ${person.lastName} collate nocase`
    )

  return {
    async listConfirmed() {
      // Fetch confirmed rows and order them in JS (ADR-0021, small N) through the shared list comparator
      // (byListOrder): a championship field by LK, a Challenger field by registration date (ADR-0043), so
      // the public list reflects the admission rule. createdAt is the Challenger sort key (and the
      // championship tiebreak); it is dropped from the public projection.
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
      return rows.sort(byListOrder).map(toConfirmedParticipant)
    },

    listAll() {
      return db
        .select()
        .from(registrations)
        .orderBy(asc(registrations.status), asc(registrations.competition), asc(registrations.createdAt))
    },

    async confirmedForDraw(competition) {
      // Fetch this field's confirmed rows and order them strongest-first in JS (ADR-0021, small N) — the
      // seeding order drawBracket requires, even for a Challenger field, which is admitted by registration
      // date but still seeded by LK in the bracket (ADR-0043) — then project to the draw's id + LK.
      const rows = await db
        .select({
          id: registrations.id,
          lk: registrations.lk,
          competition: registrations.competition,
          createdAt: registrations.createdAt
        })
        .from(registrations)
        .where(and(eq(registrations.competition, competition), eq(registrations.status, 'confirmed')))
      return rows.sort(bySeedingThenTime).map(r => ({ id: r.id, lk: r.lk }))
    },

    async revealPlayers(ids) {
      if (ids.length === 0) return new Map()
      const rows = await db
        .select({
          id: registrations.id,
          firstName: registrations.firstName,
          lastName: registrations.lastName,
          lk: registrations.lk
        })
        .from(registrations)
        .where(inArray(registrations.id, ids))
      return new Map(rows.map(r => [r.id, { firstName: r.firstName, lastName: r.lastName, lk: r.lk }]))
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
    },

    async readmitAllConfirmed() {
      // One UPDATE … RETURNING flips every confirmed row to new and hands back the affected rows —
      // the count is what the lever reports. `new`/`cancelled` are left as they are.
      const rows = await db
        .update(registrations)
        .set({ status: 'new', updatedAt: nowIso() })
        .where(eq(registrations.status, 'confirmed'))
        .returning({ id: registrations.id })
      return rows.length
    }
  }
}
