import { describe, expect, it } from 'vitest'
import { ACTIVE_STATUSES, isActive, REGISTRATION_STATUSES } from '../shared'

// isActive is the one home for the "still participating" predicate (CONTEXT.md: Active entry).
// Defined positively over {new, confirmed} so a future status is inactive until explicitly classed
// active — the safe-failure direction for the "one active entry per member" invariant.
describe('isActive', () => {
  it.each([
    ['new', true],
    ['confirmed', true],
    ['cancelled', false]
  ] as const)('%s → %s', (status, expected) => {
    expect(isActive(status)).toBe(expected)
  })

  it('ACTIVE_STATUSES is exactly the participating subset', () => {
    expect([...ACTIVE_STATUSES]).toEqual(['new', 'confirmed'])
  })

  it('every status is either active or cancelled', () => {
    for (const status of REGISTRATION_STATUSES) {
      expect(isActive(status)).toBe(status !== 'cancelled')
    }
  })
})
