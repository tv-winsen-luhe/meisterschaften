import { createCryptoRandomSource, type RandomSource } from '../shared'
import type { Env } from './app'
import { createRegistrationDomain, type RegistrationDomain } from './domain/registration'
import { createDrawService } from './draw'
import { createProjections } from './projections'
import { createResetService } from './reset'
import { createNuligaRosterSource, createSeedingLk, type RosterSource, type SeedingLk } from './seeding-lk'
import { createD1AppStateStore, type AppStateStore } from './store/app-state'
import { createD1DrawStore, type DrawStore } from './store/draw'
import { createD1RegistrationsStore, type RegistrationsStore } from './store/registrations'

// The composition root (ADR-0030). One place assembles the worker's dependencies, so the request path
// and the cron stop re-wiring stores inline — and, the load-bearing reason, so the in-memory adapters
// can be substituted at the HTTP seam for testing (closing the one test-only gap in ADR-0009's chain).
//
// Only the adapters vary across the seam — the Store adapters (D1 / in-memory), the RandomSource
// (crypto / fake), the RosterSource (nuLiga / fake); each is a real seam by the two-adapters test. The
// Registration domain, draw service, reset service, and seedingLk are the same composition either way,
// so `createDeps` builds them over whatever adapters it is given.

// The dependency bundle a request (via `c.var.deps`) or the cron operates with. Named `Deps`, not
// `Services`: it holds the two services but also the stores and the domain, so "Services" would name a
// part for the whole. Exposes both the stores (the raw-read routes — listAll, remove, countRecentByIp,
// listDraws, phase) and the composed objects (the transition routes).
export interface Deps {
  registrations: RegistrationsStore
  draws: DrawStore
  appState: AppStateStore
  registrationDomain: RegistrationDomain
  drawService: ReturnType<typeof createDrawService>
  projections: ReturnType<typeof createProjections>
  resetService: ReturnType<typeof createResetService>
  seedingLk: SeedingLk
}

// The adapters `createDeps` composes over — the only things that differ between production and tests.
export interface DepsAdapters {
  registrationsStore: RegistrationsStore
  drawStore: DrawStore
  appStateStore: AppStateStore
  randomSource: RandomSource
  rosterSource: RosterSource
}

// The one true composition: build the domain/services over the given adapters and expose the bundle.
export const createDeps = (adapters: DepsAdapters): Deps => {
  const { registrationsStore, drawStore, appStateStore, randomSource, rosterSource } = adapters
  return {
    registrations: registrationsStore,
    draws: drawStore,
    appState: appStateStore,
    registrationDomain: createRegistrationDomain(registrationsStore),
    drawService: createDrawService({ registrationsStore, drawStore, randomSource }),
    projections: createProjections({ drawStore, registrationsStore, appStateStore }),
    resetService: createResetService({ drawStore, registrationsStore, appStateStore }),
    seedingLk: createSeedingLk({ rosterSource, store: registrationsStore })
  }
}

// The production wrapper: build the D1 + crypto + nuLiga adapters from the request/cron env, then
// compose. `env.DB` exists only per request in Workers, so this is a function of env — never a
// module-load singleton. Building is free (synchronous object construction, no I/O).
export const createDepsFromEnv = (env: Env): Deps =>
  createDeps({
    registrationsStore: createD1RegistrationsStore(env.DB),
    drawStore: createD1DrawStore(env.DB),
    appStateStore: createD1AppStateStore(env.DB),
    randomSource: createCryptoRandomSource(),
    rosterSource: createNuligaRosterSource()
  })
