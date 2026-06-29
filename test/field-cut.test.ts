import { describe, expect, it } from 'vitest'
import { compareForCut, fieldCut } from '../shared'

// fieldCut is the field-cut (CONTEXT: Field cut, ADR-0043): given a field's *active* entries, the
// competition slug and the capacity, it orders them by the field-type rule and draws the cut at
// capacity — above the line is in the field, below is a reserve (Nachrücker). The criterion depends
// on the field type (isChallengerField): a championship field cuts by strength (LK ascending, the
// scale runs 1.0 strongest … 25.0 weakest), so the cut is *provisional* — LK drifts until the freeze;
// a Challenger field cuts by registration order (createdAt ascending), which never drifts, so it is
// stable. Pure and generic over the entry shape, like challengerEligibility beside it.
const entry = (lk: string | null, createdAt: string) => ({ lk, createdAt })

describe('compareForCut', () => {
  it('orders a championship field by LK ascending (strongest first)', () => {
    const a = entry('18.0', '2026-01-03')
    const b = entry('12.5', '2026-01-01')
    const c = entry(null, '2026-01-02')
    const ordered = [a, b, c].sort(compareForCut('mens'))
    // 12.5 (strongest) → 18.0 → null (seeds as the weakest, 25.0).
    expect(ordered).toEqual([b, a, c])
  })

  it('breaks an LK tie by registration order (championship), the same tie-break the draw uses', () => {
    const early = entry('15.0', '2026-01-01')
    const late = entry('15.0', '2026-01-09')
    expect([late, early].sort(compareForCut('mens'))).toEqual([early, late])
  })

  it('orders a Challenger field by registration order, ignoring LK (strength must not decide it)', () => {
    // The strongest entry registered last; in a Challenger field it still sorts last (first-come-first).
    const first = entry('22.0', '2026-01-01')
    const second = entry('21.0', '2026-01-02')
    const strongLate = entry('2.0', '2026-01-09')
    expect([strongLate, second, first].sort(compareForCut('mens-challenger'))).toEqual([first, second, strongLate])
  })
})

describe('fieldCut', () => {
  it('marks the surplus beyond capacity as reserves, in cut order (championship by LK)', () => {
    const entries = [
      entry('20.0', '2026-01-01'),
      entry('8.0', '2026-01-02'),
      entry('14.0', '2026-01-03'),
      entry('11.0', '2026-01-04')
    ]
    const result = fieldCut(entries, 'mens', 2)
    expect(result.inField).toBe(2)
    expect(result.reserves).toBe(2)
    expect(result.provisional).toBe(true)
    // Ranked strongest-first; the top 2 are in the field, the rest reserves.
    expect(result.ranked.map(r => r.entry.lk)).toEqual(['8.0', '11.0', '14.0', '20.0'])
    expect(result.ranked.map(r => r.position)).toEqual([1, 2, 3, 4])
    expect(result.ranked.map(r => r.reserve)).toEqual([false, false, true, true])
  })

  it('cuts a Challenger field by registration order and reports it as stable (not provisional)', () => {
    const entries = [
      entry('22.0', '2026-01-01'),
      entry('2.0', '2026-01-02'), // a strong late-ish entry — still secure, it registered second
      entry('21.0', '2026-01-03')
    ]
    const result = fieldCut(entries, 'mens-challenger', 2)
    expect(result.provisional).toBe(false)
    expect(result.inField).toBe(2)
    expect(result.reserves).toBe(1)
    // Registration order decides: the first two are in, regardless of strength.
    expect(result.ranked.map(r => r.entry.createdAt)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
    expect(result.ranked.map(r => r.reserve)).toEqual([false, false, true])
  })

  it('has no reserves when the field is at or below capacity', () => {
    const entries = [entry('10.0', '2026-01-01'), entry('12.0', '2026-01-02')]
    const result = fieldCut(entries, 'mens', 8)
    expect(result.inField).toBe(2)
    expect(result.reserves).toBe(0)
    expect(result.ranked.every(r => !r.reserve)).toBe(true)
  })

  it('leaves the caller’s rows untouched (does not mutate the input order)', () => {
    const entries = [entry('20.0', '2026-01-01'), entry('5.0', '2026-01-02')]
    const snapshot = [...entries]
    fieldCut(entries, 'mens', 8)
    expect(entries).toEqual(snapshot)
  })

  it('carries richer rows through unchanged (generic over the entry shape)', () => {
    const rows = [
      { id: 1, name: 'A', lk: '18.0', createdAt: '2026-01-02' },
      { id: 2, name: 'B', lk: '12.0', createdAt: '2026-01-01' }
    ]
    const result = fieldCut(rows, 'mens', 8)
    expect(result.ranked.map(r => r.entry.id)).toEqual([2, 1])
  })

  it('an empty field cuts to nothing', () => {
    expect(fieldCut([], 'mens', 8)).toEqual({ ranked: [], inField: 0, reserves: 0, provisional: true })
  })
})
