import { describe, expect, it } from 'vitest'
import { COURT_NUMBERS } from '../shared'
import { createInMemoryAppStateStore } from '../worker/store/app-state'

describe('in-memory app-state store', () => {
  it('defaults to signup when never set', async () => {
    expect(await createInMemoryAppStateStore().getPhase()).toBe('signup')
  })

  it('honours a seeded initial phase', async () => {
    expect(await createInMemoryAppStateStore('tournament').getPhase()).toBe('tournament')
  })

  it('returns the last phase set', async () => {
    const store = createInMemoryAppStateStore()
    await store.setPhase('tournament')
    expect(await store.getPhase()).toBe('tournament')
    await store.setPhase('post-event')
    expect(await store.getPhase()).toBe('post-event')
  })

  it('defaults schedule_published to off and toggles it (ADR-0041)', async () => {
    const store = createInMemoryAppStateStore()
    expect(await store.getSchedulePublished()).toBe(false)
    await store.setSchedulePublished(true)
    expect(await store.getSchedulePublished()).toBe(true)
    await store.setSchedulePublished(false)
    expect(await store.getSchedulePublished()).toBe(false)
  })

  it('keeps the publish flag and the phase independent (neither set clobbers the other)', async () => {
    const store = createInMemoryAppStateStore()
    await store.setSchedulePublished(true)
    await store.setPhase('tournament')
    // Setting the phase must not reset the publish flag, and vice versa.
    expect(await store.getSchedulePublished()).toBe(true)
    expect(await store.getPhase()).toBe('tournament')
  })

  it('cancels a competition and takes it back — a plain toggle (ADR-0062)', async () => {
    const store = createInMemoryAppStateStore()
    expect(await store.getCancelledCompetitions()).toEqual([])
    await store.setCompetitionCancelled('womens-social', true)
    expect(await store.getCancelledCompetitions()).toEqual(['womens-social'])
    // Idempotent: cancelling twice is still one entry.
    await store.setCompetitionCancelled('womens-social', true)
    expect(await store.getCancelledCompetitions()).toEqual(['womens-social'])
    await store.setCompetitionCancelled('womens-social', false)
    expect(await store.getCancelledCompetitions()).toEqual([])
  })

  it('holds several cancelled competitions in the canonical slug order', async () => {
    const store = createInMemoryAppStateStore()
    await store.setCompetitionCancelled('womens-social', true)
    await store.setCompetitionCancelled('womens', true)
    // Cancelled social-first, stored womens-first: the order is the offering's, not the operator's.
    expect(await store.getCancelledCompetitions()).toEqual(['womens', 'womens-social'])
  })

  it('honours a seeded cancelled set', async () => {
    const store = createInMemoryAppStateStore('tournament', false, ['womens'])
    expect(await store.getCancelledCompetitions()).toEqual(['womens'])
  })

  it('keeps the cancelled set, the phase and the publish flag independent', async () => {
    const store = createInMemoryAppStateStore()
    await store.setCompetitionCancelled('womens', true)
    await store.setPhase('tournament')
    await store.setSchedulePublished(true)
    expect(await store.getCancelledCompetitions()).toEqual(['womens'])
    // …and the other direction: cancelling must not disturb the two global flags.
    await store.setCompetitionCancelled('mens-challenger', true)
    expect(await store.getPhase()).toBe('tournament')
    expect(await store.getSchedulePublished()).toBe(true)
  })

  // ── Play suspension (ADR-0078) ─────────────────────────────────────────────────────────────────

  const AT_1430 = Date.UTC(2026, 7, 22, 12, 30)
  // The total suspension the shell switch writes: every court (ADR-0078 Amendment 2 rule 1).
  const EVERY_COURT = [...COURT_NUMBERS]
  const stopped = (resumesAt: number | null, courts: number[] = EVERY_COURT) =>
    ({ suspended: true, resumesAt, courts }) as const

  it('defaults to „play is happening" and suspends with no resume time', async () => {
    const store = createInMemoryAppStateStore()
    expect(await store.getPlaySuspension()).toEqual({ suspended: false })
    await store.setPlaySuspension(stopped(null))
    expect(await store.getPlaySuspension()).toEqual(stopped(null))
  })

  it('carries a resume time and lifts back to the plain state', async () => {
    const store = createInMemoryAppStateStore()
    await store.setPlaySuspension(stopped(AT_1430))
    expect(await store.getPlaySuspension()).toEqual(stopped(AT_1430))
    await store.setPlaySuspension({ suspended: false })
    expect(await store.getPlaySuspension()).toEqual({ suspended: false })
  })

  it('drops the resume time when the suspension is lifted, so it cannot come back with the next one', async () => {
    // The impossible state („not suspended, but a time is set") must not survive a lift and reappear on the
    // next suspension as a stale „weiter ca. 14:30" from an hour ago.
    const store = createInMemoryAppStateStore()
    await store.setPlaySuspension(stopped(AT_1430))
    await store.setPlaySuspension({ suspended: false })
    await store.setPlaySuspension(stopped(null))
    expect(await store.getPlaySuspension()).toEqual(stopped(null))
  })

  it('round-trips the courts a partial suspension names, and clears them on a lift', async () => {
    const store = createInMemoryAppStateStore()
    await store.setPlaySuspension(stopped(null, [4, 5]))
    expect(await store.getPlaySuspension()).toEqual(stopped(null, [4, 5]))
    await store.setPlaySuspension({ suspended: false })
    expect(await store.getPlaySuspension()).toEqual({ suspended: false })
  })

  it('degrades a suspension that names no court to „play is happening"', async () => {
    // The empty set is not a state (ADR-0078 Amendment 2 rule 1). The wire schema refuses one; this is the
    // Store making sure no caller can observe one either, whichever adapter it is talking to.
    const store = createInMemoryAppStateStore()
    await store.setPlaySuspension({ suspended: true, resumesAt: AT_1430, courts: [] })
    expect(await store.getPlaySuspension()).toEqual({ suspended: false })
  })

  it('keeps the suspension independent of the phase, the publish flag and the cancelled set', async () => {
    const store = createInMemoryAppStateStore()
    await store.setPhase('tournament')
    await store.setSchedulePublished(true)
    await store.setCompetitionCancelled('womens', true)
    await store.setPlaySuspension(stopped(AT_1430))
    expect(await store.getPhase()).toBe('tournament')
    expect(await store.getSchedulePublished()).toBe(true)
    expect(await store.getCancelledCompetitions()).toEqual(['womens'])
    expect(await store.getPlaySuspension()).toEqual(stopped(AT_1430))
  })
})
