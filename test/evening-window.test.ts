import { describe, expect, it } from 'vitest'
import {
  courtEndMinutes,
  isFloodlit,
  SCHEDULE,
  slotTime,
  validatePlacement,
  withinEveningWindow
} from '../shared/schedule'
import type { Placement } from '../shared/schedule'

// The per-court evening windows (ADR-0040): only courts 5 & 6 are floodlit, so only they may run on past
// daylight to the 22:00 quiet-hours curfew; the dark courts 1–4 must finish by the ~20:00 daylight bound.
// These are fixed configured bounds, not computed from sunset. This file owns both the pure window
// helpers and the `court-window` hard rule the validator adds on top — the prior art is schedule.test.ts.

describe('isFloodlit / courtEndMinutes', () => {
  it('marks only courts 5 & 6 as floodlit', () => {
    expect([1, 2, 3, 4].map(isFloodlit)).toEqual([false, false, false, false])
    expect([5, 6].map(isFloodlit)).toEqual([true, true])
  })

  it('ends the dark courts at the ~20:00 daylight bound and the floodlit pair at the 22:00 curfew', () => {
    expect(courtEndMinutes(4)).toBe(20 * 60)
    expect(courtEndMinutes(5)).toBe(22 * 60)
  })
})

describe('withinEveningWindow', () => {
  // A 90-minute match must *finish* by the court's bound. Both days open at 9:00 on a 30-minute cadence,
  // so the dark courts' last legal start is slot 19 (18:30 → finishes 20:00) and the floodlit pair's is
  // slot 23 (20:30 → finishes 22:00, the last slot the uniform grid offers).
  it('lets a dark court (1–4) start only up to a finish by ~20:00 (last start 18:30 = slot 19)', () => {
    expect(slotTime(0, 19)).toBe('18:30')
    expect(withinEveningWindow(1, 0, 19)).toBe(true)
    // Slot 20 (19:00) would finish at 20:30 — past the dark courts' daylight bound.
    expect(slotTime(0, 20)).toBe('19:00')
    expect(withinEveningWindow(1, 0, 20)).toBe(false)
  })

  it('lets a floodlit court (5 & 6) run on past daylight to the 22:00 curfew (last start 20:30 = slot 23)', () => {
    // The same slot 20 a dark court must refuse is still fine under the lights…
    expect(withinEveningWindow(5, 0, 20)).toBe(true)
    // …all the way to the grid's last slot, which finishes exactly at the 22:00 curfew.
    const lastSlot = SCHEDULE.slotsPerDay - 1
    expect(slotTime(0, lastSlot)).toBe('20:30')
    expect(withinEveningWindow(6, 0, lastSlot)).toBe(true)
  })

  it('applies the window per day off each day’s own start (both 9:00 today)', () => {
    expect(withinEveningWindow(1, 1, 19)).toBe(true)
    expect(withinEveningWindow(1, 1, 20)).toBe(false)
  })
})

describe('validatePlacement — hard court-window rule (ADR-0040)', () => {
  // A lone round-1 match (no feeders, no other placements) so only the window rule can bite. Slot 20
  // (19:00) finishes at 20:30: past the dark courts' ~20:00 daylight bound, but fine under the lights.
  const lateMatch = {
    id: 40,
    competition: 'mens',
    bracket: 'main',
    round: 1,
    position: 0,
    slot1RegId: 101,
    slot2RegId: 102,
    outcome: null,
    court: null,
    day: null,
    slot: null
  }
  const at = (court: number, slot: number): Placement => ({ court, day: 0, slot })

  it('blocks a dark court (1–4) from a start that would finish past ~20:00', () => {
    const { hard } = validatePlacement([lateMatch], { id: 40, placement: at(1, 20) })
    expect(hard).toEqual([{ rule: 'court-window' }])
  })

  it('lets the dark court take its last in-window start (slot 19 = 18:30, finishes 20:00)', () => {
    const { hard } = validatePlacement([lateMatch], { id: 40, placement: at(4, 19) })
    expect(hard).toEqual([])
  })

  it('lets a floodlit court (5 & 6) take the very start a dark court must refuse', () => {
    const { hard } = validatePlacement([lateMatch], { id: 40, placement: at(5, 20) })
    expect(hard).toEqual([])
  })

  it('lets a floodlit court run to the grid’s last slot (20:30, finishes at the 22:00 curfew)', () => {
    const { hard } = validatePlacement([lateMatch], { id: 40, placement: at(6, SCHEDULE.slotsPerDay - 1) })
    expect(hard).toEqual([])
  })
})
