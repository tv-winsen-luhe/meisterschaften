# ADR-0036: The public schedule feed honors the main reveal cursor — a placed match stays hidden until its draw is fully revealed

- Status: accepted
- Date: 2026-06-28
- Extends: ADR-0003 (the draw is revealed lot-by-lot; the suspense is server-enforced)
- Refines: ADR-0005 (the Live phase carries the public schedule)

## Context

Two public surfaces read the same frozen draw. The live bracket (`publicDraws()`, ADR-0003) slices each
reveal to its cursor — "join names only for the revealed prefix, never read player rows for steps still to
come" — so the unrevealed tail never leaves the server. The suspense is an API invariant, not a client
render gate: a spectator polling the endpoint cannot read a pairing ahead of the on-stage show.

The schedule feed (`schedule()`, `GET /api/schedule`, ADR-0005) read the same matches with **no such
gate**. It emitted every placed, non-bye match's joined player names, filtering only on placement
(`court !== null && day !== null && slot !== null && outcome !== 'bye'`). Placement is independent of the
reveal: `placeMatch` (`POST /api/admin/match/place`) carries no cursor term, and the admin grid keeps a
match visible after its reveal is rewound. So a placed-then-rewound bracket — or a bracket placed before
its on-stage reveal finishes — stayed fully exposed on `/api/schedule`, which is public and polled every
~10–20s. The two public surfaces disagreed on the same question: once a match is **scheduled**, is its
pairing already public?

## Decision

**The reveal cursor is the sole authority over pairing visibility, on _both_ public surfaces. Scheduling
answers "where and when," never "who versus who."** The schedule feed gates the same way the bracket does:

- **The main bracket gates on full reveal: a `main` match is emitted only once its competition's main
  reveal is complete (`cursor >= total`).** We chose this **bracket-level** gate over the finer per-slot
  mirror of `publicDraws()` (resolve each slot's name only if its reveal step is at/before the cursor)
  because the schedule board (#91) has no mid-reveal user — nobody walks to a court while the draw show is
  still running — so partial visibility during the reveal is complexity with no audience, and the per-slot
  variant would need to map each match slot back to its reveal-step index (the matches aggregate stores
  `slot1RegId`/`slot2RegId` as columns, the reveal sequence is a separate playback list). The coarse gate
  also handles the issue's rewind case for free: a fully-revealed-then-rewound bracket drops below `total`
  and its placed matches correctly vanish again until re-revealed.
- **The consolation bracket is never gated.** It has no reveal show — it publishes directly (ADR-0004), so
  there is no suspense contract to honor; its matches are emitted whenever placed. (A consolation pairing
  can imply a main round-1 result, but that is a property of ADR-0004's "publish directly" choice, already
  accepted, and out of scope here.)
- **The gate fails closed.** A placed `main` match whose competition has no reveal record — unreachable for
  a real draw, which always persists its `revealSequence` — is treated as not-revealed and hidden. For a
  suspense gate, the safe default is to withhold.

## Consequences

- `schedule()` (`worker/draw.ts`) fetches `listReveals()` (as `publicDraws()` already does), builds the set
  of competitions whose `main` reveal satisfies `cursor >= total`, and adds one filter term: a `main` match
  is emitted only if its competition is in that set; `consolation` matches skip the check.
- Mid-reveal, a competition shows **nothing** on the public schedule — including its later-round feeder
  matches (`Sieger M{n}`), which are not themselves spoilers. That is acceptable and arguably cleaner: a
  half-built grid mid-draw-show is noise, and the board is only actionable once play begins.
- The admin grid keeps showing placed matches regardless of reveal state — the operator schedules against
  the full bracket; the gate is a property of the **public** feed only.
