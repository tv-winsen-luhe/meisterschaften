# ADR-0006: Phase is an operator-controlled state in D1, with transition gates

- Status: accepted
- Date: 2026-06-25

## Context

The site presents itself differently across the four phases (Anmeldung, Auslosung, Live, Post-Event):
what's open, what's visible, what the public sees. The only existing control is the deploy-time
`PUBLIC_LIST_ENABLED` env flag — too coarse for four phases that switch over a single weekend. We had
to decide whether the phase is derived from the calendar or controlled by the operator.

## Decision

The current phase is a single operator-controlled value stored in D1 (`signup` / `draw` /
`live` / `post-event` — English identifiers; the German names Anmeldung/Auslosung are display copy
only), toggled in the admin. The public site and API read it at runtime and render
accordingly. Dates still drive copy (e.g. "Anmeldeschluss 19.08.") but never drive state.
`PUBLIC_LIST_ENABLED` is kept as an independent emergency kill-switch layered on top, orthogonal to
the phase.

Two transition gates fire as side effects of advancing the phase:

- **Anmeldung → Auslosung** closes registration and **freezes the seeding LK**. Mechanism (refined by
  ADR-0010): the draw snapshots each player's current LK into its immutable draw record (ADR-0003) —
  that snapshot _is_ the frozen seeding. The weekly nuLiga cron is phase-gated to run only during
  Anmeldung, so it is simply a no-op afterward; no suppression flag is needed. Before the draw, LKs
  keep updating and the provisional Setzliste reflects them live.
- **Live → Post-Event** freezes results — the brackets and the Spielplan become read-only.

## Consequences

- Phase transitions are deliberate acts, not clock events — the Auslosung begins when the operator
  starts the draw, Live begins when brackets are published. This matches how the day is actually run.
- A small settings/state record in D1 becomes the master switch every public surface keys off.
- The LK sync must respect the freeze: after Auslosung, seeding LK is immutable even though nuLiga
  data keeps updating.
- Each phase's visible surfaces are a pure function of this one value, which keeps the per-phase UI
  logic centralized rather than scattered across date checks.
