import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { DEFAULT_PHASE, phaseSchema, type Phase } from '../../shared'
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
}

export const createD1AppStateStore = (d1: D1Database): AppStateStore => {
  const db = drizzle(d1)

  return {
    async getPhase() {
      // A read failure (transient D1 error, or the table not yet present in a deploy window)
      // degrades to the default rather than throwing: the cron then behaves as it did before
      // the gate (runs during the default Anmeldung), GET /api/phase stays a 200, and the
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
    }
  }
}

// The in-memory adapter holds just the phase; tests seed an initial phase and drive the
// endpoints/cron through their interfaces.
export const createInMemoryAppStateStore = (initial: Phase = DEFAULT_PHASE): AppStateStore => {
  let phase = initial
  return {
    async getPhase() {
      return phase
    },
    async setPhase(next) {
      phase = next
    }
  }
}
