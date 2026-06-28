import { describe, expect, it } from 'vitest'
import {
  byeCount,
  consolationMatches,
  displayDrawSize,
  displaySeedCount,
  drawSize,
  mainDrawMatches,
  matchCount
} from '../shared'

// drawSize/byeCount are the draw math (CONTEXT: "Draw size — the next power of two ≥ number of
// confirmed players; the gap to that size is filled with byes"). They live in shared/ as the
// single source the overview reads today and the draw will reuse (ADR-0021 keeps it small).
// This is the raw size math (0 below two players); the *castable* floor is higher — a field needs ≥4
// to be drawn (drawBlocker, ADR-0034), so 2 and 3 round to a size here but are gated as too-few.
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

// displayDrawSize: the size the public pre-draw preview renders — drawSize clamped to the supported
// sizes (4/8/16), so 0–3 confirmed floor to a 4-bracket and 17+ caps at 16 (CONTEXT: Draw size, ADR-0034).
describe('displayDrawSize', () => {
  it('floors a still-filling field to the smallest real bracket (4)', () => {
    expect(displayDrawSize(0)).toBe(4)
    expect(displayDrawSize(2)).toBe(4)
    expect(displayDrawSize(3)).toBe(4)
    expect(displayDrawSize(4)).toBe(4)
  })

  it('follows the confirmed field across the supported sizes', () => {
    expect(displayDrawSize(5)).toBe(8) // 7 confirmed → an 8-draw, not the 16 a capacity would imply
    expect(displayDrawSize(7)).toBe(8)
    expect(displayDrawSize(8)).toBe(8)
    expect(displayDrawSize(9)).toBe(16)
    expect(displayDrawSize(16)).toBe(16)
  })

  it('caps an over-full field at the largest supported size (16)', () => {
    expect(displayDrawSize(17)).toBe(16)
    expect(displayDrawSize(40)).toBe(16)
  })
})

// displaySeedCount: the provisional seed count both pre-draw public surfaces show — the §30.5a count for
// the displayed size (4/8 → 2, 16 → 4), one rule so the preview and participant list never disagree.
describe('displaySeedCount', () => {
  it.each([
    [0, 2], // floors to a 4-bracket → 2 seeds
    [3, 2], // 4-draw
    [5, 2], // 8-draw
    [8, 2],
    [9, 4], // 16-draw
    [16, 4],
    [40, 4] // caps at 16
  ])('displaySeedCount(%i) = %i', (confirmed, seeds) => {
    expect(displaySeedCount(confirmed)).toBe(seeds)
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

  it('is 0 below a real draw', () => {
    expect(matchCount(0)).toBe(0)
    expect(matchCount(1)).toBe(0)
  })
})
