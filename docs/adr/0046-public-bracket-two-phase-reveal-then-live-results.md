# ADR-0046: The public bracket is a two-phase projection — reveal during the show, live results after

- Status: accepted
- Date: 2026-07-01
- Refines: ADR-0003 (precompute then reveal — the suspense invariant), ADR-0025 (the draw materializes
  the matches aggregate), ADR-0032 (the live phase records reality), ADR-0041 (the schedule publish gate
  is a _plan_ gate), ADR-0044 (the public reveal redacts Challenger strength), ADR-0004 (the consolation
  bracket has no reveal show)

## Context

The public draw page (`src/components/tournament-draw.astro`, „Der Draw") polls `/api/draw` →
`projections.publicDraws()`, which projects **only the reveal sequence** sliced to the reveal cursor
(`buildReveals`, `worker/projections.ts:73`). The reveal-step wire shape (`RevealStep`,
`shared/draw.ts:366`) carries `{ kind, position, playerId, seed }` — **no `winnerRegId`, no `outcome`**.
The client renders round 1 from the revealed lines, round 2 from bye-winners, and **hardcodes every
deeper round to „?"** (`tournament-draw.astro:630`). So once a field is drawn the public bracket is
frozen at the draw: a played match's winner advancing is structurally invisible. The schedule
(`/api/schedule`) instead reads the `matches` aggregate (`winnerRegId` + refilled parent slots,
`shared/advancement.ts:140`) and _does_ advance — so spectators saw the Spielplan update while the bracket
sat still (the reported bug).

This was never a regression: the live-results view on top of the draw reveal was simply never built.

## Decision

**The public bracket becomes a two-phase, server-side projection, switched per competition on the reveal
cursor:**

1. **While revealing (`cursor < total`)** — unchanged: the cursor-sliced reveal sequence, so the
   unrevealed tail never leaves the server (ADR-0003). No result can exist yet — a match cannot be played
   before its draw is fully revealed — so nothing is lost by not showing results here.
2. **Once `isFullyRevealed`** — project the bracket from the **`matches` aggregate** via the shared
   `resolveBracket` (ADR-0025: the aggregate _is_ the bracket), so winners advance round-by-round from
   `winnerRegId` to the champion. This is the same resolver the schedule and admin grid already read.

**The gate is full-reveal only — never the schedule publish flag.** A recorded result is reality
(ADR-0032) and must advance the bracket even when the operator has not published the schedule plan
(ADR-0041 gates the _plan_, not results). The switch is per competition: one field can show live results
while another is still being revealed.

**Scope is the full live bracket:** the main knockout **+** the `thirdPlace`-flagged „Spiel um Platz 3"
(already a match _inside_ `bracket: 'main'`, `shared/advancement.ts:24` — so it rides the main
full-reveal gate) **+** the consolation bracket (`bracket: 'consolation'`). The consolation has no reveal
show (ADR-0004), so it is **public the moment it is drawn** — no suspense gate, mirroring how the schedule
already surfaces it (`worker/projections.ts:155`). At draw size 4 there is no separate consolation — the
3rd-place match _is_ it (CONTEXT: Third-place match).

**Client presentation:** one competition at a time as a **„Hauptrunde / Nebenrunde" segmented view** —
the 3rd-place box sits under Hauptrunde; the Nebenrunde tab appears only when a consolation bracket exists
(size ≥ 8) and has been drawn.

**Redaction and authority are preserved.** The resolved-bracket projection redacts a Challenger field's
LK and seed on the wire (ADR-0044), and the merge is **server-side** (ADR-0022). The client does _not_
reconstruct advancement from the schedule feed it already polls: that feed is filtered to placed +
published matches, so it would miss an unplaced or unpublished result and would wrongly inherit the
publish gate.

## Consequences

- `/api/draw`'s per-competition payload becomes a **discriminated shape**: a _revealing_ field carries
  reveal steps (as today); a _fully-revealed_ field carries its resolved main bracket (+ 3rd-place) and,
  once drawn, its resolved consolation bracket. The client picks the renderer.
- The client's hardcoded „?" deeper rounds give way to resolved slots — a filled player, a „Sieger Mx"
  feeder, or a „Verlierer …" loser-feeder — reusing the schedule's slot-resolution vocabulary (ADR-0035).
- `revealedBracket(size, steps)` is now the **during-reveal** interpretation only; the after-reveal
  bracket comes from `resolveBracket(matches)`. (CONTEXT: Revealed bracket updated to say so.)
- No new persistence: both phases read existing tables (`draws.reveal_sequence`, `matches`). No migration.
- The consolation appearing "instantly" on draw (no reveal show) is intentional (ADR-0004); the public
  bracket simply mirrors the schedule's existing no-gate treatment of it.
