# ADR-0009: End-to-end type safety — Drizzle + Zod + Hono, behind a deep Store module

- Status: accepted
- Date: 2026-06-25

## Context

The architecture review (improve-codebase-architecture) surfaced that SQL is inline across ~9 worker
handlers, the API request/response types are hand-written and duplicated across client components, and
validation is split between HTML5 client checks and hand-rolled server string checks. The guiding
requirement set here is: **as type-safe end to end as possible.** Type safety spans four seams —
D1 schema → Store/Domain → HTTP API → Client (public Astro components + the React admin, ADR-0008) —
and today it breaks at the HTTP seam (duplicated types, no runtime validation, client trusts the JSON).

Cloudflare ships no ORM of its own; the D1 binding (`prepare/bind`) is the raw floor, and Cloudflare
supports third-party ORMs — `wrangler d1 migrations apply` natively understands Drizzle's migration
layout (`migrations_pattern`, May 2026).

## Decision

An unbroken type chain: **Drizzle → Zod → Hono `hc`.**

- **D1 → Domain: Drizzle ORM.** Typed schema in TS, inferred row types, typed queries; migrations via
  `drizzle-kit generate`, applied by wrangler — replacing the manual `schema.sql` workflow. (Chosen
  over Prisma — lighter, edge-native — and Kysely.)
- **Data access: a deep Store module** (candidate #1). Drizzle lives _inside_ the Store, never inline
  in handlers. The Store's interface speaks domain operations (`listConfirmed`, `confirm`, `revive`,
  `setLk`, …) that encode invariants and compose queries — it is deliberately _deep_, not a shallow
  1:1 passthrough around single Drizzle calls.
- **API contract: Zod schemas in a `shared/` module.** Each endpoint's request/response is a Zod
  schema; TS types are inferred from it; it is the single source of truth for shape + validation +
  types, replacing the split client/server validation.
- **Worker framework: Hono**, with `@hono/zod-validator` validating I/O against the shared schemas.
  Hono replaces the hand-rolled `if (path === …)` routing.
- **Client: Hono's typed `hc` client** for both the public live components and the React admin, so
  types flow automatically from each server route to the call site.

tRPC was considered and rejected: most surfaces are public, zero-JS-by-default polling GETs where tRPC
is the most awkward fit; it needs an HTTP host (Hono) under it anyway; and its main advantage
(React-Query hooks) is reachable with TanStack Query over `hc` in the admin without a second paradigm.

## Consequences

- A `shared/` module is the mechanism that crosses the `worker/tsconfig.json` boundary (it is excluded
  from the root tsconfig); both the worker and the client import the Zod schemas / types from there.
- This subsumes candidate #3 (shared API contract + duplicated client fetch types): the contract is the
  Zod/`shared` module; a thin `hc`-based live-resource helper carries the polling cadence (ADR-0008).
- The duplicated constants (`CHALLENGER_MIN_LK`, `DEFAULT_LK`) and the stringly-typed competition slug
  move into `shared/` as a single typed source of truth crossing the seam.
- **Reconciles ADR-0008:** Hono is adopted as the _worker's_ framework. The separate Worker still
  stays (ADR-0008); this is **not** the "fold the worker into Astro's `src/fetch.ts`" idea, which
  remains unadopted.
- Candidates #2 (seedingLk) and #4 (registration domain) build on the Store as their injected
  dependency.
