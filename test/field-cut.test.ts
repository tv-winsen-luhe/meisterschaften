import { describe, expect, it } from 'vitest'
import { bySeedingLk, fieldCut } from '../shared'

// fieldCut is the field-cut (CONTEXT: Field cut, ADR-0065): given a field's *active* entries and the
// capacity, it orders them and draws the cut at capacity — above the line is in the field, below is a
// reserve (Nachrücker). **One rule for every field**: LK ascending (the scale runs 1.0 strongest … 25.0
// weakest), registration time breaking ties only. It takes no competition slug — the per-field-type split
// of ADR-0043 (Challenger and mixer by registration order, with a `provisional` flag to say whether the
// cut drifts) is gone, and with it the guarantee that a Challenger spot was secure once taken: every cut
// now drifts as LKs sync until the seeding freeze. Pure and generic over the entry shape, like
// challengerEligibility beside it.
const entry = (lk: string | null, createdAt: string) => ({ lk, createdAt })

describe('bySeedingLk', () => {
  it('orders by LK ascending (strongest first)', () => {
    const a = entry('18.0', '2026-01-03')
    const b = entry('12.5', '2026-01-01')
    const c = entry(null, '2026-01-02')
    const ordered = [a, b, c].sort(bySeedingLk)
    // 12.5 (strongest) → 18.0 → null (seeds as the weakest, 25.0).
    expect(ordered).toEqual([b, a, c])
  })

  it('breaks an LK tie by registration order — the only job registration time has left', () => {
    const early = entry('15.0', '2026-01-01')
    const late = entry('15.0', '2026-01-09')
    expect([late, early].sort(bySeedingLk)).toEqual([early, late])
  })

  it('orders a Challenger field by LK too — strength decides admission on every field now (ADR-0065)', () => {
    // The strongest entry registered last; it still sorts first. The inverse of the ADR-0043 rule.
    const first = entry('22.0', '2026-01-01')
    const second = entry('21.0', '2026-01-02')
    const strongLate = entry('2.0', '2026-01-09')
    expect([first, second, strongLate].sort(bySeedingLk)).toEqual([strongLate, second, first])
  })

  it('orders an unseeded Social mixer by the same rule — unrated entries all weigh 25.0, so the tie-break governs', () => {
    // The mixer is only nominally LK-cut: its entries carry no LK by construction, so they tie at 25.0 and
    // registration order decides — the same result as before, reached by the one comparator (ADR-0065).
    const first = entry(null, '2026-01-01')
    const second = entry(null, '2026-01-02')
    const strongLate = entry('2.0', '2026-01-09')
    expect([second, first, strongLate].sort(bySeedingLk)).toEqual([strongLate, first, second])
  })
})

describe('fieldCut', () => {
  it('marks the surplus beyond capacity as reserves, in cut order (by LK)', () => {
    const entries = [
      entry('20.0', '2026-01-01'),
      entry('8.0', '2026-01-02'),
      entry('14.0', '2026-01-03'),
      entry('11.0', '2026-01-04')
    ]
    const result = fieldCut(entries, 2)
    expect(result.inField).toBe(2)
    expect(result.reserves).toBe(2)
    // Ranked strongest-first; the top 2 are in the field, the rest reserves.
    expect(result.ranked.map(r => r.entry.lk)).toEqual(['8.0', '11.0', '14.0', '20.0'])
    expect(result.ranked.map(r => r.position)).toEqual([1, 2, 3, 4])
    expect(result.ranked.map(r => r.reserve)).toEqual([false, false, true, true])
  })

  it('cuts a Challenger field by LK — the strongest admitted take it, the weakest become reserves (ADR-0065)', () => {
    const entries = [
      entry('22.0', '2026-01-01'), // registered first, and now the reserve: strength decides
      entry('2.0', '2026-01-02'),
      entry('21.0', '2026-01-03')
    ]
    const result = fieldCut(entries, 2)
    expect(result.inField).toBe(2)
    expect(result.reserves).toBe(1)
    // Strength decides, not registration order — the deliberate reversal of ADR-0043's protected cut.
    expect(result.ranked.map(r => r.entry.createdAt)).toEqual(['2026-01-02', '2026-01-03', '2026-01-01'])
    expect(result.ranked.map(r => r.reserve)).toEqual([false, false, true])
  })

  it('cuts an unseeded Social mixer by the same rule; unrated ties fall back to registration order (ADR-0051)', () => {
    const entries = [entry(null, '2026-01-02'), entry(null, '2026-01-01'), entry('2.0', '2026-01-03')]
    const result = fieldCut(entries, 2)
    expect(result.inField).toBe(2)
    // The one rated entry leads; the two unrated tie at 25.0 and the earlier one takes the second spot.
    expect(result.ranked.map(r => r.entry.createdAt)).toEqual(['2026-01-03', '2026-01-01', '2026-01-02'])
    expect(result.ranked.map(r => r.reserve)).toEqual([false, false, true])
  })

  it('has no reserves when the field is at or below capacity', () => {
    const entries = [entry('10.0', '2026-01-01'), entry('12.0', '2026-01-02')]
    const result = fieldCut(entries, 8)
    expect(result.inField).toBe(2)
    expect(result.reserves).toBe(0)
    expect(result.ranked.every(r => !r.reserve)).toBe(true)
  })

  it('leaves the caller’s rows untouched (does not mutate the input order)', () => {
    const entries = [entry('20.0', '2026-01-01'), entry('5.0', '2026-01-02')]
    const snapshot = [...entries]
    fieldCut(entries, 8)
    expect(entries).toEqual(snapshot)
  })

  it('carries richer rows through unchanged (generic over the entry shape)', () => {
    const rows = [
      { id: 1, name: 'A', lk: '18.0', createdAt: '2026-01-02' },
      { id: 2, name: 'B', lk: '12.0', createdAt: '2026-01-01' }
    ]
    const result = fieldCut(rows, 8)
    expect(result.ranked.map(r => r.entry.id)).toEqual([2, 1])
  })

  it('an empty field cuts to nothing', () => {
    expect(fieldCut([], 8)).toEqual({ ranked: [], inField: 0, reserves: 0 })
  })
})
