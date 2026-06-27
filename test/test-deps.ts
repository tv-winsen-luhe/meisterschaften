import { createDeps, type Deps, type DepsAdapters } from '../worker/deps'
import { createInMemoryRosterSource } from '../worker/seeding-lk'
import { createInMemoryAppStateStore } from '../worker/store/app-state'
import { createInMemoryDrawStore } from '../worker/store/draw'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import { createFakeRandomSource } from './fake-random'

// Build a `Deps` over the in-memory adapters so a route can be driven through `createApp(() => deps)`
// at the HTTP seam, no D1 (ADR-0030). Substitutes the adapters under the *real* `createDeps`
// composition, so the test path runs the actual domain/draw/reset logic — not stubs of it. One seam:
// pass `overrides` to seed (or keep a handle on) any adapter; the rest default to an empty fake.
export const createTestDeps = (overrides: Partial<DepsAdapters> = {}): Deps =>
  createDeps({
    registrationsStore: createInMemoryRegistrationsStore(),
    drawStore: createInMemoryDrawStore(),
    appStateStore: createInMemoryAppStateStore(),
    randomSource: createFakeRandomSource([]),
    rosterSource: createInMemoryRosterSource({}),
    ...overrides
  })
