import { describe, expect, it } from 'vitest'
import {
  type ConsolationMatch,
  consolationBlocker,
  consolationEntrants,
  drawConsolationBracket,
  type DrawPlayer,
  firstMatchesDecided,
  hasConsolationBracket
} from '../shared'
import { createFakeRandomSource } from './fake-random'

// The consolation bracket (Nebenrunde, ADR-0004): the pure rules behind „Nebenrunde auslosen" — who
// enters (the lost-their-first-match set), when it may be drawn (every first match decided), and the draw
// itself (reusing the shared procedure). Deterministic — randomness enters through the fake RandomSource
// (ADR-0010), exactly as draw.test.ts drives the main draw.

// A match literal for one bracket position. `position` is irrelevant to the consolation rules (they key on
// round + slots), so it is omitted; the helper keeps the scenarios readable.
const match = (
  round: number,
  slot1RegId: number | null,
  slot2RegId: number | null,
  winnerRegId: number | null = null,
  outcome: ConsolationMatch['outcome'] = null,
  thirdPlace = false
): ConsolationMatch => ({ round, slot1RegId, slot2RegId, winnerRegId, outcome, thirdPlace })

// A full 8-draw, round 1 only: four contested matches (1v2, 3v4, 5v6, 7v8), the odd id winning each. The
// four losers (2, 4, 6, 8) are the consolation entrants; there are no byes and no bye-holder semis.
const full8Round1 = (): ConsolationMatch[] => [
  match(1, 1, 2, 1),
  match(1, 3, 4, 3),
  match(1, 5, 6, 5),
  match(1, 7, 8, 7)
]

// A 7-player 8-draw: one round-1 bye (holder 1), three contested round-1 matches, then two semifinals
// (round 2 IS the semifinal in a size-8 draw, depth 3). A bye-holder that loses its semifinal is a
// semifinal loser → the third-place match, NOT the consolation; the consolation is the three round-1
// losers. The bye-holder semifinal still gates the draw (it is the holder's first match).
const sevenPlayer = (semi0Winner: number | null, semi1Winner: number | null): ConsolationMatch[] => [
  match(1, 1, null, 1, 'bye'), // bye-holder 1
  match(1, 2, 3, 2), // loser 3
  match(1, 4, 5, 4), // loser 5
  match(1, 6, 7, 6), // loser 7
  match(2, 1, 2, semi0Winner), // semifinal with the bye-holder (1)
  match(2, 4, 6, semi1Winner), // semifinal between two round-1 winners
  match(3, null, null, null, null, true) // third-place playoff (never a first match)
]

describe('hasConsolationBracket', () => {
  it('is false at size 4 (the third-place match is the consolation) and below', () => {
    expect(hasConsolationBracket(4)).toBe(false)
    expect(hasConsolationBracket(2)).toBe(false)
  })
  it('is true from size 8 up (the first round lies before the semifinals)', () => {
    expect(hasConsolationBracket(8)).toBe(true)
    expect(hasConsolationBracket(16)).toBe(true)
  })
})

