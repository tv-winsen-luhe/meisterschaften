import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { asc, eq, sql } from 'drizzle-orm'
import { DEFAULT_LK } from '../../shared'
import { registrations, type RegistrationRow } from '../db/schema'

// A confirmed participant as the public list needs it (camelCase, contract shape).
export interface ConfirmedParticipant {
  firstName: string
  lastName: string
  club: string
  competition: string
  lk: string | null
}

// The deep registrations Store. Callers speak domain operations; Drizzle/SQL never
// leaks past this interface. Two adapters back it: D1/Drizzle (prod) and in-memory
// (tests). It grows one transition per slice — VS1 needs only the read path.
export interface RegistrationsStore {
  /**
   * Confirmed entries for the public list, ordered as the participant list expects:
   * by Konkurrenz, then ascending seeding LK (missing LK counts as DEFAULT_LK), then
   * registration time. The seeding order is load-bearing for the provisional Setzliste.
   */
  listConfirmed(): Promise<ConfirmedParticipant[]>
}

export function createD1RegistrationsStore(d1: D1Database): RegistrationsStore {
  const db = drizzle(d1)
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
    }
  }
}

// The in-memory adapter holds whole rows so later slices' write transitions have
// something to mutate; VS1 exercises only listConfirmed.
export function createInMemoryRegistrationsStore(seed: RegistrationRow[] = []): RegistrationsStore {
  const rows = [...seed]
  // Match the D1 adapter's SQL `CAST(COALESCE(lk, DEFAULT_LK) AS REAL)`: SQLite casts a
  // non-numeric string to 0.0, so coerce NaN → 0 (parseFloat alone would yield NaN and
  // sort differently). Keeps the test double faithful to production ordering.
  const seedingLk = (lk: string | null) => {
    const n = parseFloat(lk ?? DEFAULT_LK)
    return Number.isNaN(n) ? 0 : n
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
    }
  }
}
