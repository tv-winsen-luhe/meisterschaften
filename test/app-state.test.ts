import { describe, expect, it } from 'vitest'
import { createInMemoryAppStateStore } from '../worker/store/app-state'

describe('in-memory app-state store', () => {
  it('defaults to anmeldung when never set', async () => {
    expect(await createInMemoryAppStateStore().getPhase()).toBe('anmeldung')
  })

  it('honours a seeded initial phase', async () => {
    expect(await createInMemoryAppStateStore('live').getPhase()).toBe('live')
  })

  it('returns the last phase set', async () => {
    const store = createInMemoryAppStateStore()
    await store.setPhase('auslosung')
    expect(await store.getPhase()).toBe('auslosung')
    await store.setPhase('post-event')
    expect(await store.getPhase()).toBe('post-event')
  })
})