describe('consolationEntrants', () => {
  it('is the four round-1 losers in a full 8-draw', () => {
    expect(consolationEntrants(full8Round1())).toEqual([2, 4, 6, 8])
  })

  it('excludes a size-8 bye-holder semifinal loser — the third-place match is its second match', () => {
    // Bye-holder 1 loses its semifinal (winner 2). In a size-8 draw round 2 IS the semifinal, so 1 is a
    // semifinal loser bound for the third-place match, NOT the consolation. Only the round-1 losers enter.
    const entrants = consolationEntrants(sevenPlayer(2, 4))
    expect(entrants).not.toContain(1)
    expect(entrants.sort((a, b) => a - b)).toEqual([3, 5, 7])
  })

  it('never adds a round-2 loser in a size-8 draw, whoever wins the semifinals', () => {
    // Whether the bye-holder wins (1) or loses (2) its semifinal, no round-2 loser enters — round 2 is the
    // semifinal, so its losers are the third-place match's players. Only the three round-1 losers remain.
    expect(consolationEntrants(sevenPlayer(1, 4)).sort((a, b) => a - b)).toEqual([3, 5, 7])
    expect(consolationEntrants(sevenPlayer(2, 6)).sort((a, b) => a - b)).toEqual([3, 5, 7])
  })

  it('folds a bye-holder round-2 loser in when round 2 lies before the semifinal (size 16, depth 4)', () => {
    // A size-16-shaped fragment (a round-4 third-place row makes depth 4): round 2 is the quarterfinal, so
    // a bye-holder (10) losing there is a genuine pre-semifinal first-match loss and enters the consolation.
    const size16: ConsolationMatch[] = [
      match(1, 1, 2, 1), // round-1 loser 2
      match(1, 10, null, 10, 'bye'), // bye-holder 10
      match(2, 1, 10, 1), // quarterfinal: bye-holder 10 loses → entrant (round 2 is before the semifinal)
      match(4, null, null, null, null, true) // third-place at round 4 ⇒ depth 4
    ]
    expect(consolationEntrants(size16).sort((a, b) => a - b)).toEqual([2, 10])
  })

  it('ignores the third-place playoff and never yields a bye', () => {
    // A round-1 bye has no loser; the third-place row is not a first match. Neither contributes an entrant.
    const entrants = consolationEntrants([match(1, 1, null, 1, 'bye'), match(1, 2, 3, 2)])
    expect(entrants).toEqual([3])
  })

  it('leaves exactly two entrants in a 6-player 8-draw (two round-1 losers)', () => {
    // 6 players, 2 byes (to 1/2). Two contested round-1 matches (3v4, 5v6) → losers 4, 6. Both bye-holders
    // lose their semifinals but are excluded (semifinal losers → third place), so the consolation is {4, 6}.
    const matches: ConsolationMatch[] = [
      match(1, 1, null, 1, 'bye'),
      match(1, 2, null, 2, 'bye'),
      match(1, 3, 4, 3), // loser 4
      match(1, 5, 6, 5), // loser 6
      match(2, 1, 3, 3), // bye-holder 1 loses its semifinal → third place, NOT consolation
      match(2, 2, 5, 5), // bye-holder 2 loses its semifinal → third place, NOT consolation
      match(3, null, null, null, null, true)
    ]
    expect(consolationEntrants(matches).sort((a, b) => a - b)).toEqual([4, 6])
  })

  it('leaves a single entrant in a 5-player 8-draw — too few for a bracket', () => {
    // 5 players, 3 byes. One contested round-1 match (4v5) → loser 5, the only round-1 loser. The bye-holder
    // semifinal losers go to the third-place match, so there is just one consolation entrant (no bracket).
    const matches: ConsolationMatch[] = [
      match(1, 1, null, 1, 'bye'),
      match(1, 2, null, 2, 'bye'),
      match(1, 3, null, 3, 'bye'),
      match(1, 4, 5, 4), // loser 5
      match(2, 1, 2, 2),
      match(2, 3, 4, 3),
      match(3, null, null, null, null, true)
    ]
    expect(consolationEntrants(matches)).toEqual([5])
  })
})

describe('firstMatchesDecided', () => {
  it('is false while any contested round-1 match is undecided', () => {
    const matches = full8Round1()
    matches[2] = match(1, 5, 6, null) // one round-1 match still open
    expect(firstMatchesDecided(matches)).toBe(false)
  })

  it('is true once every round-1 match is decided in a full field (semis do not gate)', () => {
    expect(firstMatchesDecided(full8Round1())).toBe(true)
  })

  it('requires the bye-holder semifinal decided, but not the all-winners semifinal', () => {
    // Bye-holder semifinal (index 4) open ⇒ pending, even though every round-1 match is decided.
    expect(firstMatchesDecided(sevenPlayer(null, 4))).toBe(false)
    // Bye-holder semifinal decided, the all-winners semifinal (index 5) still open ⇒ already gated open.
    expect(firstMatchesDecided(sevenPlayer(2, null))).toBe(true)
  })
})

