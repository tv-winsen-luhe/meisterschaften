import { describe, expect, it } from 'vitest'
import {
  courtEndMinutes,
  isFloodlit,
  SCHEDULE,
  slotAtMinutes,
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
  // A 90-minute match must *finish* by the court's bound, and the slot→clock arithmetic runs off each
  // day's own first start (Saturday 10:30, Sunday 10:00 — ADR-0067). The last legal start is therefore a
  // *clock* time (18:30 dark, 20:30 floodlit) at a different slot index per day — derived here rather
  // than hard-coded, so a moved first start re-aims the test instead of breaking it.
  const lastStart = (day: number, endMinutes: number) => slotAtMinutes(day, endMinutes - SCHEDULE.matchMinutes)

  it('lets a dark court (1–4) start only up to a finish by ~20:00 (last start 18:30)', () => {
    const last = lastStart(0, SCHEDULE.daylightEndMinutes)
    expect(slotTime(0, last)).toBe('18:30')
    expect(withinEveningWindow(1, 0, last)).toBe(true)
    // One step later (19:00) would finish at 20:30 — past the dark courts' daylight bound.
    expect(slotTime(0, last + 1)).toBe('19:00')
    expect(withinEveningWindow(1, 0, last + 1)).toBe(false)
  })

  it('lets a floodlit court (5 & 6) run on past daylight to the 22:00 curfew (last start 20:30)', () => {
    // The slot a dark court must refuse is still fine under the lights…
    expect(withinEveningWindow(5, 0, lastStart(0, SCHEDULE.daylightEndMinutes) + 1)).toBe(true)
    // …up to the curfew start, which finishes exactly at 22:00.
    const last = lastStart(0, SCHEDULE.curfewMinutes)
    expect(slotTime(0, last)).toBe('20:30')
    expect(withinEveningWindow(6, 0, last)).toBe(true)
    expect(withinEveningWindow(6, 0, last + 1)).toBe(false)
  })

  it('is exactly as tall as the earliest-starting day’s curfew reach', () => {
    // The grid height is uniform across days, so it is sized by whichever day opens earliest — every row
    // it offers is one *some* court can take, and none beyond. Saturday opens later, so its last rows are
    // disabled by this very rule rather than by a shorter column.
    const earliest = SCHEDULE.dayStartMinutes.indexOf(Math.min(...SCHEDULE.dayStartMinutes))
    expect(SCHEDULE.slotsPerDay - 1).toBe(lastStart(earliest, SCHEDULE.curfewMinutes))
  })

  it('applies the window per day off each day’s own start', () => {
    // Sunday opens half an hour earlier, so its last legal dark-court start sits one slot higher than
    // Saturday's — the same 18:30 on the clock.
    expect(lastStart(1, SCHEDULE.daylightEndMinutes)).toBe(lastStart(0, SCHEDULE.daylightEndMinutes) + 1)
    expect(withinEveningWindow(1, 1, lastStart(1, SCHEDULE.daylightEndMinutes))).toBe(true)
    expect(withinEveningWindow(1, 1, lastStart(1, SCHEDULE.daylightEndMinutes) + 1)).toBe(false)
  })
})

describe('validatePlacement — hard court-window rule (ADR-0040)', () => {
  // A lone round-1 match (no feeders, no other placements) so only the window rule can bite. `dark` is
  // Saturday's last legal dark-court start (18:30, finishing exactly at 20:00); one step later (19:00)
  // finishes at 20:30 — past the dark courts' daylight bound, but fine under the lights.
  const dark = slotAtMinutes(0, SCHEDULE.daylightEndMinutes - SCHEDULE.matchMinutes)
  const lit = slotAtMinutes(0, SCHEDULE.curfewMinutes - SCHEDULE.matchMinutes)
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
    const { hard } = validatePlacement([lateMatch], { id: 40, placement: at(1, dark + 1) })
    expect(hard).toEqual([{ rule: 'court-window' }])
  })

  it('lets the dark court take its last in-window start (18:30, finishes 20:00)', () => {
    const { hard } = validatePlacement([lateMatch], { id: 40, placement: at(4, dark) })
    expect(hard).toEqual([])
  })

  it('lets a floodlit court (5 & 6) take the very start a dark court must refuse', () => {
    const { hard } = validatePlacement([lateMatch], { id: 40, placement: at(5, dark + 1) })
    expect(hard).toEqual([])
  })

  it('lets a floodlit court run to its curfew start (20:30, finishes at the 22:00 curfew)', () => {
    const { hard } = validatePlacement([lateMatch], { id: 40, placement: at(6, lit) })
    expect(hard).toEqual([])
  })
})
