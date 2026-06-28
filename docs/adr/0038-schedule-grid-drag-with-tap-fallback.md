# ADR-0038: The schedule grid is drag-and-drop, with tap-to-place kept as a first-class fallback

- Status: accepted
- Date: 2026-06-29
- Refines: ADR-0005 (the operator places matches by hand on the courts×time grid)

## Context

The schedule grid (`src/admin/surfaces/schedule-surface.tsx`, built in #89) ships with a
**select-then-place** interaction: tap a match in the „Nicht geplant" backlog (or on the grid) to pick it
up, then tap a free cell to drop it. That was a deliberate _sequencing_ choice, not a principled one — the
code comment says „the rich drag affordance can layer on later," because #89's real payload was the
validator (ADR-0033). (CONTEXT.md meanwhile drifted, claiming the grid already used `dnd-kit`; it did not.)

Two clicks per placement is more friction than necessary, and a card-on-a-grid is the affordance operators
have learned everywhere else (Trello, every tournament tool) — drag is the expected gesture. So the
deferral is worth undoing.

The naive conclusion — replace tap with drag — is wrong, because select-then-place is genuinely better in
three cases this grid actually hits:

- **The grid scrolls horizontally.** It is 6 courts × 6 slots × 2 days (`overflow-x-auto`, `min-w-max`).
  Dragging a card to a cell scrolled off-screen is the classic auto-scroll-while-dragging failure; tap
  lets the operator pick up, scroll freely, then drop.
- **Rescheduling on a phone during a disruption.** ADR-0005 keeps manual reschedule available for big
  disruptions (e.g. rain); the operator carries a phone (CONTEXT: Admin). Drag across a tiny
  horizontally-scrolling grid on a touchscreen is miserable; tap is reliable.
- **Accessibility.** A keyboard/click path is trivially available; pure pointer-drag is not.

## Decision

The schedule grid offers **drag-and-drop as the primary affordance, with tap-to-place retained as a
coexisting first-class path** — not a vestige.

- Implemented with **`dnd-kit`** (the library CONTEXT.md already assumed). Its sensor model exposes a
  pointer-drag _and_ a click/keyboard path from one codebase, so the two interactions are not double the
  work — they are the same model driven two ways.
- Desktop at the tournament desk → drag, as expected.
- Off-screen cell / phone-during-disruption / keyboard → tap still works, unchanged.
- Both paths funnel through the same `validatePlacement` (ADR-0033), so neither can commit a hard-invalid
  placement and both surface the same soft warnings.

## Consequences

- **The tap path is load-bearing, not dead code.** A future reader will see two ways to place a match and
  may want to delete one; this ADR is why tap stays — it is the answer to the scroll, touch, and
  accessibility cases drag handles poorly. Remove it only if those cases are designed away.
- Pure drag is explicitly rejected: it would not need a second path _if_ the grid never scrolled and was
  never touched on a phone — but it does both.
- A future auto-suggest helper (ADR-0005's „auto-fill", still non-core) layers on top of the same grid and
  the same validator, independent of which input gesture placed a match by hand.
