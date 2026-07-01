import { describe, expect, it } from 'vitest'
import { type AdvanceableMatch, applyResult, type DrawPlayer, drawBracket, materializeMatches } from '../shared'
import { createFakeRandomSource } from './fake-random'

// The pure Advancement transform (CONTEXT: Advancement, ADR-0026): how a result propagates through the
// bracket and how a correction cascade-clears downstream. Deterministic, no I/O — the prior art is
// draw.test.ts (the materialization it walks) and the store seam in store.test.ts.

// n players in seeding order (strongest first): ids 1..n, LK ascending so the order is obvious.
const field = (n: number): DrawPlayer[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, lk: `${i + 1}.0` }))

describe('applyResult — advancement', () => {
  // A fixed 8-draw (slots [1,3,4,5,6,7,8,2] from field(8) + lots all 0), materialized and given store ids:
  //   ids 1–4 = round-1 (quarterfinals), 5–6 = round-2 (semifinals), 7 = final, 8 = third-place playoff.
  const bracket = (): AdvanceableMatch[] => {
    const { slots } = drawBracket({ players: field(8), size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })
    return materializeMatches(8, slots).map((m, i) => ({ id: i + 1, competition: 'mens', bracket: 'main', ...m }))
  }
  const at = (matches: AdvanceableMatch[], id: number) => matches.find(m => m.id === id)!

  it('advances the winner into the parent slot by position parity', () => {
    let m = bracket()
    m = applyResult(m, 1, { winnerRegId: 1, outcome: null }) // QF pos 0 → semifinal slot 1
    m = applyResult(m, 2, { winnerRegId: 4, outcome: null }) // QF pos 1 → semifinal slot 2
    expect(at(m, 1).winnerRegId).toBe(1)
    expect(at(m, 5)).toMatchObject({ slot1RegId: 1, slot2RegId: 4 })
  })

  it('routes a semifinal loser into the third-place playoff', () => {
    let m = bracket()
    m = applyResult(m, 1, { winnerRegId: 1, outcome: null })
    m = applyResult(m, 2, { winnerRegId: 4, outcome: null })
    m = applyResult(m, 5, { winnerRegId: 1, outcome: null }) // semifinal: winner 1 → final, loser 4 → third place
    expect(at(m, 7)).toMatchObject({ slot1RegId: 1 }) // final slot 1 (semifinal pos 0 → slot 1)
    expect(at(m, 8)).toMatchObject({ slot1RegId: 4, thirdPlace: true }) // third place slot 1 = the loser
  })

  it('fills both third-place slots from the two semifinals', () => {
    let m = bracket()
    for (const [id, w] of [
      [1, 1],
      [2, 4],
      [3, 6],
      [4, 8]
    ] as const)
      m = applyResult(m, id, { winnerRegId: w, outcome: null })
    m = applyResult(m, 5, { winnerRegId: 1, outcome: null }) // SF1 (pos 0): loser 4 → third place slot 1
    m = applyResult(m, 6, { winnerRegId: 6, outcome: null }) // SF2 (pos 1): loser 8 → third place slot 2
    expect(at(m, 8)).toMatchObject({ slot1RegId: 4, slot2RegId: 8 })
    expect(at(m, 7)).toMatchObject({ slot1RegId: 1, slot2RegId: 6 }) // the final pairs the two winners
  })

  it('advances a walkover / retirement winner the same way (the outcome rides along)', () => {
    let m = bracket()
    m = applyResult(m, 1, { winnerRegId: 3, outcome: 'walkover' })
    expect(at(m, 1)).toMatchObject({ winnerRegId: 3, outcome: 'walkover' })
    expect(at(m, 5)).toMatchObject({ slot1RegId: 3 })
    m = applyResult(m, 2, { winnerRegId: 4, outcome: 'retirement' })
    expect(at(m, 2)).toMatchObject({ winnerRegId: 4, outcome: 'retirement' })
    expect(at(m, 5)).toMatchObject({ slot1RegId: 3, slot2RegId: 4 })
  })

  it('does not mutate the input array (pure transform)', () => {
    const m = bracket()
    const out = applyResult(m, 1, { winnerRegId: 1, outcome: null })
    expect(at(m, 1).winnerRegId).toBeNull() // input untouched
    expect(at(out, 1).winnerRegId).toBe(1)
  })
})

describe('applyResult — correction', () => {
  const bracket = (): AdvanceableMatch[] => {
    const { slots } = drawBracket({ players: field(8), size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })
    return materializeMatches(8, slots).map((m, i) => ({ id: i + 1, competition: 'mens', bracket: 'main', ...m }))
  }
  const at = (matches: AdvanceableMatch[], id: number) => matches.find(m => m.id === id)!

  // Resolve a full quarterfinal → semifinal → final chain so there is something downstream to disturb.
  const resolved = () => {
    let m = bracket()
    for (const [id, w] of [
      [1, 1],
      [2, 4],
      [3, 6],
      [4, 8]
    ] as const)
      m = applyResult(m, id, { winnerRegId: w, outcome: null })
    m = applyResult(m, 5, { winnerRegId: 1, outcome: null }) // SF1: 1 beats 4
    m = applyResult(m, 6, { winnerRegId: 6, outcome: null }) // SF2: 6 beats 8
    m = applyResult(m, 7, { winnerRegId: 1, outcome: null }) // final: 1 beats 6
    return m
  }

  it('leaves the bracket untouched when only the score changes (same winner)', () => {
    let m = resolved()
    const before = JSON.parse(JSON.stringify(m))
    m = applyResult(m, 5, { winnerRegId: 1, outcome: 'retirement' }) // same winner, new outcome
    expect(at(m, 5)).toMatchObject({ winnerRegId: 1, outcome: 'retirement' })
    // Everything downstream is identical — the final still holds 1, third place still holds the loser 4.
    expect(at(m, 7)).toMatchObject(at(before, 7))
    expect(at(m, 8)).toMatchObject(at(before, 8))
  })

  it('re-fills the parent slot and cascade-clears dependent downstream results on a winner change', () => {
    let m = resolved()
    // Correct the QF at id 1: winner was 1, now 3. Player 1 had advanced all the way to win the final.
    m = applyResult(m, 1, { winnerRegId: 3, outcome: null })
    expect(at(m, 1).winnerRegId).toBe(3)
    // The semifinal it fed now holds 3 (re-filled) and is itself cleared (it consumed the old winner 1).
    expect(at(m, 5)).toMatchObject({ slot1RegId: 3, winnerRegId: null, outcome: null })
    // The final consumed semifinal winner 1, so it cascade-clears too — the bracket never holds the loser.
    expect(at(m, 7)).toMatchObject({ slot1RegId: null, winnerRegId: null })
    // The third-place playoff held semifinal loser 4; that semifinal is undone, so its slot clears as well.
    expect(at(m, 8)).toMatchObject({ slot1RegId: null })
  })

  it('does not disturb a sibling subtree when correcting a winner', () => {
    let m = resolved()
    m = applyResult(m, 1, { winnerRegId: 3, outcome: null }) // only SF1's branch is affected
    // SF2 (id 6) and its feeders are in the other half — untouched.
    expect(at(m, 6)).toMatchObject({ winnerRegId: 6, slot1RegId: 6, slot2RegId: 8 })
    // The third-place slot 2 (SF2's loser 8) survives; only slot 1 (SF1's loser) cleared.
    expect(at(m, 8)).toMatchObject({ slot2RegId: 8 })
  })
})
