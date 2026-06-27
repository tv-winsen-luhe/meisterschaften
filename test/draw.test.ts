import { describe, expect, it } from 'vitest'
import {
  bracketStructure,
  type DrawPlayer,
  drawBlocker,
  drawBracket,
  createCryptoRandomSource,
  isSupportedDrawSize,
  materializeMatches
} from '../shared'
import { createFakeRandomSource } from './fake-random'

// The pure draw procedure (CONTEXT: Draw procedure, ADR-0025). Exact-bracket tests against a fixed
// fake RandomSource: a known lot sequence yields a known seeding + slots + reveal sequence, so the
// DTB rule (Nr.1 first line, Nr.2 last line, Nr.3/4 by lot, unseeded einlosen von oben nach unten)
// is pinned, not just smoke-tested. Randomness is the only non-determinism, and it is injected.

// n players in seeding order (strongest first): ids 1..n, LK ascending so the order is obvious.
const field = (n: number): DrawPlayer[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, lk: `${i + 1}.0` }))

describe('bracketStructure', () => {
  it('places 2 seeds on the first and last line of an 8-draw', () => {
    const s = bracketStructure(8)
    expect(s.seedCount).toBe(2)
    expect(s.rounds).toBe(3)
    expect(s.seedGroups).toEqual([
      { seeds: [1], lines: [0] },
      { seeds: [2], lines: [7] }
    ])
  })

  it('places Nr.3/4 as a lot group on lines 5 and 12 of a 16-draw', () => {
    const s = bracketStructure(16)
    expect(s.seedCount).toBe(4)
    expect(s.rounds).toBe(4)
    expect(s.seedGroups).toEqual([
      { seeds: [1], lines: [0] },
      { seeds: [2], lines: [15] },
      { seeds: [3, 4], lines: [4, 11] }
    ])
  })

  it('throws for an unsupported draw size (small-N guard, ADR-0021)', () => {
    expect(() => bracketStructure(32)).toThrow()
  })

  it('reports which sizes have a seed table', () => {
    expect(isSupportedDrawSize(8)).toBe(true)
    expect(isSupportedDrawSize(16)).toBe(true)
    expect(isSupportedDrawSize(4)).toBe(false)
    expect(isSupportedDrawSize(32)).toBe(false)
  })
})

// The shared draw gate the worker enforces and the admin button renders (ADR-0011) — so a size the
// math can't handle (e.g. a full field of 4 or 32) is blocked, never crashed.
describe('drawBlocker', () => {
  it('blocks until registration is closed', () => {
    expect(drawBlocker('signup', 8)).toBe('not-tournament')
    expect(drawBlocker('post-event', 8)).toBe('not-tournament')
  })

  it('blocks fewer than two entries', () => {
    expect(drawBlocker('tournament', 0)).toBe('too-few')
    expect(drawBlocker('tournament', 1)).toBe('too-few')
  })

  it('blocks a field with Freilose (not a power of two)', () => {
    expect(drawBlocker('tournament', 7)).toBe('not-full-field')
    expect(drawBlocker('tournament', 12)).toBe('not-full-field')
  })

  it('blocks a full field whose size has no seed table (2, 4, 32)', () => {
    expect(drawBlocker('tournament', 2)).toBe('unsupported-size')
    expect(drawBlocker('tournament', 4)).toBe('unsupported-size')
    expect(drawBlocker('tournament', 32)).toBe('unsupported-size')
  })

  it('allows a full, supported field', () => {
    expect(drawBlocker('tournament', 8)).toBeNull()
    expect(drawBlocker('tournament', 16)).toBeNull()
  })
})

describe('drawBracket — 8-draw (full field, 2 fixed seeds)', () => {
  // 8 players, no seed lot (both seeds fixed). The unseeded fill draws once per free line top→bottom;
  // the last line takes the last player with no draw, so 5 lots fill the 6 free lines.
  const sequence = [5, 0, 2, 0, 1]
  const result = drawBracket({ players: field(8), size: 8, random: createFakeRandomSource(sequence) })

  it('snapshots the two seeds in seed order with their LK', () => {
    expect(result.seeding).toEqual([
      { seed: 1, playerId: 1, lk: '1.0' },
      { seed: 2, playerId: 2, lk: '2.0' }
    ])
  })

  it('fills the bracket: seeds fixed on lines 0 and 7, unseeded drawn into the free lines', () => {
    // line:        0  1  2  3  4  5  6  7
    expect(result.slots).toEqual([1, 8, 3, 6, 4, 7, 5, 2])
  })

  it('reveals seeds first (fixed), then unseeded top→bottom — each carrying its kind', () => {
    expect(result.revealSequence).toEqual([
      { kind: 'seed-fixed', position: 0, playerId: 1, seed: 1 },
      { kind: 'seed-fixed', position: 7, playerId: 2, seed: 2 },
      { kind: 'draw', position: 1, playerId: 8, seed: null },
      { kind: 'draw', position: 2, playerId: 3, seed: null },
      { kind: 'draw', position: 3, playerId: 6, seed: null },
      { kind: 'draw', position: 4, playerId: 4, seed: null },
      { kind: 'draw', position: 5, playerId: 7, seed: null },
      { kind: 'draw', position: 6, playerId: 5, seed: null }
    ])
  })

  it('is deterministic in the RandomSource — a different lot yields a different bracket', () => {
    const other = drawBracket({ players: field(8), size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })
    expect(other.slots).toEqual([1, 3, 4, 5, 6, 7, 8, 2])
    expect(other.slots).not.toEqual(result.slots)
  })
})

