import { describe, expect, it } from 'vitest'
import { slotGames } from '../shared'

// `slotGames` (shared/schedule.ts) is the single „which games" rule the admin results surface and the
// public live board both render from (#91) — the games (or MTB points) a slot won across the best-of-2 +
// Match-Tie-Break, in order. Pinned here so a change to it lands on both surfaces intentionally.

describe('slotGames', () => {
  it('returns each slot’s games in order for a straight-sets result', () => {
    const score = { set1: [6, 3] as [number, number], set2: [6, 4] as [number, number], mtb: null }
    expect(slotGames(score, 1)).toEqual([6, 6])
    expect(slotGames(score, 2)).toEqual([3, 4])
  })

  it('includes the Match-Tie-Break points at 1:1', () => {
    const score = {
      set1: [6, 4] as [number, number],
      set2: [3, 6] as [number, number],
      mtb: [10, 8] as [number, number]
    }
    expect(slotGames(score, 1)).toEqual([6, 3, 10])
    expect(slotGames(score, 2)).toEqual([4, 6, 8])
  })

  it('is empty when no set is recorded (a walkover or not-yet-played match)', () => {
    expect(slotGames({ set1: null, set2: null, mtb: null }, 1)).toEqual([])
  })

  it('shows just the saved set of a match still in progress (ADR-0032 §20)', () => {
    expect(slotGames({ set1: [6, 3] as [number, number], set2: null, mtb: null }, 1)).toEqual([6])
  })
})
