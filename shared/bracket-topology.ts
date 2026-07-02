// Bracket topology (CONTEXT: Bracket topology, ADR-0049; refines ADR-0025): the adjacency rule of a
// materialized bracket — *what feeds `(round, position)`* — owned once so the draw, Advancement, the
// schedule, and the consolation bracket read one definition instead of re-deriving parity per surface.
// Pure position arithmetic keyed on `(round, position, depth)`: it *walks* a bracket draw.ts has already
// *built* (draw.ts builds the tree, this walks it), so it holds no draw machinery and imports nothing back
// — a one-way dependency (draw.ts → this), no runtime cycle. Callers resolve the coordinates this returns
// against the match set they already hold, so main-vs-consolation falls out for free: a consolation bracket
// has no `(depth, 1)` match, so a loser edge there resolves to nothing (exactly today's `find(thirdPlace)`).

// A bracket coordinate — a match's `(round, position)` address. The two feeders below a match, a winner's
// target parent, the semifinals, and the third-place playoff all name one, so it is the shared return
// shape. An explicit interface, not an inline `{ round; position }` — the lint rule bans an inline object
// type in an annotation (TSTypeAnnotation > TSTypeLiteral), return types included.
export interface BracketPosition {
  round: number
  position: number
}

// Where a match's winner advances: the parent coordinate plus which of its two slots the winner fills
// (position parity — even → slot 1, odd → slot 2). A `BracketPosition` with the target slot, named for the
// same lint reason.
export interface WinnerTarget extends BracketPosition {
  which: 1 | 2
}

/**
 * The two matches whose winners feed `(round, position)` — the child at `(round − 1, 2·position)` fills
 * slot 1, `(round − 1, 2·position + 1)` fills slot 2 (feeders are implicit, ADR-0025). Returned in slot
 * order (index 0 = slot 1's feeder, index 1 = slot 2's), so a caller reads one slot as `[slot − 1]`. Null
 * in round 1: its slots are drawn players or byes, fed from below by nothing. This walks the winner tree
 * only — the third-place playoff is loser-fed (see `semifinalPositions`), so callers branch on the
 * `thirdPlace` flag they hold before reading feeders.
 */
export const winnerFeeders = (round: number, position: number): [BracketPosition, BracketPosition] | null =>
  round <= 1
    ? null
    : [
        { round: round - 1, position: position * 2 },
        { round: round - 1, position: position * 2 + 1 }
      ]

/**
 * Where `(round, position)`'s winner advances (CONTEXT: Advancement) — the inverse of `winnerFeeders`: the
 * parent match `(round + 1, ⌊position / 2⌋)`, into slot 1 for an even position or slot 2 for an odd one.
 * The final has no parent, but the arithmetic still yields one `(depth + 1, 0)`; the caller resolves it
 * against its match set and finds nothing, exactly as it finds no parent for the final today. Never points
 * at the third-place slot `(depth, 1)` — a semifinal winner targets the final `(depth, 0)`, its loser is
 * routed separately.
 */
export const winnerTarget = (round: number, position: number): WinnerTarget => ({
  round: round + 1,
  position: Math.floor(position / 2),
  which: position % 2 === 0 ? 1 : 2
})

/**
 * The two semifinals of a bracket of this `depth` — the matches at round `depth − 1`, positions 0 and 1,
 * whose *losers* feed the third-place playoff (CONTEXT: Third-place match). Returned as coordinates in slot
 * order: index 0 (position 0) feeds third-place slot 1, index 1 (position 1) feeds slot 2. A bracket has
 * exactly two semifinals from four entrants up (byes only occur in round one), so this is exact, not an
 * estimate. Keyed on depth so the semifinal round lives here once rather than as `depth − 1` per surface.
 */
export const semifinalPositions = (depth: number): [BracketPosition, BracketPosition] => [
  { round: depth - 1, position: 0 },
  { round: depth - 1, position: 1 }
]

/**
 * The third-place playoff's fixed coordinate — `(depth, 1)`, beside the final at `(depth, 0)`, so the
 * bracket's depth is unchanged (CONTEXT: Third-place match). Single-sourced here; `materializeMatches`
 * builds the slot from it. The stored `thirdPlace` flag stays the *identity* of that match (its feed is
 * losers, not winners) — this is only where the slot sits, never a re-derivation of third-place-ness from
 * `position === 1`.
 */
export const thirdPlacePosition = (depth: number): BracketPosition => ({ round: depth, position: 1 })

// The minimal match shape `bracketDepth` reads — any match carrying its round.
export interface RoundedMatch {
  round: number
}

/**
 * The bracket's depth — its highest round (the final / third-place round) — over one bracket's match set
 * (an empty set ⇒ 0). The depth-*from-a-set* navigation question, distinct from `bracketStructure(size)`'s
 * `rounds` (depth-*from-size*, a construction question in draw.ts): the same number from different inputs,
 * not a duplication. The single definition the schedule surfaces, the validator, the auto-suggest, and the
 * consolation gate all read.
 */
export const bracketDepth = (matches: readonly RoundedMatch[]): number =>
  matches.reduce((max, m) => Math.max(max, m.round), 0)

// The minimal match shape `loserOf` reads — the two slot references. A structural subset of every match row
// (the store row, the wire `Match`, `AdvanceableMatch`, `ConsolationMatch`), so all satisfy it without
// importing each other (the AdvanceableMatch idiom).
export interface MatchSlotRefs {
  slot1RegId: number | null
  slot2RegId: number | null
}

/**
 * The loser of a decided match — the slot that is not `winnerRegId` (CONTEXT: Bracket topology). The winner
 * is a *parameter*, not read off the match, because Advancement's cascade-clear reasons about a *specified*
 * winner (computed before it nulls `winnerRegId`); the field-driven consolation use passes the match's own
 * `winnerRegId`, so the `winnerRegId === null ⇒ null` guard keeps it safe on an undecided match. A real bye
 * needs no special case: its empty opponent slot is `null`, so the winner matches the filled slot and the
 * other — `null` — is returned (the two former copies only ever "disagreed" on a both-slots-filled bye that
 * `materializeMatches` cannot produce). A winner that is neither slot (unreachable under a consistent
 * bracket) also yields `null`. The one reconciled `loserOf` (ADR-0049), replacing the copies in
 * advancement.ts and consolation.ts.
 */
export const loserOf = (m: MatchSlotRefs, winnerRegId: number | null): number | null => {
  if (winnerRegId === null) return null
  if (m.slot1RegId === winnerRegId) return m.slot2RegId
  if (m.slot2RegId === winnerRegId) return m.slot1RegId
  return null
}
