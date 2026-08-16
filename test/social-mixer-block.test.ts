import { describe, expect, it } from 'vitest'
import { overlapsSocialMixerBlock, SCHEDULE, validatePlacement } from '../shared/schedule'
import { SOCIAL_MIXER_BLOCK } from '../shared/social-mixer'
import { suggestSchedule } from '../shared/suggest-schedule'
import { socialMixerReservedSlots } from '../src/data/tournament'
import type { Placement } from '../shared/schedule'

// The Social mixer's reserved court block (CONTEXT: Mixer block, ADR-0063). The mixer is never drawn, so
// nothing occupies these courts as a *match*; the reservation is configuration the validator honours on its
// behalf, and it **warns rather than blocks** — an organiser agreement is the ADR-0033 „unwise" category,
// not the impossible one. One validator rule per file, beside finals-day.test.ts and evening-window.test.ts.

interface MatchOpts {
  p?: [number | null, number | null]
  at?: Placement
}

const pm = (id: number, round: number, position: number, { p = [null, null], at }: MatchOpts = {}) => ({
  id,
  competition: 'mens',
  bracket: 'main',
  round,
  position,
  slot1RegId: p[0],
  slot2RegId: p[1],
  outcome: null,
  court: at?.court ?? null,
  day: at?.day ?? null,
  slot: at?.slot ?? null
})

// The grid slot index whose start is `minutes` past midnight, on the mixer's day.
const slotAt = (minutes: number) => (minutes - SCHEDULE.dayStartMinutes[SOCIAL_MIXER_BLOCK.day]) / SCHEDULE.slotMinutes

const { day, startMinutes, endMinutes } = SOCIAL_MIXER_BLOCK
const [reservedCourt] = SOCIAL_MIXER_BLOCK.courts
const freeCourt = [1, 2, 3, 4, 5, 6].find(c => !SOCIAL_MIXER_BLOCK.courts.some(r => r === c))!

describe('social mixer block · overlap (ADR-0063)', () => {
  it('catches a start inside the block, on a reserved court and the mixer day', () => {
    expect(overlapsSocialMixerBlock(reservedCourt, day, slotAt(startMinutes))).toBe(true)
  })

  it('catches a start *before* the block whose 90 minutes run into it — interval overlap, not a cell', () => {
    // The half-hour before the block: the match is still on court when the mixer starts.
    expect(overlapsSocialMixerBlock(reservedCourt, day, slotAt(startMinutes - 30))).toBe(true)
    // A full 90 minutes before: it is over exactly as the block opens, so it clears.
    expect(overlapsSocialMixerBlock(reservedCourt, day, slotAt(startMinutes - SCHEDULE.matchMinutes))).toBe(false)
  })

  it('clears a start at the block’s end, and everything after it', () => {
    expect(overlapsSocialMixerBlock(reservedCourt, day, slotAt(endMinutes))).toBe(false)
  })

  it('is scoped to the reserved courts and the mixer day', () => {
    expect(overlapsSocialMixerBlock(freeCourt, day, slotAt(startMinutes))).toBe(false)
    const otherDay = SCHEDULE.days - 1 - day
    expect(overlapsSocialMixerBlock(reservedCourt, otherDay, slotAt(startMinutes))).toBe(false)
  })
})

describe('validatePlacement · social mixer block (ADR-0063)', () => {
  const matches = [pm(1, 1, 0, { p: [1, 2] }), pm(2, 1, 1, { p: [3, 4] })]

  it('warns — soft, never hard — when a match is placed into the block', () => {
    const v = validatePlacement(matches, {
      id: 1,
      placement: { court: reservedCourt, day, slot: slotAt(startMinutes) }
    })
    expect(v.hard).toEqual([])
    expect(v.soft).toContainEqual({ rule: 'social-mixer-block' })
  })

  it('stays silent on an unreserved court at the same time', () => {
    const v = validatePlacement(matches, {
      id: 1,
      placement: { court: freeCourt, day, slot: slotAt(startMinutes) }
    })
    expect(v.soft).not.toContainEqual({ rule: 'social-mixer-block' })
  })
})

describe('social mixer block · downstream (ADR-0063)', () => {
  it('keeps the auto-suggest out of the block without suggest-schedule knowing about it', () => {
    // `firstValidPlacement` prefers warning-free cells, so the soft rule alone routes the fill around the
    // reservation — the property the ADR leans on to avoid touching the suggest at all.
    const suggested = suggestSchedule([pm(1, 1, 0, { p: [1, 2] }), pm(2, 1, 1, { p: [3, 4] })])
    for (const { placement } of suggested)
      expect(overlapsSocialMixerBlock(placement.court, placement.day, placement.slot)).toBe(false)
  })

  it('derives the court-budget reservation from the block, so the gauge cannot drift from it', () => {
    const expected = SOCIAL_MIXER_BLOCK.courts.length * ((endMinutes - startMinutes) / SCHEDULE.matchMinutes)
    expect(socialMixerReservedSlots).toBe(expected)
    // The number the budget gauge has always carried (ADR-0051 §5) — the derivation must reproduce it.
    expect(socialMixerReservedSlots).toBe(6)
  })
})
