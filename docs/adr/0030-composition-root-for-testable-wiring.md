# ADR-0030: A composition root — the worker is built from an injectable `Deps` seam

- Status: accepted
- Date: 2026-06-27
- Relates to: ADR-0008 (admin gated only at the edge under `/api/admin/*`), ADR-0009 (end-to-end type
  chain Drizzle → Zod → Hono), ADR-0021 (small N is a design constraint)

## Context

The architecture review (improve-codebase-architecture) surfaced that the worker has no composition
root: each Hono handler reaches into `c.env.DB` and constructs its own Store adapter
(`createD1RegistrationsStore(c.env.DB)` appears in ~10 handlers), `buildSeedingLk(store)` is rebuilt in
three, and the draw and reset services are composed inline. The `scheduled` cron in `worker/index.ts`
is a second consumer that wires the same stores inline.

The duplication itself is cheap and honest; the load-bearing cost is **testability**. Because every
adapter is built from `c.env.DB` _inside_ the handler, there is no seam at which to substitute the
in-memory adapters that already exist (`createInMemory*Store`, `createFakeRandomSource`,
`createInMemoryRosterSource`). So a route can only be exercised over real (local) D1 through the vitest
Workers pool — even though the fakes the domain/draw units use are right there. This is the one
test-only gap in ADR-0009's chain: the chain is type-safe end to end, but the HTTP seam cannot be
driven over fakes.

The platform constrains the shape: in Workers `env.DB` exists only per request (via `c.env`), never at
module load, so the injected thing cannot be a concrete object — it must be a factory of env.

## Decision

**Compose the worker through a single injectable seam. The app is built from a factory; production
injects D1 + crypto + nuLiga adapters, tests inject the in-memory fakes — at the HTTP boundary.**

- **`worker/deps.ts` owns the composition root.** A `Deps` type (the dependency bundle a request or the
  cron operates with), `createDeps(adapters)` (the one true composition), and `createDepsFromEnv(env)`
  (the thin prod wrapper that builds the D1 adapters from `env.DB`, the crypto `RandomSource`, and the
  nuLiga `RosterSource`).
- **Inject what _varies_, compose the rest once.** Only the adapters differ across the seam — the Store
  adapters (D1 / in-memory), the `RandomSource` (crypto / fake), the `RosterSource` (nuLiga / fake);
  each is a real seam by the two-adapters test. The Registration domain, draw service, reset service,
  and seedingLk are the _same_ composition in both environments, so `createDeps` builds them over
  whatever adapters it is given. `Deps` exposes both the stores (for the raw-read routes — `listAll`,
  `remove`, `countRecentByIp`, `listDraws`, phase) and the composed objects (for the transition routes).
- **The app is a factory; one middleware acquires deps per request.** `createApp(makeDeps)` returns the
  chained `new Hono().get().post()…` instance (so `AppType = typeof app` still feeds the typed `hc`
  client — ADR-0009); `export const app = createApp(createDepsFromEnv)`. A single
  `.use('/api/*', c => c.set('deps', makeDeps(c.env)))` is the one place a request acquires its
  dependencies; handlers read `c.var.deps`. Building per request is free — all synchronous object
  construction, no I/O (`drizzle(d1)` is a thin wrapper).
- **The cron shares the factory.** `scheduled` is not a Hono request, so it calls `createDepsFromEnv(env)`
  directly and uses `deps.appState` + `deps.seedingLk` — the same two it built inline before. One
  factory, two call sites.
- **Tests substitute adapters, not a hand-rolled `Deps`.** A test's `makeDeps` is
  `(_env) => createDeps({ in-memory stores, fake random, fake roster })` — the _real_ `createDeps`
  composition runs over fakes, so the test path exercises the actual domain/draw/reset logic, not stubs
  (replace the adapter, keep the composition). A small `createTestDeps(overrides?)` helper assembles the
  existing fakes.

## Consequences

- **Closes the test-only gap in ADR-0009.** `app.request()` tests can now drive any route through
  `createApp(() => createTestDeps())` over the in-memory adapters, collapsing slow D1 round-trips into
  fast handler tests that still run the real Hono → Zod → domain → store chain. Landed as a
  behaviour-preserving refactor: `pnpm test` stays green throughout, plus one proof-of-life test that
  drives a route over fakes and stands as the pattern for migrating the rest later. The D1 integration
  tests stay — they earn their keep proving what fakes cannot (Drizzle SQL, migrations, the 100-param
  chunking, `COLLATE NOCASE`); this only adds a faster layer beside them.
- **ADR-0008 stands unchanged.** This is purely internal wiring — no app-level auth is added. Access
  still gates `/api/admin/*`, `workers_dev = false` still leaves no un-gated hostname, and the
  every-operator-route-under-`/api/admin/*` invariant is untouched. The deps middleware is scoped to
  `/api/*` and carries no authority of its own.
- **Not a glossary concept.** `Deps` / composition root is an implementation structure, not language the
  club speaks, so `CONTEXT.md` gains no entry. (The things it composes — Store module, Registration
  domain, draw/reset services, seedingLk — are already modelled there.)
- **`Deps`, not `Services`.** The bundle holds the two services but also the stores and the domain, so
  "Services" would name a part for the whole; `Deps` names its role — the dependencies a request
  depends on — without colliding with the existing "service" notion (`drawService`, `resetService`).
