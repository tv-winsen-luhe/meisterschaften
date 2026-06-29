import { describe, expect, it } from 'vitest'
import { validatePlacement } from '../shared/schedule'
import type { Placement } from '../shared/schedule'

// The finals-day soft rule (ADR-0040): the main bracket's semifinals and final belong on Sunday (the last
// event day). Placed earlier they are nudged — soft, overridable — never hard-blocked. Kept in its own
// file beside evening-window.test.ts (one validator rule per file).

interface MatchOpts {
  p?: [number | null, number | null]
  at?: Placement
  bracket?: string
}

// A placeable „mens" match; round-1 slots default to distinct players so nothing else trips.
const pm = (
  id: number,
  round: number,
  position: number,
  { p = [null, null], at, bracket = 'main' }: MatchOpts = {}
) => ({
  id,
  competition: 'mens',
  bracket,
  round,
  position,
  slot1RegId: p[0],
  slot2RegId: p[1],
  outcome: null,
  court: at?.court ?? null,
  day: at?.day ?? null,
  slot: at?.slot ?? null
})

// An 8-draw: 4 quarterfinals (round 1), 2 semifinals (round 2), the final (round 3). The bracket's depth
// is read from its own match set, so the semifinal is round (lastRound − 1) and the final is lastRound;
// Sunday (day 1, the last event day) is the finals day they belong on.
const eight = [
  pm(1, 1, 0, { p: [1, 2] }),
  pm(2, 1, 1, { p: [3, 4] }),
  pm(3, 1, 2, { p: [5, 6] }),
  pm(4, 1, 3, { p: [7, 8] }),
  pm(5, 2, 0),
  pm(6, 2, 1),
  pm(7, 3, 0)
]

describe('validatePlacement · finals day (ADR-0040)', () => {
  it('nudges a semifinal or final placed off Sunday — soft, not blocked', () => {
    // The semifinal (M5) on Saturday (day 0): a soft finals-day reminder, no hard block.
    const sf = validatePlacement(eight, { id: 5, placement: { court: 1, day: 0, slot: 6 } })
    expect(sf.hard).toEqual([])
    expect(sf.soft).toContainEqual({ rule: 'finals-day', round: 2 })
    // The final (M7) on Saturday is nudged too.
    const fin = validatePlacement(eight, { id: 7, placement: { court: 1, day: 0, slot: 9 } })
    expect(fin.soft).toContainEqual({ rule: 'finals-day', round: 3 })
  })

  it('does not nudge the semifinal/final once it sits on Sunday (the finals day)', () => {
    const sf = validatePlacement(eight, { id: 5, placement: { court: 1, day: 1, slot: 0 } })
    expect(sf.soft).toEqual([])
  })

  it('does not nudge a quarterfinal on Saturday (only the last two rounds are reserved)', () => {
    const qf = validatePlacement(eight, { id: 1, placement: { court: 1, day: 0, slot: 0 } })
    expect(qf.soft).toEqual([])
  })

  it('carries no finals-day preference for the consolation bracket', () => {
    // A consolation final (round 2 of a 2-round consolation) on Saturday — never nudged.
    const conso = [
      pm(10, 1, 0, { p: [1, 2], bracket: 'consolation' }),
      pm(11, 1, 1, { p: [3, 4], bracket: 'consolation' }),
      pm(12, 2, 0, { bracket: 'consolation' })
    ]
    const { soft } = validatePlacement(conso, { id: 12, placement: { court: 1, day: 0, slot: 6 } })
    expect(soft).toEqual([])
  })
})
