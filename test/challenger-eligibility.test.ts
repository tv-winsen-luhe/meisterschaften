import { describe, expect, it } from 'vitest'
import { CHALLENGER_MIN_LK, challengerEligibility, isTooStrongForChallenger } from '../shared'

// challengerEligibility is the field-level Challenger judgment, owned once in shared/ (ADR-0011): it
// is both the draw guard's authority (a too-strong entry blocks the field's draw on the frozen LKs,
// ADR-0024) and the provisional seeding list's affordance (mark too-strong entries before the draw).
// Pure and threshold-parameterised; it does not gate on competition — the caller already holds the
// Challenger field's entries. "Too strong" is an LK *below* the cap (the scale runs 1.0 strongest …
// 25.0 weakest), and a missing/unratable LK seeds at the weakest (25.0), so it is never too strong.
describe('challengerEligibility', () => {
  const entry = (lk: string | null) => ({ lk })

  it('flags entries stronger than the threshold, keeping input order', () => {
    const entries = [entry('18.0'), entry('20.0'), entry('12.5'), entry(null), entry('25.0')]
    const result = challengerEligibility(entries, CHALLENGER_MIN_LK)
    expect(result.eligible).toBe(false)
    expect(result.tooStrong).toEqual([entry('18.0'), entry('12.5')])
  })

  it('is eligible when every entry is at or weaker than the threshold', () => {
    const result = challengerEligibility([entry('20.0'), entry('22.0'), entry(null)], CHALLENGER_MIN_LK)
    expect(result.eligible).toBe(true)
    expect(result.tooStrong).toEqual([])
  })

  it('treats the threshold itself as eligible (the cap is the weakest allowed, not too strong)', () => {
    // CHALLENGER_MIN_LK == 20: LK 20.0 is the protected boundary and stays in; only < 20 is too strong.
    expect(challengerEligibility([entry('20.0')], CHALLENGER_MIN_LK).eligible).toBe(true)
    expect(challengerEligibility([entry('19.9')], CHALLENGER_MIN_LK).tooStrong).toEqual([entry('19.9')])
  })

  it('treats a missing or unratable LK as the weakest (25.0), never too strong', () => {
    const result = challengerEligibility([entry(null), entry(''), entry('abc')], CHALLENGER_MIN_LK)
    expect(result.eligible).toBe(true)
    expect(result.tooStrong).toEqual([])
  })

  it('honours the passed threshold rather than the constant (the draw tunes the cap, ADR-0024)', () => {
    const entries = [entry('14.0'), entry('16.0')]
    // A higher cap protects more strongly (too strong = below it): 15 rejects 14.0, admits 16.0.
    expect(challengerEligibility(entries, 15).tooStrong).toEqual([entry('14.0')])
    // A lower cap of 10 admits everything weaker than it.
    expect(challengerEligibility(entries, 10).eligible).toBe(true)
  })

  it('an empty field is trivially eligible', () => {
    expect(challengerEligibility([], CHALLENGER_MIN_LK)).toEqual({ eligible: true, tooStrong: [] })
  })

  it('carries the caller’s richer rows through unchanged (generic over the entry shape)', () => {
    const rows = [
      { id: 1, name: 'A', lk: '18.0' },
      { id: 2, name: 'B', lk: '21.0' }
    ]
    expect(challengerEligibility(rows, CHALLENGER_MIN_LK).tooStrong).toEqual([{ id: 1, name: 'A', lk: '18.0' }])
  })
})

// isTooStrongForChallenger is the confirm-time sibling: gated to the Challenger field and the fixed
// CHALLENGER_MIN_LK, it raises the soft confirm hint (ADR-0024). It now shares the single-entry core
// with challengerEligibility, so the two can never disagree on what "too strong" means.
describe('isTooStrongForChallenger', () => {
  it.each([
    ['mens-challenger', '15.0', true],
    ['mens-challenger', '19.9', true],
    ['mens-challenger', '20.0', false],
    ['mens-challenger', '25.0', false],
    ['mens-challenger', null, false],
    ['mens-challenger', 'abc', false],
    // The whole `-challenger` family is judged (fail-closed): the planned Damen Freizeit field is
    // cap-gated the moment it goes live, not silently exempt.
    ['womens-challenger', '15.0', true],
    // Championship fields are never judged — the cap is the Challenger family's alone.
    ['mens', '5.0', false],
    ['womens', '5.0', false]
  ])('%s LK %s → %s', (competition, lk, expected) => {
    expect(isTooStrongForChallenger(competition, lk)).toBe(expected)
  })
})