describe('consolationBlocker', () => {
  const decided8 = { size: 8, matches: full8Round1() }

  it('blocks until the main bracket is drawn', () => {
    expect(consolationBlocker(null, false)).toBe('main-not-drawn')
  })

  it('has no consolation bracket at draw size 4', () => {
    expect(consolationBlocker({ size: 4, matches: [] }, false)).toBe('no-consolation')
  })

  it('refuses a re-run once the consolation is drawn', () => {
    expect(consolationBlocker(decided8, true)).toBe('already-drawn')
  })

  it('blocks while first matches are still being played', () => {
    const pending = { size: 8, matches: [...full8Round1().slice(0, 3), match(1, 7, 8, null)] }
    expect(consolationBlocker(pending, false)).toBe('first-matches-pending')
  })

  it('blocks with too-few-entrants when a decided field yields fewer than two first-match losers', () => {
    // 5-player 8-draw, every first match decided: only one round-1 loser (the rest are semifinalists) — too
    // few to form a bracket, so the trigger stays disabled with an honest reason instead of enabling a 400.
    const fivePlayer = {
      size: 8,
      matches: [
        match(1, 1, null, 1, 'bye'),
        match(1, 2, null, 2, 'bye'),
        match(1, 3, null, 3, 'bye'),
        match(1, 4, 5, 4),
        match(2, 1, 2, 2),
        match(2, 3, 4, 3),
        match(3, null, null, null, null, true)
      ]
    }
    expect(consolationBlocker(fivePlayer, false)).toBe('too-few-entrants')
  })

  it('is drawable once every first match is decided and it is not yet drawn', () => {
    expect(consolationBlocker(decided8, false)).toBeNull()
  })
})

describe('drawConsolationBracket', () => {
  // Players in seeding order (strongest first); ids are the registration ids the bracket slots reference.
  const players = (ids: number[]): DrawPlayer[] => ids.map((id, i) => ({ id, lk: `${i + 1}.0` }))

  it('builds a single final for two entrants without drawing a lot', () => {
    // Two first-match losers (e.g. the two round-1 losers of a 6-player 8-draw): the stronger (first) is
    // seed 1; the shared draw has no size-2 table, so this is the hand-built single-final path.
    const random = createFakeRandomSource([]) // no lot to run
    const draw = drawConsolationBracket(players([4, 6]), random)
    expect(draw.size).toBe(2)
    expect(draw.seeding).toEqual([
      { seed: 1, playerId: 4, lk: '1.0' },
      { seed: 2, playerId: 6, lk: '2.0' }
    ])
    expect(draw.matches).toHaveLength(1)
    expect(draw.matches[0]).toMatchObject({ round: 1, position: 0, slot1RegId: 4, slot2RegId: 6, thirdPlace: false })
  })

  it('draws a real 4-entrant bracket and strips the third-place playoff', () => {
    const draw = drawConsolationBracket(players([2, 4, 6, 8]), createFakeRandomSource([0]))
    expect(draw.size).toBe(4)
    // A 4-draw is 3 KO matches (two semifinals + final); the consolation has NO third-place playoff.
    expect(draw.matches).toHaveLength(3)
    expect(draw.matches.some(m => m.thirdPlace)).toBe(false)
    expect(draw.seeding.map(s => s.seed)).toEqual([1, 2])
  })

  it('is deterministic under a fixed RandomSource (ADR-0010)', () => {
    const a = drawConsolationBracket(players([1, 2, 3, 4, 5, 6, 7, 8]), createFakeRandomSource([0, 0, 0, 0, 0]))
    const b = drawConsolationBracket(players([1, 2, 3, 4, 5, 6, 7, 8]), createFakeRandomSource([0, 0, 0, 0, 0]))
    expect(a.size).toBe(8)
    expect(a.matches).toEqual(b.matches)
  })

  it('refuses fewer than two entrants (no bracket to form)', () => {
    expect(() => drawConsolationBracket(players([1]), createFakeRandomSource([]))).toThrow()
  })
})
