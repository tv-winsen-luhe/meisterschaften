import { describe, expect, it } from 'vitest'
import { isUnplaced } from '../shared/schedule'

// The backlog predicate (shared/schedule.ts): the single definition of „unplaced" the admin backlog tray
// filters by and the publish confirm counts (#156, ADR-0041). Split out of schedule.test.ts, which is at
// its line cap, the same way evening-window.test.ts carves off the evening-window helpers. Deterministic,
// no deps.

describe('isUnplaced', () => {
  it('is true for a match with no court (in the backlog) and false once placed', () => {
    expect(isUnplaced({ court: null })).toBe(true)
    expect(isUnplaced({ court: 1 })).toBe(false)
  })

  it('counts the backlog when filtering a grid set — the number the publish confirm names (#156)', () => {
    // The grid set already excludes byes and un-revealed matches upstream, so a null court is the whole
    // test: two of these four are still in the backlog.
    const matches = [{ court: null }, { court: 3 }, { court: null }, { court: 1 }]
    expect(matches.filter(isUnplaced)).toHaveLength(2)
  })
})
