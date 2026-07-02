# ADR-0049: The bracket topology rule gets its own module

- Status: accepted
- Date: 2026-07-02
- Refines: ADR-0025 (feeders are implicit; "that single helper is the place the topology rule is allowed to live")

## Context

ADR-0025 made feeders implicit — a match at `(round r, position p)` is fed by `(r−1, 2p)` and
`(r−1, 2p+1)` — and said the rule "must be read through the shared `bracketStructure(size)` helper …
not re-derived per surface. That single helper is the place the topology rule is allowed to live."

In practice `bracketStructure` only ever held the **seed-line skeleton**: the seed groups (which lines
each seed sits on) and the round count. The adjacency rule itself never moved in and stayed implicit,
re-encoded across four modules:

- **what feeds `(round, position)`** — the parent `(r+1, ⌊p/2⌋)` and its inverse — appears in
  `draw.ts` (`materializeMatches`), `advancement.ts` (`advanceEdges`), and `schedule.ts`
  (`feederPosition`, the successor check);
- **the third-place adjacency** — the playoff sits at `(depth, 1)`, fed by the semifinal _losers_ at
  `(depth−1, 0)`/`(depth−1, 1)` — is re-derived in `draw.ts`, `advancement.ts`, `schedule.ts`
  (feeder-order both directions), and `viewSlot`;
- **`bracketDepth`** is defined in `schedule.ts` and copied in `consolation.ts` (a comment admits the dodge);
- **`loserOf`** exists twice — `advancement.ts` (winner as a param) and `consolation.ts` (reads
  `winnerRegId`, guards `outcome === 'bye'`) — nominally divergent.

Issue #177.

## Decision

The topology rule gets its own home, **`shared/bracket-topology.ts`** — the layer that _navigates_ a
materialized bracket, distinct from the _construction_ layer in `draw.ts` (`bracketStructure`,
`drawBracket`, `materializeMatches`). **draw.ts builds the tree; bracket-topology walks it.** The three
navigation consumers (`advancement`, `schedule`, `consolation`) read it without pulling the draw
machinery (`drawBracket`, `RandomSource`, seed tables) into their import graph.

- **Pure position arithmetic**, keyed on `(round, position, depth)`, returning bracket coordinates (and,
  for a winner edge, which parent slot the winner fills). The winner tree is `winnerFeeders` /
  `winnerTarget`; the loser edge into the third-place playoff is `semifinalPositions` / `thirdPlacePosition`
  — winner-vs-loser is _which function a caller reaches for_ (branching on the `thirdPlace` flag it holds),
  not a `kind` on the return. Callers resolve those coordinates against the match set they already hold, so
  **main-vs-consolation falls out for free** — a consolation bracket has no `(depth, 1)` match, so a loser
  edge there resolves to nothing, exactly as today's `matches.find(x => x.thirdPlace)` did. Plus
  `bracketDepth(matches)` (max round) for readers holding a match set.
- The `(depth, 1)` placement is **single-sourced** in `thirdPlacePosition(depth)`; `materializeMatches`
  builds the playoff slot from it. The stored `thirdPlace` flag stays the **identity** (its feed is losers,
  not winners), and topology stays pure arithmetic — it never re-derives third-place-ness from
  `position === 1`. Callers branch on the flag they already hold to pick winner-feeders vs
  `semifinalPositions`.
- **`loserOf(m, winnerRegId)` reconciled to one definition:** the winner stays a _parameter_ (advancement's
  cascade-clear reasons about a _specified_ winner, computed before it nulls `winnerRegId`), with a
  `winnerRegId === null ⇒ null` guard so the field-driven consolation use is safe on undecided matches.
  No `outcome === 'bye'` guard is needed — a real bye's empty opponent slot already yields `null`; the two
  copies only ever "disagreed" on a both-slots-filled bye that `materializeMatches` cannot produce. Homed
  here as a match-read beside `bracketDepth`.
- **`bracketStructure` is re-scoped** in name and comment to the **seed-line skeleton** (seeds/lines +
  round count) — it is no longer "the topology home." The word _topology_ now means the adjacency rule,
  matching how `advancement.ts` and `schedule.ts` already use it.

## Consequences

- The four re-encodings collapse to one read: `advanceEdges`' parent/loser routing, the schedule
  validator's feeder-order + `viewSlot`, and `consolation`'s depth all read `bracket-topology`.
- `bracketStructure.rounds` (depth-from-size, a construction question) and `bracketDepth(matches)`
  (depth-from-a-set, a navigation question) coexist — the same number from different inputs, not a
  duplication of logic.
- One-way dependency: `draw.ts` imports _values_ from `bracket-topology` (so `materializeMatches` places
  the playoff via `thirdPlacePosition`); `bracket-topology` imports nothing back — it is pure position
  arithmetic over primitives (its match-reads `loserOf` / `bracketDepth` take minimal structural interfaces
  it declares itself), so the dependency runs one way (`draw.ts` → topology) with no runtime cycle.
