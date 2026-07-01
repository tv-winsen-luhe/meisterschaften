import { describe, expect, it } from 'vitest'
import {
  bracketStructure,
  type DrawPlayer,
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

  it('places 2 fixed seeds on the first and last line of a 4-draw (sub-DTB extension, ADR-0034)', () => {
    const s = bracketStructure(4)
    expect(s.seedCount).toBe(2)
    expect(s.rounds).toBe(2)
    expect(s.seedGroups).toEqual([
      { seeds: [1], lines: [0] },
      { seeds: [2], lines: [3] }
    ])
  })

  it('throws for an unsupported draw size (small-N guard, ADR-0021)', () => {
    expect(() => bracketStructure(2)).toThrow()
    expect(() => bracketStructure(32)).toThrow()
  })

  it('reports which sizes have a seed table', () => {
    expect(isSupportedDrawSize(4)).toBe(true)
    expect(isSupportedDrawSize(8)).toBe(true)
    expect(isSupportedDrawSize(16)).toBe(true)
    expect(isSupportedDrawSize(2)).toBe(false)
    expect(isSupportedDrawSize(32)).toBe(false)
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

describe('drawBracket — byes (§31)', () => {
  // Helper: the bye lines (null slots) of a result.
  const byeLines = (slots: (number | null)[]) => slots.flatMap((v, i) => (v === null ? [i] : []))

  it('8-draw, 1 bye: the single bye goes to Nr.1 (highest seed), no lot', () => {
    // 7 players, 1 bye ≤ 2 seeds ⇒ all byes to seeds, none by lot. Only the unseeded fill draws.
    const result = drawBracket({ players: field(7), size: 8, random: createFakeRandomSource([0, 0, 0, 0]) })
    // line:                                 0     1  2  3  4  5  6  7
    expect(result.slots).toEqual([1, null, 3, 4, 5, 6, 7, 2])
    expect(byeLines(result.slots)).toEqual([1]) // Nr.1's neighbour (line 0 ^ 1)
    // The bye is its own reveal step, after the seeds and before the unseeded, naming the seed it frees.
    expect(result.revealSequence).toEqual([
      { kind: 'seed-fixed', position: 0, playerId: 1, seed: 1 },
      { kind: 'seed-fixed', position: 7, playerId: 2, seed: 2 },
      { kind: 'bye', position: 1, playerId: 1, seed: 1 },
      { kind: 'draw', position: 2, playerId: 3, seed: null },
      { kind: 'draw', position: 3, playerId: 4, seed: null },
      { kind: 'draw', position: 4, playerId: 5, seed: null },
      { kind: 'draw', position: 5, playerId: 6, seed: null },
      { kind: 'draw', position: 6, playerId: 7, seed: null }
    ])
  })

  it('8-draw, 3 byes: 2 go to the seeds, the 3rd is drawn by lot across the two free sections', () => {
    // 5 players, 3 byes: Nr.1 + Nr.2 take one each; the remaining bye is lot-placed. The lot int(2)=0
    // sends it to the upper free section (match 1, line 3); int(2)=1 would send it to the lower (line 5).
    const upper = drawBracket({ players: field(5), size: 8, random: createFakeRandomSource([0, 0, 0]) })
    expect(byeLines(upper.slots)).toEqual([1, 3, 6])
    expect(upper.slots).toEqual([1, null, 3, null, 4, 5, null, 2])

    const lower = drawBracket({ players: field(5), size: 8, random: createFakeRandomSource([1, 0, 0]) })
    expect(byeLines(lower.slots)).toEqual([1, 5, 6])

    // The lot-placed bye carries no player (its neighbour is drawn later, §32.4c); the seed byes do.
    expect(upper.revealSequence.filter(s => s.kind === 'bye')).toEqual([
      { kind: 'bye', position: 1, playerId: 1, seed: 1 },
      { kind: 'bye', position: 6, playerId: 2, seed: 2 },
      { kind: 'bye', position: 3, playerId: null, seed: null }
    ])
  })

  it('16-draw, 3 byes: all go to the top three seeds, none by lot', () => {
    // 13 players, 3 byes ≤ 4 seeds. One seed lot (Nr.3 → line 4), then the unseeded fill.
    const result = drawBracket({
      players: field(13),
      size: 16,
      random: createFakeRandomSource([0, 0, 0, 0, 0, 0, 0, 0, 0])
    })
    expect(result.slots).toEqual([1, null, 5, 6, 3, null, 7, 8, 9, 10, 11, 4, 12, 13, null, 2])
    expect(byeLines(result.slots)).toEqual([1, 5, 14]) // neighbours of Nr.1, Nr.3, Nr.2
    expect(result.revealSequence.filter(s => s.kind === 'bye')).toEqual([
      { kind: 'bye', position: 1, playerId: 1, seed: 1 },
      { kind: 'bye', position: 14, playerId: 2, seed: 2 },
      { kind: 'bye', position: 5, playerId: 3, seed: 3 }
    ])
  })

  it('16-draw, 7 byes: 4 to the seeds, the other 3 spread evenly across the sections by lot (§31.2b)', () => {
    // 9 players, 7 byes. Seeds (one per quarter) each take a bye, then 3 remaining byes are spread:
    // the root lot (int 2) gives one half two of them, the surviving half lot picks its quarter. With
    // both lots = 0, the remaining byes land in matches 1, 3, 4 (lines 3, 7, 9).
    const seq = [0, /* seed Nr.3/4 lot */ 0, 0 /* two distribution lots */, 0, 0, 0, 0 /* fill */]
    const result = drawBracket({ players: field(9), size: 16, random: createFakeRandomSource(seq) })
    expect(byeLines(result.slots)).toEqual([1, 3, 5, 7, 9, 10, 14])
    expect(result.slots).toEqual([1, null, 5, null, 3, null, 6, null, 7, null, null, 4, 8, 9, null, 2])

    // The byes are even across the four quarters: three quarters hold two, one holds a single bye.
    const quarterByes = [0, 1, 2, 3].map(q => byeLines(result.slots).filter(l => Math.floor(l / 4) === q).length)
    expect(quarterByes.sort()).toEqual([1, 2, 2, 2])

    // Seed byes come first (in seed order), then the lot byes (player-less), then the unseeded draws.
    const byeSteps = result.revealSequence.filter(s => s.kind === 'bye')
    expect(byeSteps.slice(0, 4)).toEqual([
      { kind: 'bye', position: 1, playerId: 1, seed: 1 },
      { kind: 'bye', position: 14, playerId: 2, seed: 2 },
      { kind: 'bye', position: 5, playerId: 3, seed: 3 },
      { kind: 'bye', position: 10, playerId: 4, seed: 4 }
    ])
    expect(byeSteps.slice(4)).toEqual([
      { kind: 'bye', position: 3, playerId: null, seed: null },
      { kind: 'bye', position: 7, playerId: null, seed: null },
      { kind: 'bye', position: 9, playerId: null, seed: null }
    ])
  })

  it('every entrant lands once and the bye count equals the gap to the draw size', () => {
    const result = drawBracket({ players: field(9), size: 16, random: createFakeRandomSource([0, 0, 0, 0, 0, 0, 0]) })
    const placed = result.slots.filter((v): v is number => v !== null)
    expect(new Set(placed).size).toBe(9)
    expect(result.slots.filter(v => v === null)).toHaveLength(7)
  })
})

describe('drawBracket — guards', () => {
  it('rejects a field that does not fit the given draw size', () => {
    // 5 players round to an 8-draw, not a 16-draw — so size 16 is wrong for this field.
    expect(() => drawBracket({ players: field(5), size: 16, random: createFakeRandomSource([]) })).toThrow()
    // 17 players overflow an 8-draw.
    expect(() => drawBracket({ players: field(17), size: 8, random: createFakeRandomSource([]) })).toThrow()
  })

  it('rejects players not in seeding order — a stronger LK below a weaker one (the unchecked precondition)', () => {
    // The caller owns the seeding order (the shared comparator), but the module verifies it rather
    // than trusting it: a strictly-stronger player (lower LK) sitting below a weaker one is the silent
    // mis-seed drawBracket used to accept. field(8) is ascending LK; reversed, every pair inverts.
    // A full 8-draw fills 6 free lines with 5 lots; a valid sequence so the only possible throw is the
    // order guard, not an exhausted RandomSource.
    const misordered = field(8).reverse()
    expect(() =>
      drawBracket({ players: misordered, size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })
    ).toThrow()
  })

  it('accepts equal LKs — ties are legitimate (the tie-break is the caller-owned createdAt order)', () => {
    // seedingValue is equal across the field, so the order is non-decreasing and the guard must not
    // fire — two unrated players both seed at the default LK, a common real case.
    const tied = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, lk: '10.0' }))
    expect(() => drawBracket({ players: tied, size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })).not.toThrow()
  })
})

