import { describe, expect, it } from 'vitest'
import { formatDate, formatRelative } from '../src/admin/lib/format'

// formatRelative is the admin detail panel's "aktualisiert vor …" helper. It is kept pure and
// separate from the surface so its robustness is tested in isolation. Regression guard: a non-ISO
// `updatedAt` once reached it (a stale local D1 missing the updated_at column had SQLite return the
// literal column name "updated_at" for every row), and Intl.RelativeTimeFormat.format throws a
// RangeError on the resulting NaN — an unhandled throw in render blanked the whole client:only
// admin island. It must degrade to '' (no relative time), never throw.
describe('formatRelative', () => {
  it("returns '' for an unparseable timestamp instead of throwing", () => {
    expect(() => formatRelative('updated_at')).not.toThrow()
    expect(formatRelative('updated_at')).toBe('')
    expect(formatRelative('not a date')).toBe('')
    expect(formatRelative('')).toBe('')
  })

  it('formats a valid ISO timestamp into a German relative phrase', () => {
    // A long-past date is unambiguously "vor … Tagen" regardless of when the test runs (the count
    // carries a German thousands separator, e.g. "vor 9.674 Tagen").
    expect(formatRelative('2000-01-01T00:00:00Z')).toMatch(/^vor [\d.]+ Tagen$/)
  })
})

describe('formatDate', () => {
  it('formats a stored ISO timestamp as a German long date', () => {
    expect(formatDate('2026-08-14T10:00:00Z')).toBe('14. August 2026')
  })
})
