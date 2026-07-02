import { describe, expect, it } from 'vitest'
import {
  bracketDepth,
  loserOf,
  semifinalPositions,
  thirdPlacePosition,
  winnerFeeders,
  winnerTarget,
  winningSlot
} from '../shared'

// Bracket topology (CONTEXT: Bracket topology, ADR-0049): the pure adjacency rule of a materialized
// bracket — what feeds `(round, position)` — that draw/advancement/schedule/consolation used to re-derive.
// Position arithmetic only, so these tests need no draw: they pin the rule the four modules now read.

describe('winnerFeeders', () => {
  it('is null in round 1 (drawn players / byes, nothing feeds from below)', () => {
    expect(winnerFeeders(1, 0)).toBeNull()
    expect(winnerFeeders(1, 3)).toBeNull()
  })

  it('pairs (r−1, 2p) into slot 1 and (r−1, 2p+1) into slot 2', () => {
    expect(winnerFeeders(2, 0)).toEqual([
      { round: 1, position: 0 },
      { round: 1, position: 1 }
    ])
    expect(winnerFeeders(2, 1)).toEqual([
      { round: 1, position: 2 },
      { round: 1, position: 3 }
    ])
    // A deeper round: the final (round 3, position 0) is fed by the two semifinals (round 2, positions 0/1).
    expect(winnerFeeders(3, 0)).toEqual([
      { round: 2, position: 0 },
      { round: 2, position: 1 }
    ])
  })
})

describe('winnerTarget', () => {
  it('sends a winner to the parent (r+1, ⌊p/2⌋), by position parity (even → slot 1, odd → slot 2)', () => {
    expect(winnerTarget(1, 0)).toEqual({ round: 2, position: 0, which: 1 })
    expect(winnerTarget(1, 1)).toEqual({ round: 2, position: 0, which: 2 })
    expect(winnerTarget(1, 2)).toEqual({ round: 2, position: 1, which: 1 })
    expect(winnerTarget(2, 1)).toEqual({ round: 3, position: 0, which: 2 })
  })

  it('is the inverse of winnerFeeders — each feeder targets back the match it feeds', () => {
    for (const position of [0, 1, 2, 3]) {
      const [slot1, slot2] = winnerFeeders(2, position)!
      expect(winnerTarget(slot1.round, slot1.position)).toMatchObject({ round: 2, position, which: 1 })
      expect(winnerTarget(slot2.round, slot2.position)).toMatchObject({ round: 2, position, which: 2 })
    }
  })
})

describe('semifinalPositions', () => {
  it('is the two matches at round depth−1, positions 0 and 1', () => {
    expect(semifinalPositions(3)).toEqual([
      { round: 2, position: 0 },
      { round: 2, position: 1 }
    ])
    expect(semifinalPositions(4)).toEqual([
      { round: 3, position: 0 },
      { round: 3, position: 1 }
    ])
  })
})

describe('thirdPlacePosition', () => {
  it('sits beside the final — (depth, 1) — so the bracket depth is unchanged', () => {
    expect(thirdPlacePosition(3)).toEqual({ round: 3, position: 1 })
    expect(thirdPlacePosition(4)).toEqual({ round: 4, position: 1 })
  })
})

describe('bracketDepth', () => {
  it('is the highest round in the set (empty ⇒ 0)', () => {
    expect(bracketDepth([])).toBe(0)
    expect(bracketDepth([{ round: 1 }, { round: 3 }, { round: 2 }])).toBe(3)
  })
})

describe('loserOf', () => {
  const m = { slot1RegId: 7, slot2RegId: 9 }

  it('returns the slot that is not the winner', () => {
    expect(loserOf(m, 7)).toBe(9)
    expect(loserOf(m, 9)).toBe(7)
  })

  it('is null on an undecided match (winner null) — the field-driven consolation guard', () => {
    expect(loserOf(m, null)).toBeNull()
  })

  it('is null for a bye — the empty opponent slot is returned as the loser', () => {
    // A round-1 bye: one slot filled (the winner), the other null. The "loser" is that empty slot → null,
    // so no bye guard is needed (ADR-0049 reconciles the two former copies here).
    expect(loserOf({ slot1RegId: 3, slot2RegId: null }, 3)).toBeNull()
    expect(loserOf({ slot1RegId: null, slot2RegId: 3 }, 3)).toBeNull()
  })

  it('is null when the winner is neither slot (unreachable under a consistent bracket)', () => {
    expect(loserOf(m, 42)).toBeNull()
  })
})

describe('winningSlot', () => {
  it('is the slot (1/2) the recorded winner fills', () => {
    expect(winningSlot({ slot1RegId: 7, slot2RegId: 9, winnerRegId: 7 })).toBe(1)
    expect(winningSlot({ slot1RegId: 7, slot2RegId: 9, winnerRegId: 9 })).toBe(2)
  })

  it('is null on an undecided match (winner null)', () => {
    expect(winningSlot({ slot1RegId: 7, slot2RegId: 9, winnerRegId: null })).toBeNull()
  })

  it('is null for an undecided match with an empty feeder slot — the load-bearing guard', () => {
    // Without the winnerRegId === null gate, an undecided match whose slot is still an empty feeder
    // (regId null) would match null === null and bold the wrong line as the winner.
    expect(winningSlot({ slot1RegId: null, slot2RegId: 9, winnerRegId: null })).toBeNull()
    expect(winningSlot({ slot1RegId: 7, slot2RegId: null, winnerRegId: null })).toBeNull()
    expect(winningSlot({ slot1RegId: null, slot2RegId: null, winnerRegId: null })).toBeNull()
  })

  it('is null when the winner is neither slot (a hard-deleted registration under a frozen draw, ADR-0035)', () => {
    expect(winningSlot({ slot1RegId: 7, slot2RegId: 9, winnerRegId: 42 })).toBeNull()
  })
})