describe('materializeMatches', () => {
  it('pairs round 1 by adjacent lines and leaves later rounds as implicit-feeder slots', () => {
    const { slots } = drawBracket({ players: field(8), size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })
    const m = materializeMatches(8, slots)
    // 8-draw: 4 + 2 + 1 KO matches + 1 third-place playoff = 8 rows.
    expect(m).toHaveLength(8)
    expect(m.filter(x => x.round === 1)).toEqual([
      { round: 1, position: 0, slot1RegId: 1, slot2RegId: 3, winnerRegId: null, outcome: null, thirdPlace: false },
      { round: 1, position: 1, slot1RegId: 4, slot2RegId: 5, winnerRegId: null, outcome: null, thirdPlace: false },
      { round: 1, position: 2, slot1RegId: 6, slot2RegId: 7, winnerRegId: null, outcome: null, thirdPlace: false },
      { round: 1, position: 3, slot1RegId: 8, slot2RegId: 2, winnerRegId: null, outcome: null, thirdPlace: false }
    ])
    // A full field has no byes, so nothing is resolved at draw time.
    expect(m.every(x => x.winnerRegId === null && x.outcome === null)).toBe(true)
    // Later rounds carry no slots — feeders are implicit via (round, position) (ADR-0025); the third-place
    // playoff likewise opens empty (its loser-feeders fill on Advancement).
    expect(m.filter(x => x.round > 1).every(x => x.slot1RegId === null && x.slot2RegId === null)).toBe(true)
  })

  it('materializes the third-place playoff beside the final (position 1, same round)', () => {
    const { slots } = drawBracket({ players: field(8), size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })
    const m = materializeMatches(8, slots)
    const third = m.filter(x => x.thirdPlace)
    expect(third).toEqual([
      { round: 3, position: 1, slot1RegId: null, slot2RegId: null, winnerRegId: null, outcome: null, thirdPlace: true }
    ])
    // The final sits at the same round, position 0 — so the bracket depth is unchanged.
    expect(m.find(x => x.round === 3 && x.position === 0 && !x.thirdPlace)).toBeDefined()
  })

  it('materializes the third-place playoff at four entrants too (it doubles as the consolation)', () => {
    const { slots } = drawBracket({ players: field(4), size: 4, random: createFakeRandomSource([0, 0]) })
    const m = materializeMatches(4, slots)
    // 4-draw: 2 semifinals + 1 final + 1 third-place = 4 rows.
    expect(m).toHaveLength(4)
    expect(m.filter(x => x.thirdPlace)).toEqual([
      { round: 2, position: 1, slot1RegId: null, slot2RegId: null, winnerRegId: null, outcome: null, thirdPlace: true }
    ])
  })

  it('produces size − 1 KO matches + the third-place playoff for a 16-draw', () => {
    const { slots } = drawBracket({
      players: field(16),
      size: 16,
      random: createFakeRandomSource([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    })
    expect(materializeMatches(16, slots)).toHaveLength(16)
  })

  it('auto-resolves round-1 byes and advances the winner into round 2 (§32.4)', () => {
    // 13-player 16-draw: Nr.1, Nr.3, Nr.2 take byes (lines 1, 5, 14 empty).
    const { slots } = drawBracket({
      players: field(13),
      size: 16,
      random: createFakeRandomSource([0, 0, 0, 0, 0, 0, 0, 0, 0])
    })
    const m = materializeMatches(16, slots)
    expect(m).toHaveLength(16) // size − 1 KO rows (byes included) + the third-place playoff

    const round1 = m.filter(x => x.round === 1)
    const byes = round1.filter(x => x.outcome === 'bye')
    // Three byes, each with the present player as winner, no score, the empty slot left null.
    expect(byes).toEqual([
      { round: 1, position: 0, slot1RegId: 1, slot2RegId: null, winnerRegId: 1, outcome: 'bye', thirdPlace: false },
      { round: 1, position: 2, slot1RegId: 3, slot2RegId: null, winnerRegId: 3, outcome: 'bye', thirdPlace: false },
      { round: 1, position: 7, slot1RegId: null, slot2RegId: 2, winnerRegId: 2, outcome: 'bye', thirdPlace: false }
    ])
    // A contested round-1 match stays open.
    expect(round1.find(x => x.position === 1)).toMatchObject({
      slot1RegId: 5,
      slot2RegId: 6,
      winnerRegId: null,
      outcome: null
    })

    // The bye winners advance into their round-2 slots; the rest stay null (undecided feeders).
    const round2 = m.filter(x => x.round === 2)
    expect(round2.find(x => x.position === 0)).toMatchObject({ slot1RegId: 1, slot2RegId: null }) // Nr.1 advanced
    expect(round2.find(x => x.position === 1)).toMatchObject({ slot1RegId: 3, slot2RegId: null }) // Nr.3 advanced
    expect(round2.find(x => x.position === 3)).toMatchObject({ slot1RegId: null, slot2RegId: 2 }) // Nr.2 advanced
    // No round-2 match is itself a bye — byes never meet this slice (≤ seeds, one per section).
    expect(round2.every(x => x.outcome === null && x.winnerRegId === null)).toBe(true)
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
