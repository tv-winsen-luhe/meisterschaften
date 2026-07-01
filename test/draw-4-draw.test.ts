import { describe, expect, it } from 'vitest'
import { type DrawPlayer, drawBracket, materializeMatches } from '../shared'
import { createFakeRandomSource } from './fake-random'

// The 4-draw is our sub-DTB extension (ADR-0034): §30.5a's seed table starts at 8, so a 4-field reuses
// the 8-field's 2-seed pattern (Nr.1 → line 0, Nr.2 → line 3, both fixed, no lot). It lets tiny fields
// (e.g. a 4-player Damen draw) be cast at all. Two semifinals + final; no consolation bracket — at size
// 4 the first round *is* the semifinal, so the third-place match already pairs its losers (ADR-0004).

const field = (n: number): DrawPlayer[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, lk: `${i + 1}.0` }))

describe('drawBracket — 4-draw (sub-DTB extension, 2 fixed seeds, ADR-0034)', () => {
  it('full field: seeds fixed on lines 0 and 3, the two unseeded drawn into lines 1 and 2', () => {
    // 4 players, no byes. Both seeds fixed (no lot). One unseeded fill lot, then the last line takes
    // the last player: int(2)=0 ⇒ id3 → line 1, id4 → line 2.
    const result = drawBracket({ players: field(4), size: 4, random: createFakeRandomSource([0]) })
    expect(result.seeding).toEqual([
      { seed: 1, playerId: 1, lk: '1.0' },
      { seed: 2, playerId: 2, lk: '2.0' }
    ])
    expect(result.slots).toEqual([1, 3, 4, 2])
    expect(result.revealSequence).toEqual([
      { kind: 'seed-fixed', position: 0, playerId: 1, seed: 1 },
      { kind: 'seed-fixed', position: 3, playerId: 2, seed: 2 },
      { kind: 'draw', position: 1, playerId: 3, seed: null },
      { kind: 'draw', position: 2, playerId: 4, seed: null }
    ])
    // The final is the one round-2 match; round 1 is the two semifinals (size − 1 = 3 KO matches), plus
    // the third-place playoff materialized beside the final = 4 rows.
    expect(materializeMatches(4, result.slots)).toHaveLength(4)
  })

  it('3-player field: the single bye goes to Nr.1, the third player faces Nr.2', () => {
    const result = drawBracket({ players: field(3), size: 4, random: createFakeRandomSource([0]) })
    expect(result.slots).toEqual([1, null, 3, 2]) // Nr.1 on line 0, its bye on line 1, id3 vs Nr.2
    expect(result.revealSequence).toEqual([
      { kind: 'seed-fixed', position: 0, playerId: 1, seed: 1 },
      { kind: 'seed-fixed', position: 3, playerId: 2, seed: 2 },
      { kind: 'bye', position: 1, playerId: 1, seed: 1 },
      { kind: 'draw', position: 2, playerId: 3, seed: null }
    ])
    // The bye auto-resolves: Nr.1 advances to the final „ohne Spiel"; the other semifinal is contested.
    const m = materializeMatches(4, result.slots)
    expect(m.filter(x => x.round === 1)).toEqual([
      { round: 1, position: 0, slot1RegId: 1, slot2RegId: null, winnerRegId: 1, outcome: 'bye', thirdPlace: false },
      { round: 1, position: 1, slot1RegId: 3, slot2RegId: 2, winnerRegId: null, outcome: null, thirdPlace: false }
    ])
  })
})
