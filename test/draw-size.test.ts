import { describe, expect, it } from 'vitest'
import { byeCount, consolationMatches, drawSize, mainDrawMatches, matchCount } from '../shared'

// drawSize/byeCount are the draw math (CONTEXT: "Draw size — the next power of two ≥ number of
// confirmed players; the gap to that size is filled with Freilose"). They live in shared/ as the
// single source the Übersicht reads today and the Auslosung will reuse (ADR-0021 keeps it small).
// A draw needs at least two players; below that there is no bracket (drawSize 0 → no Freilose).
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

// The match counts feed the Übersicht's court-load gauge. The load-bearing edge is the 4-entrant
// field: at draw size 4 the first round *is* the semifinal, so there is no separate Nebenrunde — the
// Spiel um Platz 3 is the consolation (ADR-0004). consolationMatches(4) must therefore be 0, not the
// `entrants − 1 = 1` the generic formula would give, and the field's total is exactly its 4 matches
// (3 KO + Spiel um Platz 3).
describe('match counts', () => {
  it('counts no separate Nebenrunde at draw size 4 (Spiel um Platz 3 is the consolation)', () => {
    expect(consolationMatches(4)).toBe(0)
    expect(mainDrawMatches(4)).toBe(4)
    expect(matchCount(4)).toBe(4)
  })

  it('counts a Nebenrunde from draw size 8 up (a full 8-field: 7 KO + Spiel um Platz 3 + 3 Trostrunde)', () => {
    expect(consolationMatches(8)).toBe(3)
    expect(mainDrawMatches(8)).toBe(8)
    expect(matchCount(8)).toBe(11)
  })

  it('is 0 below a real draw', () => {
    expect(matchCount(0)).toBe(0)
    expect(matchCount(1)).toBe(0)
  })
})
