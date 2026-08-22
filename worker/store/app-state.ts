import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import {
  cancelledCompetitionsSchema,
  COMPETITION_SLUGS,
  DEFAULT_PHASE,
  isValidSocialMixerPlacement,
  canonicalCourts,
  NOT_SUSPENDED,
  phaseSchema,
  type PlaySuspension,
  SOCIAL_MIXER_DEFAULT_PLACEMENT,
  type CompetitionSlug,
  type Phase,
  type SocialMixerPlacement
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
  /**
   * Where the operator has put the Social mixer's block (ADR-0064) — day + start slot. The planned
   * placement when never set / on a read failure / on an out-of-window value.
   */
  getSocialMixerPlacement(): Promise<SocialMixerPlacement>
  /** Move the block (upserts the single app-state row, leaving every other global untouched). */
  setSocialMixerPlacement(placement: SocialMixerPlacement): Promise<void>
  /**
   * Whether play is suspended, and when it is expected to resume (ADR-0078). „Play is happening" when never
   * set / on a read failure — fail-closed like the readers above, and here that means the site does not
   * announce a suspension nobody declared.
   *
   * The three columns are independent below this layer; the impossible combinations („not suspended, but a
   * resume time is set", „suspended, but no court named" — both reachable by a hand-edited row) are
   * normalised away **here**, so no caller can observe them. The *decay* of a passed resume time is not
   * this Store's job — that is a function of the moment it is read at, and it lives in
   * `shared/play-suspension.ts` where the surfaces apply it.
   */
  getPlaySuspension(): Promise<PlaySuspension>
  /** Suspend play, or lift it (upserts the single app-state row, leaving every other global untouched). */
  setPlaySuspension(suspension: PlaySuspension): Promise<void>
}

// The stored court set, degrading to empty. Same two failure modes `cancelled_competitions` has and the
// same answer to both: a missing column value is a fresh row, and an unparseable one is only reachable via
// a manual DB edit, where the repair is to overwrite it (ADR-0078 Amendment 2 rule 1).
const courtsOf = (raw: string | undefined): number[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  return Array.isArray(parsed) ? parsed.filter((court): court is number => typeof court === 'number') : []
}

// A stored suspension, normalised. „Not suspended" wins over any resume time sitting beside it, and over a
// suspension that names **no court** — the union above this layer cannot express either pair, so this is
// where both stop (ADR-0078; Amendment 2 rule 1). The *decay* of a resume time is deliberately not applied
// here: that is a function of the moment the state is read at, and it belongs to the surfaces. Shared by
// both adapters.
const suspensionOf = (
  suspended: boolean | undefined,
  resumesAt: number | null | undefined,
  stored: readonly number[]
): PlaySuspension => {
  if (!suspended) return NOT_SUSPENDED
  const courts = canonicalCourts(stored)
  return courts.length === 0 ? NOT_SUSPENDED : { suspended: true, resumesAt: resumesAt ?? null, courts }
}

// A stored placement, or the planned one. The bound is re-checked on read, not only on write: the column
// pair is two plain integers, and a hand-edited row must not be able to put the block somewhere the dialog
// would never offer.
const placementOrDefault = (day: number | undefined, startSlot: number | undefined): SocialMixerPlacement => {
  if (day === undefined || startSlot === undefined) return SOCIAL_MIXER_DEFAULT_PLACEMENT
  const placement = { day, startSlot }
  return isValidSocialMixerPlacement(placement) ? placement : SOCIAL_MIXER_DEFAULT_PLACEMENT
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
    },

    async getSocialMixerPlacement() {
      // Fail-safe like the readers above: a transient D1 error degrades to the planned placement, so the
      // appointment the participants read stays the one the event was planned around rather than vanishing.
      try {
        const rows = await db.select().from(appState).where(eq(appState.id, APP_STATE_ID)).limit(1)
        return placementOrDefault(rows[0]?.socialMixerDay, rows[0]?.socialMixerSlot)
      } catch {
        return SOCIAL_MIXER_DEFAULT_PLACEMENT
      }
    },

    async setSocialMixerPlacement({ day, startSlot }) {
      // Writes only the two placement columns, so `phase`, `schedule_published` and the cancelled set keep
      // their column default on a first insert and are left untouched on update.
      const set = { socialMixerDay: day, socialMixerSlot: startSlot }
      await db
        .insert(appState)
        .values({ id: APP_STATE_ID, ...set })
        .onConflictDoUpdate({ target: appState.id, set })
    },

    async getPlaySuspension() {
      // Fail-closed like the readers above, and here that is „play is happening": a transient D1 error must
      // never put „Spielbetrieb unterbrochen" on the site, because a suspension is the operator's explicit
      // statement and a read that failed is not one.
      try {
        const rows = await db.select().from(appState).where(eq(appState.id, APP_STATE_ID)).limit(1)
        return suspensionOf(rows[0]?.playSuspended, rows[0]?.playResumesAt, courtsOf(rows[0]?.suspensionCourts))
      } catch {
        return NOT_SUSPENDED
      }
    },

    async setPlaySuspension(suspension) {
      // All three columns are written together, always. Lifting clears the resume time **and** the court set
      // rather than leaving them behind, so the next suspension cannot inherit a stale „weiter ca. 14:30" or
      // a stale „nur Platz 4" from an hour ago — the impossible state is kept out of the row itself, not only
      // out of the read.
      const set = {
        playSuspended: suspension.suspended,
        playResumesAt: suspension.suspended ? suspension.resumesAt : null,
        suspensionCourts: JSON.stringify(suspension.suspended ? suspension.courts : [])
      }
      await db
        .insert(appState)
        .values({ id: APP_STATE_ID, ...set })
        .onConflictDoUpdate({ target: appState.id, set })
    }
  }
}

// The in-memory adapter holds the phase + publish flag + cancelled set + mixer placement; tests seed all
// four and drive the endpoints/cron through their interfaces.
export const createInMemoryAppStateStore = (
  initial: Phase = DEFAULT_PHASE,
  initialPublished = false,
  initialCancelled: readonly CompetitionSlug[] = [],
  initialMixerPlacement: SocialMixerPlacement = SOCIAL_MIXER_DEFAULT_PLACEMENT,
  initialSuspension: PlaySuspension = NOT_SUSPENDED
): AppStateStore => {
  let phase = initial
  let schedulePublished = initialPublished
  let cancelledCompetitions = canonical(initialCancelled)
  let socialMixerPlacement = initialMixerPlacement
  let playSuspension = initialSuspension
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
    },
    async getSocialMixerPlacement() {
      return socialMixerPlacement
    },
    async setSocialMixerPlacement(next) {
      socialMixerPlacement = next
    },
    async getPlaySuspension() {
      return playSuspension
    },
    async setPlaySuspension(next) {
      // Normalised on the way in, exactly as the D1 adapter writes it, so the two cannot drift.
      playSuspension = suspensionOf(
        next.suspended,
        next.suspended ? next.resumesAt : null,
        next.suspended ? next.courts : []
      )
    }
  }
}
