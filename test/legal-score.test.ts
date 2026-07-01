import { describe, expect, it } from 'vitest'
import type { MatchScore, ResultScoreError } from '../shared'
import { RESULT_SCORE_ERROR_MESSAGE, checkNormalScore, legalMtb, legalSet, resultScoreError } from '../shared'

// The legal score space (CONTEXT: Legal score, ADR-0045): Winsen plays two sets + a Match-Tie-Break to
// 10 as the third set (DTB §37.1), so the legal space is *closed* — an illegal score is impossible, not
// merely unwise, and is hard-blocked (server authority + drawer affordance, ADR-0011/0022/0033). These
// predicates are that one definition. `legalSet` judges one set's games pair, order-independent (either
// player may be slot 1): a set is `6:0…6:4`, `7:5`, or `7:6` — no advantage sets (the tiebreak decides
// 6:6, so 7:6 is the ceiling), never a tie.
describe('legalSet', () => {
  it.each<[[number, number], boolean]>([
    // Won at 6 with a two-game margin.
    [[6, 0], true],
    [[6, 1], true],
    [[6, 2], true],
    [[6, 3], true],
    [[6, 4], true],
    // 5:5 → played out to 7:5; 6:6 → tiebreak → 7:6. 7:6 is the ceiling.
    [[7, 5], true],
    [[7, 6], true],
    // Order-independent — slot 2 may be the winner.
    [[0, 6], true],
    [[5, 7], true],
    [[6, 7], true],
    // 6:5 is impossible — it goes to 7:5 or back to 6:6.
    [[6, 5], false],
    // No advantage sets — the tiebreak caps a set at 7:6.
    [[8, 6], false],
    // 7 games only ever beats 5 or 6, never a skipped-margin score.
    [[7, 0], false],
    [[7, 4], false],
    // Unfinished / tied / nonsense.
    [[6, 6], false],
    [[5, 5], false],
    [[0, 0], false],
    [[3, 1], false],
    // Out of range for a score entry — negatives and non-integers the server (int, 0…99) would reject, so
    // the client gate must reject them too or the save trap reopens (ADR-0045).
    [[6, -1], false],
    [[-1, 6], false],
    [[6, 3.5], false]
  ])('%j → %s', (pair, expected) => {
    expect(legalSet(pair)).toBe(expected)
  })
})

// `legalMtb` judges the Match-Tie-Break points pair: reach 10, win by 2, **open-ended** — the deciding
// set. The user flagged this on the report: a naive cap at 10 would be wrong (12:10 is real).
describe('legalMtb', () => {
  it.each<[[number, number], boolean]>([
    // Won at 10 with at least a two-point margin.
    [[10, 0], true],
    [[10, 7], true],
    [[10, 8], true],
    // Past 10 the game ends exactly at +2 — open-ended.
    [[11, 9], true],
    [[12, 10], true],
    [[15, 13], true],
    // Order-independent.
    [[8, 10], true],
    [[9, 11], true],
    // 10:9 is a one-point lead — play continues, not a final score.
    [[10, 9], false],
    [[11, 10], false],
    // Never under 10.
    [[9, 7], false],
    [[8, 6], false],
    // Above 10 the margin is exactly 2 — 11:8 (margin 3) can't happen.
    [[11, 8], false],
    [[13, 10], false],
    // Tie / nonsense.
    [[10, 10], false],
    [[0, 0], false],
    // Out of range: over the 99 cap (the MTB rule is open-ended, but the score entry is not) and non-integer.
    [[100, 98], false],
    [[10, 7.5], false]
  ])('%j → %s', (pair, expected) => {
    expect(legalMtb(pair)).toBe(expected)
  })
})

// `checkNormalScore` is the one verdict for a *normal* result — legality + decisiveness + the winner it
// implies. `ok` carries the derived winner; a rejection separates `incomplete` (fill in more) from
// `illegal` (an impossible score) so the drawer can word the disabled reason (ADR-0045).
describe('checkNormalScore', () => {
  it('accepts a straight-sets result and reports the winner', () => {
    expect(checkNormalScore({ set1: [6, 4], set2: [6, 3], mtb: null })).toEqual({ ok: true, winner: 1 })
  })

  it('accepts a 1:1 split decided by the MTB', () => {
    expect(checkNormalScore({ set1: [6, 4], set2: [4, 6], mtb: [7, 10] })).toEqual({ ok: true, winner: 2 })
  })

  it('rejects an unfinished result as incomplete', () => {
    expect(checkNormalScore({ set1: [6, 4], set2: null, mtb: null })).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('rejects a 1:1 split with no MTB as incomplete', () => {
    expect(checkNormalScore({ set1: [6, 4], set2: [4, 6], mtb: null })).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('rejects an impossible set as illegal', () => {
    expect(checkNormalScore({ set1: [8, 6], set2: [6, 3], mtb: null })).toEqual({ ok: false, reason: 'illegal' })
  })

  it('judges a filled illegal set illegal even when the other set is blank (reason matches the row flag)', () => {
    expect(checkNormalScore({ set1: [8, 6], set2: null, mtb: null })).toEqual({ ok: false, reason: 'illegal' })
  })

  it('rejects an impossible MTB as illegal', () => {
    expect(checkNormalScore({ set1: [6, 4], set2: [4, 6], mtb: [9, 7] })).toEqual({ ok: false, reason: 'illegal' })
  })

  it('rejects an MTB entered after a 2:0 (not needed) as illegal', () => {
    expect(checkNormalScore({ set1: [6, 4], set2: [6, 3], mtb: [10, 5] })).toEqual({ ok: false, reason: 'illegal' })
  })
})

// `resultScoreError` is the whole-request verdict the result schema refines against and the drawer mirrors
// (ADR-0045): it folds the outcome trichotomy — a walkover carries no score, a retirement's score is
// free-form (exempt), a normal result must be legal, decisive, and its winner must match the score — into
// one first-violation code (or null when valid).
describe('resultScoreError', () => {
  const empty: MatchScore = { set1: null, set2: null, mtb: null }

  it('accepts a walkover with no score', () => {
    expect(resultScoreError('walkover', empty, 1)).toBeNull()
  })

  it('rejects a walkover that carries a score', () => {
    expect(resultScoreError('walkover', { set1: [6, 0], set2: null, mtb: null }, 1)).toBe('walkover-has-score')
  })

  it('accepts a retirement with a partial (otherwise-illegal) score — exempt', () => {
    expect(resultScoreError('retirement', { set1: [6, 4], set2: [3, 2], mtb: null }, 2)).toBeNull()
  })

  it('accepts a normal result whose winner matches the score', () => {
    expect(resultScoreError(null, { set1: [6, 4], set2: [6, 3], mtb: null }, 1)).toBeNull()
  })

  it('rejects a normal result whose winner contradicts the score', () => {
    expect(resultScoreError(null, { set1: [6, 4], set2: [6, 3], mtb: null }, 2)).toBe('winner-mismatch')
  })

  it('rejects an incomplete normal result', () => {
    expect(resultScoreError(null, { set1: [6, 4], set2: null, mtb: null }, 1)).toBe('normal-incomplete')
  })

  it('rejects an illegal normal result', () => {
    expect(resultScoreError(null, { set1: [8, 6], set2: [6, 3], mtb: null }, 1)).toBe('normal-illegal')
  })

  it.each<ResultScoreError>(['walkover-has-score', 'normal-incomplete', 'normal-illegal', 'winner-mismatch'])(
    'has a German message for %s',
    code => {
      expect(RESULT_SCORE_ERROR_MESSAGE[code]).toMatch(/\S/)
    }
  )
})
