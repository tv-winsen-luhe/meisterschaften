# ADR-0037: The worker route tree stays a single fluent Hono chain (for `hc` type inference)

- Status: accepted
- Date: 2026-06-28
- Refines: ADR-0009 (end-to-end type safety), ADR-0030 (composition root)

## Context

`worker/app.ts` is both the route tree _and_ the handler bodies for every endpoint (~400 lines). As the
consolation draw, match-result entry, live-status transitions, and advancement/correction routes land
(ADR-0004, ADR-0026, ADR-0032), each new route adds ~20–30 lines, and the file will keep growing.

Three successive architecture reviews independently proposed the same fix: extract handler groups into
separate modules (`registration-handlers.ts`, `draw-handlers.ts`) and chain them onto the app with Hono's
`.route()`, leaving `app.ts` a thin route tree. It is a reasonable navigability win — and it is exactly
the kind of "obvious cleanup" the next reader (or the next review) will propose again.

It is also the most type-sensitive change in the repo. ADR-0009 makes `AppType = typeof app` the backbone
of the type-safe chain: **five** client surfaces (`admin-app`, `use-reveal`, `tournament-draw`,
`participant-list`) build their typed `hc` client from it. The routes are deliberately written as one
fluent chain off `new Hono()` precisely so `typeof app` carries the full route schema — a detached
`app.get(...)` statement would not be reflected in the inferred type. `app.ts` already carries a code
comment to this effect.

## Decision

- **The route tree stays a single fluent chain off `new Hono()`.** New routes are added as links in that
  chain, not as detached statements — this is load-bearing for `hc` inference, not stylistic.
- **The route-group split is deferred, not adopted.** It is gated on _both_ of:
  1. `app.ts` actually crossing into pain (the reviews' own threshold, ~500 lines), and
  2. a spike proving Hono's `.route()` propagates the complete `AppType` to all five `hc` consumers.

  Until both hold, the split is not done — splitting now would risk the type chain for an anticipatory
  navigability gain on a file that is still manageable.

## Considered options

- **Split into route-group modules now (via `.route()`).** Rejected for now: it trades a load-bearing
  invariant (the ADR-0009 type chain) for navigability the file does not yet need, and `.route()`'s
  type-propagation across all five consumers is unverified. Re-openable once the two gates above are met.
- **Single fluent chain (chosen).** Keeps `AppType` provably complete; accepts linear file growth.

## Consequences

- `app.ts` grows linearly with the route count; this is accepted up to roughly the 500-line mark.
- This ADR is the documented home for _why the obvious split was not taken_, so a future reader or review
  finds the rationale (and the two gates) rather than re-proposing it from scratch — as three reviews
  already did.
- When the split is revisited, it is blocked until the `.route()` type-propagation spike passes; if Hono
  cannot carry `AppType` across the composition, the split stays off the table regardless of file size.
