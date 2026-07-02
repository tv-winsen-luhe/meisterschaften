import { loserOf, semifinalPositions, winnerTarget } from './bracket-topology'
import type { MatchOutcome } from './draw'

// Advancement (CONTEXT: Advancement, ADR-0026): how a result propagates through the bracket — resolving a
// match writes its winner and sends the winner into the parent slot (by position parity), and a semifinal
// also routes its loser into the third-place playoff. Correcting a result is the same call with a different
// winner — it cascade-clears any downstream result that consumed the old winner, so the bracket never holds
// a player who lost. A pure transform over the match topology (no scores, no I/O) — the home of the result-
// propagation rule, beside the draw math it builds on (shared/draw.ts materializes the bracket it walks).
// The store overlays the set scores + status onto what this returns.

// The minimal match shape Advancement reasons over: the bracket position, its two slots, the resolved
// winner/outcome, and the third-place flag. Generic via this interface so both the store row and the
// MatchSlots shape satisfy it without importing each other.
export interface AdvanceableMatch {
  id: number
  competition: string
  bracket: string
  round: number
  position: number
  slot1RegId: number | null
  slot2RegId: number | null
  winnerRegId: number | null
  outcome: MatchOutcome | null
  thirdPlace: boolean
}

// The result a match resolves with, for Advancement: the winning registration id and the outcome (null =
// a normal scored result; `walkover`/`retirement` carry the winner without — or with a partial — score).
// The scores themselves never reach this transform — they do not change the bracket topology.
export interface MatchResult {
  winnerRegId: number
  outcome: MatchOutcome | null
}

// One advancement edge: the player `regId` lands in slot `which` of match `id`. Winner → parent slot,
// loser → third-place slot. Named (the lint rule forbids the inline `{…}[]` return type).
interface AdvanceEdge {
  id: number
  which: 1 | 2
  regId: number
}

// Where a decided match's winner and loser advance to — read from `bracket-topology` (ADR-0049), not
// re-derived here (CONTEXT: Advancement). The winner fills the parent match's slot (`winnerTarget` fixes
// the slot by position parity); a semifinal's loser fills the third-place playoff's slot, the semifinals
// resolved by `semifinalPositions` (position 0 → slot 1, position 1 → slot 2). The final and the third-
// place match have no parent; the consolation bracket has no third-place playoff (found by the flag, so it
// resolves to none there). Returns the edges to apply (winner first, then loser).
const advanceEdges = <M extends AdvanceableMatch>(
  matches: M[],
  m: M,
  winnerRegId: number,
  loserRegId: number | null
): AdvanceEdge[] => {
  const edges: AdvanceEdge[] = []
  const sameBracket = (x: M) => x.competition === m.competition && x.bracket === m.bracket
  // Winner → parent. A `thirdPlace` parent is excluded: it is fed by losers, never by this winner edge.
  const target = winnerTarget(m.round, m.position)
  const parent = matches.find(
    x => sameBracket(x) && !x.thirdPlace && x.round === target.round && x.position === target.position
  )
  if (parent) edges.push({ id: parent.id, which: target.which, regId: winnerRegId })
  // Loser → third-place playoff, only from the two semifinals feeding it. The playoff exists only in the
  // main bracket (found by the flag); a consolation semifinal finds none and routes no loser.
  const thirdPlace = matches.find(x => sameBracket(x) && x.thirdPlace)
  if (thirdPlace && !m.thirdPlace && loserRegId !== null) {
    const semiIndex = semifinalPositions(thirdPlace.round).findIndex(
      s => s.round === m.round && s.position === m.position
    )
    if (semiIndex !== -1) edges.push({ id: thirdPlace.id, which: semiIndex === 0 ? 1 : 2, regId: loserRegId })
  }
  return edges
}

/**
 * Apply (or correct) a match result and propagate it through the bracket — the pure Advancement transform
 * (CONTEXT: Advancement, ADR-0026). Returns a new match set (the input is never mutated) with:
 *   - the target match's `winnerRegId` + `outcome` written;
 *   - the winner advanced into the parent slot (by position parity), and — for a semifinal — the loser
 *     advanced into the third-place playoff;
 *   - on a **winner change** (the target already held a *different* winner), the old winner's advancement
 *     undone and any downstream result that consumed it **cascade-cleared** recursively, so the bracket is
 *     never left holding a player who lost. A **score-only correction** (same winner) changes nothing
 *     downstream — the same player re-advances into the same slots, a no-op.
 *
 * Pass one competition+bracket's full match set (advancement is local to a bracket); `matchId` must be in
 * it and have both slots filled (an undecided feeder cannot resolve). Byes are resolved at draw time and
 * never corrected through here.
 */
export const applyResult = <M extends AdvanceableMatch>(matches: M[], matchId: number, result: MatchResult): M[] => {
  // Work on shallow clones so the transform is pure; every mutation below targets a clone.
  const work = matches.map(m => ({ ...m }))
  const byId = new Map(work.map(m => [m.id, m]))

  // Set slot `which` of match `id` to `regId` (or null). If the slot genuinely changes and the match
  // already produced a result, that result rested on the old slot — clear it first (recursively), so a
  // changed input never leaves a stale downstream winner. A no-op change (same value) touches nothing,
  // which is what makes a same-winner correction inert downstream.
  const setSlot = (id: number, which: 1 | 2, regId: number | null): void => {
    const m = byId.get(id)
    if (!m) return
    const current = which === 1 ? m.slot1RegId : m.slot2RegId
    if (current === regId) return
    if (m.winnerRegId !== null) clearResult(id)
    if (which === 1) m.slot1RegId = regId
    else m.slot2RegId = regId
  }

  // Un-resolve a match and pull its advanced players back out (recursively), e.g. when a feeder changed
  // under it. Only removes a downstream slot that still holds exactly the player this match advanced — a
  // slot since overwritten by a newer result is left alone.
  const clearResult = (id: number): void => {
    const m = byId.get(id)
    if (!m || m.winnerRegId === null) return
    const prevWinner = m.winnerRegId
    const prevLoser = loserOf(m, prevWinner)
    m.winnerRegId = null
    m.outcome = null
    for (const edge of advanceEdges(work, m, prevWinner, prevLoser)) {
      const target = byId.get(edge.id)
      if (!target) continue
      const slot = edge.which === 1 ? target.slot1RegId : target.slot2RegId
      if (slot === edge.regId) setSlot(edge.id, edge.which, null)
    }
  }

  const target = byId.get(matchId)
  if (!target) return work

  // A winner change must undo the old advancement (and its downstream cascade) before the new winner
  // propagates; a same-winner correction skips this, so nothing downstream moves.
  if (target.winnerRegId !== null && target.winnerRegId !== result.winnerRegId) clearResult(matchId)

  target.winnerRegId = result.winnerRegId
  target.outcome = result.outcome
  for (const edge of advanceEdges(work, target, result.winnerRegId, loserOf(target, result.winnerRegId))) {
    setSlot(edge.id, edge.which, edge.regId)
  }
  return work
}
