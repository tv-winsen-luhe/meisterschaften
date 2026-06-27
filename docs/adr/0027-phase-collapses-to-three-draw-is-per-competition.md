# ADR-0027: The phase collapses to three; the draw is a per-competition action, the middle is derived

- Status: accepted
- Date: 2026-06-27
- Revises: ADR-0006 (four operator-set phases → three; the `draw`/`live` distinction becomes derived)

## Context

ADR-0006 made the phase a single operator-set value with four steps (`signup` / `draw` / `live` /
`post-event`). Designing the draw exposed a conflation. The draw is **per competition** (ADR-0025;
the "already drawn?" state is per-bracket), and ADR-0006 itself says "the draw begins when the
operator starts the draw, live begins when the brackets are published" — i.e. the `draw` and
`live` boundaries are _derivations_ of where the competitions are, yet they are flipped by hand. The
consolation bracket even draws _during_ `live`, so "draws happen in the `draw` phase" was already
false. The four-value toggle mixes three different things: a registration gate, a per-competition
tournament lifecycle, and an end-of-event act.

## Decision

**Phase collapses to three values — `signup` → `tournament` → `post-event` — keeping only the two
transitions that are genuine global decisions, and deriving the middle.**

- The two remaining operator transitions are real, non-derivable acts: **`signup` → `tournament`**
  closes registration and freezes the seeding (the precondition for any draw — an open field cannot be
  drawn), and **`tournament` → `post-event`** declares the event over and unlocks the purge (ADR-0007).
- **The draw is a per-competition action, not a phase transition.** Each competition carries its own
  lifecycle — _not drawn → drawn → running → done_, plus "reveal in progress" while its cursor is
  advancing — surfaced in a new admin **„Konkurrenzen" section** where the **draw-now action** lives.
- **The public presentation inside `tournament` is derived** from the per-competition state, not set by
  hand: draw-pending (nothing drawn yet) → draw reveal show (a reveal cursor is live) → bracket →
  live board (matches running). The hand-timed `draw` → `live` flip is gone.
- **We derive the derivable middle and keep the ends explicit.** Fully deriving the phase (no operator
  control at all) is rejected: closing registration and ending the event are deliberate global acts,
  and ADR-0006's predictability + ADR-0021's simplicity argue for keeping exactly those two explicit.

## Consequences

- `shared/phase.ts`: `PHASES` becomes the three values; a migration maps existing `draw`/`live`
  app-state rows to `tournament`; the `signup` default is unchanged. `phase-stepper.tsx` shows three
  steps; public surfaces that keyed off `draw`/`live` now key off `tournament` plus per-competition
  state.
- **The seeding freeze is unchanged.** The weekly nuLiga cron stays gated to `signup` (ADR-0010), so
  leaving `signup` (→ `tournament`) stops the sync and fixes the LK exactly as leaving `signup`
  (→ `draw`) did before; each draw still snapshots its inputs (ADR-0024). No freeze semantics move.
- Adds a slice to the draw epic: the „Konkurrenzen" admin surface + the per-competition lifecycle
  state model (which the draw already needs per ADR-0025), plus the derived public middle.
- One fewer manual flip, and no risk of the public site being stuck in the wrong mode because the
  operator forgot to advance `draw` → `live` — the middle now follows the competitions themselves.
