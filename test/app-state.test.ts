import { describe, expect, it } from 'vitest'
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
})
