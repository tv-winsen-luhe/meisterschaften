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
})
