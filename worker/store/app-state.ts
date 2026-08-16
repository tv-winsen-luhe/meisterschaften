import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import {
  cancelledCompetitionsSchema,
  COMPETITION_SLUGS,
  DEFAULT_PHASE,
  phaseSchema,
  type CompetitionSlug,
  type Phase
} from '../../shared'
import { appState } from '../db/schema'

// The deep app-state Store (ADR-0006): callers speak in phases, never SQL. The app-state is
// a single pinned row (id = 1); the Store treats its absence as the DEFAULT_PHASE so a fresh
// DB needs no data seed, and `setPhase` upserts that one row. Two adapters back it: D1/Drizzle
// (prod) and in-memory (tests), like the registrations Store.
const APP_STATE_ID = 1

export interface AppStateStore {
  /** The current operator-controlled phase; DEFAULT_PHASE when never set. */
  getPhase(): Promise<Phase>
  /** Set the current phase (upserts the single app-state row). */
  setPhase(phase: Phase): Promise<void>
  /** Whether the planned schedule is published (ADR-0041); false when never set / on a read failure. */
  getSchedulePublished(): Promise<boolean>
  /** Set the publish flag (upserts the single app-state row, leaving `phase` untouched). */
  setSchedulePublished(published: boolean): Promise<void>
  /**
   * The competitions the operator has cancelled (ADR-0062); the empty set when never set / on a read
   * failure / on an unparseable value.
   */
  getCancelledCompetitions(): Promise<CompetitionSlug[]>
  /**
   * Cancel one competition, or take the cancellation back — a plain toggle over the stored set
   * (upserts the single app-state row, leaving `phase` and `schedule_published` untouched).
   */
  setCompetitionCancelled(competition: CompetitionSlug, cancelled: boolean): Promise<void>
}

// A cancelled set in the canonical slug order, so the persisted value is stable regardless of the order
// the operator cancelled in (and a test can compare it as a plain array).
const canonical = (slugs: Iterable<CompetitionSlug>): CompetitionSlug[] => {
  const set = new Set(slugs)
  return COMPETITION_SLUGS.filter(slug => set.has(slug))
}

// The next set after toggling one competition. Shared by both adapters, so they cannot drift.
const toggleCancelled = (
  current: readonly CompetitionSlug[],
  competition: CompetitionSlug,
  cancelled: boolean
): CompetitionSlug[] => {
  const next = new Set(current)
  if (cancelled) next.add(competition)
  else next.delete(competition)
  return canonical(next)
}

export const createD1AppStateStore = (d1: D1Database): AppStateStore => {
  const db = drizzle(d1)

  // The stored set, with a **failing read left failing**. This is the read the toggle write goes through:
  // the write is a read-modify-write over the whole set, so degrading a failed read to the empty set here
  // would silently drop every other cancellation on the next toggle. A missing row and an unparseable
  // value do degrade to empty — the first is a fresh DB, and the second is only reachable via a manual DB
  // edit, where overwriting the broken value with a well-formed set is the repair, not a loss.
  const readCancelledOrThrow = async (): Promise<CompetitionSlug[]> => {
    const rows = await db.select().from(appState).where(eq(appState.id, APP_STATE_ID)).limit(1)
    let raw: unknown
    try {
      raw = JSON.parse(rows[0]?.cancelledCompetitions ?? '[]')
    } catch {
      return []
    }
    const parsed = cancelledCompetitionsSchema.safeParse(raw)
    return parsed.success ? parsed.data : []
  }

  // The reader's view: fail-closed like the two flags below, and here that means the **empty** set. A
  // transient D1 error must never take a running field off the website — cancelling is the operator's
  // explicit act, and a read that failed is not one.
  const readCancelled = async (): Promise<CompetitionSlug[]> => {
    try {
      return await readCancelledOrThrow()
    } catch {
      return []
    }
  }

  return {
    async getPhase() {
      // A read failure (transient D1 error, or the table not yet present in a deploy window)
      // degrades to the default rather than throwing: the cron then behaves as it did before
      // the gate (runs during the default signup phase), GET /api/phase stays a 200, and the
      // public surface keeps its default framing — one safe fallback for every reader.
      try {
        const rows = await db.select().from(appState).where(eq(appState.id, APP_STATE_ID)).limit(1)
        // A persisted value is validated through the shared enum; an unrecognised string (only
        // possible via a manual DB edit) falls back to the default rather than leaking through.
        const parsed = phaseSchema.safeParse(rows[0]?.phase)
        return parsed.success ? parsed.data : DEFAULT_PHASE
      } catch {
        return DEFAULT_PHASE
      }
    },

    async setPhase(phase) {
      await db
        .insert(appState)
        .values({ id: APP_STATE_ID, phase })
        .onConflictDoUpdate({ target: appState.id, set: { phase } })
    },

    async getSchedulePublished() {
      // Fail-closed like getPhase: a read failure (or a missing row) degrades to unpublished, so the
      // public schedule defaults to the safe „noch nicht veröffentlicht" framing rather than leaking a
      // half-built plan on a transient D1 error.
      try {
        const rows = await db.select().from(appState).where(eq(appState.id, APP_STATE_ID)).limit(1)
        return rows[0]?.schedulePublished ?? false
      } catch {
        return false
      }
    },

    async setSchedulePublished(published) {
      // Upserts the single row, setting only `schedule_published` — `phase` keeps its column default on a
      // first insert and is left untouched on update, so the two global flags never clobber each other.
      await db
        .insert(appState)
        .values({ id: APP_STATE_ID, schedulePublished: published })
        .onConflictDoUpdate({ target: appState.id, set: { schedulePublished: published } })
    },

    getCancelledCompetitions: readCancelled,

    async setCompetitionCancelled(competition, cancelled) {
      // Read-modify-write over the stored set: the toggle is per competition, the column holds the whole
      // set. Not a transaction — the operator is a single desk and the act is at most four slugs per
      // event (ADR-0021) — but the read deliberately throws rather than degrades (see above), so a D1
      // blip fails the request loudly instead of quietly un-cancelling every other field. Writes only
      // `cancelled_competitions`, so `phase` and `schedule_published` keep their column default on a
      // first insert and are left untouched on update.
      const next = toggleCancelled(await readCancelledOrThrow(), competition, cancelled)
      const cancelledCompetitions = JSON.stringify(next)
      await db
        .insert(appState)
        .values({ id: APP_STATE_ID, cancelledCompetitions })
        .onConflictDoUpdate({ target: appState.id, set: { cancelledCompetitions } })
    }
  }
}

// The in-memory adapter holds the phase + publish flag + cancelled set; tests seed all three and drive
// the endpoints/cron through their interfaces.
export const createInMemoryAppStateStore = (
  initial: Phase = DEFAULT_PHASE,
  initialPublished = false,
  initialCancelled: readonly CompetitionSlug[] = []
): AppStateStore => {
  let phase = initial
  let schedulePublished = initialPublished
  let cancelledCompetitions = canonical(initialCancelled)
  return {
    async getPhase() {
      return phase
    },
    async setPhase(next) {
      phase = next
    },
    async getSchedulePublished() {
      return schedulePublished
    },
    async setSchedulePublished(next) {
      schedulePublished = next
    },
    async getCancelledCompetitions() {
      return cancelledCompetitions
    },
    async setCompetitionCancelled(competition, cancelled) {
      cancelledCompetitions = toggleCancelled(cancelledCompetitions, competition, cancelled)
    }
  }
}
