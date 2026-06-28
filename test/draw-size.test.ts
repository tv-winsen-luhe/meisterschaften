import { describe, expect, it } from 'vitest'
import { byeCount, consolationMatches, drawSize, mainDrawMatches, matchCount } from '../shared'

// drawSize/byeCount are the draw math (CONTEXT: "Draw size — the next power of two ≥ number of
// confirmed players; the gap to that size is filled with byes"). They live in shared/ as the
// single source the overview reads today and the draw will reuse (ADR-0021 keeps it small).
// A draw needs at least two players; below that there is no bracket (drawSize 0 → no byes).
describe('drawSize', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [8, 8],
    [9, 16],
    [14, 16],
    [16, 16],
    [17, 32],
    [32, 32]
  ])('drawSize(%i) = %i', (n, size) => {
    expect(drawSize(n)).toBe(size)
  })
})

describe('byeCount', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 1],
    [5, 3],
    [8, 0],
    [14, 2],
    [16, 0],
    [17, 15]
  ])('byeCount(%i) = %i', (n, byes) => {
    expect(byeCount(n)).toBe(byes)
  })
})

// The match counts feed the overview's court-load gauge. The load-bearing edge is the 4-entrant
// field: at draw size 4 the first round *is* the semifinal, so there is no separate consolation bracket — the
// third-place match is the consolation (ADR-0004). consolationMatches(4) must therefore be 0, not the
// `entrants − 1 = 1` the generic formula would give, and the field's total is exactly its 4 matches
// (3 KO + third-place match).
describe('match counts', () => {
  it('counts no separate consolation bracket at draw size 4 (third-place match is the consolation)', () => {
    expect(consolationMatches(4)).toBe(0)
    expect(mainDrawMatches(4)).toBe(4)
    expect(matchCount(4)).toBe(4)
  })

  it('counts a consolation bracket from draw size 8 up (a full 8-field: 7 KO + third-place match + 3 consolation)', () => {
    expect(consolationMatches(8)).toBe(3)
    expect(mainDrawMatches(8)).toBe(8)
    expect(matchCount(8)).toBe(11)
  })

  it('counts consolation correctly for non-full fields (bye-holders who lose R2 enter consolation)', () => {
    // 9 in 16: R1 losers 1 + min(byes 7, R2 matches 4) = 5 entrants → 4 matches
    expect(consolationMatches(9)).toBe(4)
    // 10 in 16: R1 losers 2 + min(byes 6, R2 matches 4) = 6 → 5
    expect(consolationMatches(10)).toBe(5)
    // 14 in 16: R1 losers 6 + min(byes 2, R2 matches 4) = 8 → 7
    expect(consolationMatches(14)).toBe(7)
    // 16 in 16: R1 losers 8 + min(byes 0, R2 matches 4) = 8 → 7
    expect(consolationMatches(16)).toBe(7)
    // 5 in 8: R1 losers 1 + min(byes 3, R2 matches 2) = 3 → 2
    expect(consolationMatches(5)).toBe(2)
    // 6 in 8: R1 losers 2 + min(byes 2, R2 matches 2) = 4 → 3
    expect(consolationMatches(6)).toBe(3)
    // 7 in 8: R1 losers 3 + min(byes 1, R2 matches 2) = 4 → 3
    expect(consolationMatches(7)).toBe(3)
  })

  it('matchCount sums main + consolation correctly for the 9-player Damen scenario', () => {
    // 9 Damen: main 9 (8 KO + Platz 3) + consolation 4 = 13
    expect(mainDrawMatches(9)).toBe(9)
    expect(matchCount(9)).toBe(13)
  })

  it('is 0 below a real draw', () => {
    expect(matchCount(0)).toBe(0)
    expect(matchCount(1)).toBe(0)
  })
})
