# ADR-0011: A Registration domain module — transitions behind a typed Result, effects returned not performed

- Status: accepted
- Date: 2026-06-25

## Context

`handleRegister` mixes five concerns (validation, honeypot, rate-limit SQL, upsert/revive SQL, async
LK-match + notify) and `handleAdminUpdate` embeds the confirmation rule ("to confirm: player*id or LK")
— which is \_also* duplicated in the admin client JS. Registration state transitions and their rules
are scattered across handlers, the cron, and the client. This builds on the Store (ADR-0009) and
`seedingLk` (ADR-0010).

## Decision

**A Registration domain module owns the registration lifecycle.**

- Operations are named state transitions — `register`, `revive`, `confirm`, `cancel`, `hide`, plus
  admin edits `setPlayerId` / `setLk` — each returning a **typed Result**: `ok(newState)` or a typed
  domain error (`AlreadyRegistered`, `NotConfirmable`, `InvalidTransition`, …).
- Dependencies are **injected**: the **Store** (ADR-0009) for persistence, `seedingLk` (ADR-0010)
  where a transition needs an LK lookup. The module persists _through_ the Store; it never writes SQL.
- **The domain returns its side effects as typed data**, it does not perform them. A successful
  `register` returns e.g. `ok({ outcome: 'registered', notice: { …facts, challengerLkLooksOff } })`.
  The only injected dependency for the pure decision is the Store. The transport edge interprets the
  Result and performs I/O — schedules the Telegram send and the signup `seedingLk.matchOnRegister`
  via `ctx.waitUntil`. The domain never awaits nuLiga or Telegram.
- **The Challenger-LK judgment moves into the domain** and rides along in the result, so it is computed
  once (killing the `notifyRegistration` ↔ admin-client duplication).
- **Invariants live as pure predicates in `shared/`** (ADR-0009): `canConfirm(reg) → true | reason` is
  the authority's guard _and_ the React admin's affordance (disable the confirm button + show the
  reason, no round-trip). Authority in the domain, affordance in the client, definition in one place.

### Boundary

- **In the module:** business rules, the one-Konkurrenz-per-member uniqueness, the cancelled→new
  revive, valid status transitions, the confirmation precondition, persistence via the Store.
- **At the transport edge (thin handlers):** HTTP parsing + Zod shape/format validation
  (`@hono/zod-validator`, ADR-0009), rate-limiting (an abuse/HTTP concern), notification _sending_, and
  the async `seedingLk` fetch.

## Consequences

- Handlers become thin adapters: parse → call transition → map Result to response. The whole
  registration lifecycle has one home; tests assert Results against a fake Store — no HTTP, no D1.
- This is the pattern the `Auslosung` and `Match-Ergebnis` domains will reuse — establishing it on the
  simplest aggregate first.
- Deletion test passes: delete the module and transitions + rules scatter back across handlers, cron,
  and client.
- Zod (shape/format) vs domain (invariants/transitions) is a clean, intentional split — not redundant
  validation.