describe('drawBracket — 16-draw (full field, Nr.3/4 by lot)', () => {
  // One int(2) decides the 3/4 lot, then 11 lots fill the 12 free lines (last needs none).
  // int(2)=1 ⇒ Nr.3 → line 11, Nr.4 → line 4; the rest is a front-first fill (all zeros).
  const sequence = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const result = drawBracket({ players: field(16), size: 16, random: createFakeRandomSource(sequence) })

  it('snapshots four seeds', () => {
    expect(result.seeding.map(s => [s.seed, s.playerId])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4]
    ])
  })

  it('places the lot seeds onto their prescribed lines and fills the rest', () => {
    // 0:Nr1  4:Nr4  11:Nr3  15:Nr2, unseeded 5..16 into the free lines top→bottom.
    expect(result.slots).toEqual([1, 5, 6, 7, 4, 8, 9, 10, 11, 12, 13, 3, 14, 15, 16, 2])
  })

  it('marks the 3/4 placements as seed-lot, in seed order', () => {
    const seedSteps = result.revealSequence.filter(s => s.seed !== null)
    expect(seedSteps).toEqual([
      { kind: 'seed-fixed', position: 0, playerId: 1, seed: 1 },
      { kind: 'seed-fixed', position: 15, playerId: 2, seed: 2 },
      { kind: 'seed-lot', position: 11, playerId: 3, seed: 3 },
      { kind: 'seed-lot', position: 4, playerId: 4, seed: 4 }
    ])
  })

  it('swaps the 3/4 lines on the other lot outcome', () => {
    const swapped = drawBracket({
      players: field(16),
      size: 16,
      random: createFakeRandomSource([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    })
    // int(2)=0 ⇒ Nr.3 → line 4, Nr.4 → line 11 (mirror of the run above).
    expect(swapped.slots[4]).toBe(3)
    expect(swapped.slots[11]).toBe(4)
  })

  it('reveals every entrant exactly once', () => {
    expect(result.revealSequence).toHaveLength(16)
    expect(new Set(result.revealSequence.map(s => s.playerId)).size).toBe(16)
  })
})

describe('drawBracket — guards', () => {
  it('rejects a field that is not a full bracket', () => {
    expect(() => drawBracket({ players: field(7), size: 8, random: createFakeRandomSource([]) })).toThrow()
  })
})

describe('materializeMatches', () => {
  it('pairs round 1 by adjacent lines and leaves later rounds as implicit-feeder slots', () => {
    const { slots } = drawBracket({ players: field(8), size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })
    const m = materializeMatches(8, slots)
    // 8-draw: 4 + 2 + 1 = 7 matches.
    expect(m).toHaveLength(7)
    expect(m.filter(x => x.round === 1)).toEqual([
      { round: 1, position: 0, slot1RegId: 1, slot2RegId: 3 },
      { round: 1, position: 1, slot1RegId: 4, slot2RegId: 5 },
      { round: 1, position: 2, slot1RegId: 6, slot2RegId: 7 },
      { round: 1, position: 3, slot1RegId: 8, slot2RegId: 2 }
    ])
    // Later rounds carry no slots — feeders are implicit via (round, position) (ADR-0025).
    expect(m.filter(x => x.round > 1).every(x => x.slot1RegId === null && x.slot2RegId === null)).toBe(true)
  })

  it('produces size − 1 matches for a 16-draw', () => {
    const { slots } = drawBracket({
      players: field(16),
      size: 16,
      random: createFakeRandomSource([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    })
    expect(materializeMatches(16, slots)).toHaveLength(15)
  })
})

describe('createCryptoRandomSource', () => {
  it('returns unbiased integers within [0, n)', () => {
    const r = createCryptoRandomSource()
    for (let k = 0; k < 200; k++) {
      const v = r.int(6)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('always returns 0 for n = 1 (no entropy needed)', () => {
    expect(createCryptoRandomSource().int(1)).toBe(0)
  })
})
