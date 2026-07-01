import { describe, expect, it } from 'vitest'
import { earliestPlaceableSlot, numberMatches, SLOT_SPAN, slotLabel, validatePlacement, viewSlot } from '../shared'

// The third-place playoff in the schedule helpers (#90): its slots are fed by the semifinal *losers*, not
// the implicit winner-feeders the round/position topology expresses — so it displays as „Verlierer M{n}"
// and its feeder-order floor is the two semifinals. Split from schedule.test.ts so each stays under the
// file budget. Prior art: schedule.test.ts (the helpers these extend).

// A minimal bracket position (the display helpers' input), with the third-place flag.
const m = (
  id: number,
  round: number,
  position: number,
  slot1: number | null = null,
  slot2: number | null = null,
  thirdPlace = false
) => ({
  id,
  round,
  position,
  slot1RegId: slot1,
  slot2RegId: slot2,
  thirdPlace
})

// A placed/placeable match in the „mens" main bracket (the validator's input), with the third-place flag.
interface PmCell {
  court: number
  day: number
  slot: number
}
interface PmOpts {
  p?: [number | null, number | null]
  at?: PmCell
  thirdPlace?: boolean
}
const pm = (id: number, round: number, position: number, opts: PmOpts = {}) => ({
  id,
  competition: 'mens',
  bracket: 'main',
  round,
  position,
  slot1RegId: opts.p?.[0] ?? null,
  slot2RegId: opts.p?.[1] ?? null,
  outcome: null,
  thirdPlace: opts.thirdPlace ?? false,
  court: opts.at?.court ?? null,
  day: opts.at?.day ?? null,
  slot: opts.at?.slot ?? null
})

describe('viewSlot / slotLabel — third-place playoff', () => {
  it('shows a third-place playoff slot as the loser of the same-numbered semifinal', () => {
    // A 4-draw: two semifinals (M1, M2) and the third-place playoff (round 2, position 1). Its slots wait
    // on the *losers* of M1 (slot 1) and M2 (slot 2), so they read „Verlierer M{n}".
    const tp = m(4, 2, 1, null, null, true)
    const all = [m(1, 1, 0, 101, 102), m(2, 1, 1, 103, 104), tp]
    const nums = numberMatches(all)
    const lookup = (round: number, position: number) => all.find(x => x.round === round && x.position === position)
    expect(viewSlot(tp, 1, nums, lookup)).toEqual({ kind: 'loser', matchNumber: 1 })
    expect(viewSlot(tp, 2, nums, lookup)).toEqual({ kind: 'loser', matchNumber: 2 })
  })

  it('labels a loser slot „Verlierer M{n}"', () => {
    expect(slotLabel({ kind: 'loser', matchNumber: 2 })).toBe('Verlierer M2')
  })
})

describe('earliestPlaceableSlot — third-place playoff', () => {
  const bm = (id: number, round: number, position: number, thirdPlace = false) =>
    pm(id, round, position, { thirdPlace })

  it('floors the playoff one interval after its semifinals — like the final (8-draw)', () => {
    // 8-draw: 4 QF, 2 SF, the final, and the third-place playoff (round 3, position 1). It is fed by the
    // two semifinals (the losers), so its earliest is the same two intervals as the final (QF → SF → here).
    const matches = [
      bm(1, 1, 0),
      bm(2, 1, 1),
      bm(3, 1, 2),
      bm(4, 1, 3),
      bm(5, 2, 0),
      bm(6, 2, 1),
      bm(7, 3, 0),
      bm(8, 3, 1, true)
    ]
    expect(earliestPlaceableSlot(matches[7], matches)).toBe(2 * SLOT_SPAN)
  })

  it('floors a 4-draw playoff one interval after its semifinals', () => {
    const matches = [bm(1, 1, 0), bm(2, 1, 1), bm(3, 2, 0), bm(4, 2, 1, true)]
    expect(earliestPlaceableSlot(matches[3], matches)).toBe(SLOT_SPAN)
  })
})

describe('validatePlacement — third-place playoff loser-feeders', () => {
  // A 4-draw: two semifinals (M1 r1p0, M2 r1p1), the final (M3 r2p0), and the third-place playoff (M4 r2p1).
  const semi1 = pm(1, 1, 0, { p: [101, 102] })
  const semi2 = pm(2, 1, 1, { p: [103, 104] })
  const final = pm(3, 2, 0)
  const third = pm(4, 2, 1, { thirdPlace: true })

  it('blocks the playoff before a feeding semifinal has finished', () => {
    // Semifinal M1 starts at slot 3; the playoff at the same slot is inside M1's 90 minutes.
    const matches = [{ ...semi1, court: 1, day: 0, slot: 3 }, { ...semi2, court: 2, day: 0, slot: 0 }, final, third]
    const { hard } = validatePlacement(matches, { id: 4, placement: { court: 3, day: 0, slot: 3 } })
    expect(hard).toContainEqual({ rule: 'feeder-order', otherMatchId: 1 })
  })

  it('blocks a semifinal placed at or after the third-place playoff it feeds (the reverse direction)', () => {
    const matches = [semi1, semi2, final, { ...third, court: 1, day: 0, slot: SLOT_SPAN }]
    const { hard } = validatePlacement(matches, { id: 1, placement: { court: 2, day: 0, slot: SLOT_SPAN } })
    expect(hard).toContainEqual({ rule: 'feeder-order', otherMatchId: 4 })
  })

  it('accepts the playoff one interval after both semifinals', () => {
    const matches = [{ ...semi1, court: 1, day: 1, slot: 0 }, { ...semi2, court: 2, day: 1, slot: 0 }, final, third]
    const { hard } = validatePlacement(matches, { id: 4, placement: { court: 3, day: 1, slot: SLOT_SPAN } })
    expect(hard).toEqual([])
  })
})
