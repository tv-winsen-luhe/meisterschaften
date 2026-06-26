import { describe, expect, it } from 'vitest'
import { byeCount, drawSize } from '../shared'

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
