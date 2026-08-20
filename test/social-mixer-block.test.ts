import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  overlapsSocialMixerBlock,
  SCHEDULE,
  slotAtMinutes,
  slotStartMinutes,
  validatePlacement
} from '../shared/schedule'
import {
  resolveSocialMixerBlock,
  socialMixerCourts,
  socialMixerReservedSlots,
  socialMixerStartSlots,
  SOCIAL_MIXER_DEFAULT_PLACEMENT
} from '../shared/social-mixer'
import { suggestSchedule } from '../shared/suggest-schedule'
import { socialMixerWhen } from '../src/data/tournament'
import type { Placement } from '../shared/schedule'

// The Social mixer's reserved court block (CONTEXT: Mixer block, ADR-0064, ADR-0063). The mixer is never
// drawn, so nothing occupies these courts as a *match*; the reservation is configuration the validator
// honours on its behalf, and it **warns rather than blocks** — an organiser agreement is the ADR-0033
// „unwise" category, not the impossible one. Since ADR-0064 the block is *resolved* rather than declared:
// its courts follow the confirmed head-count, its day and start are operator state, and a cancelled mixer
// resolves to no block at all. One validator rule per file, beside finals-day.test.ts and
// evening-window.test.ts.

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

// The block as the event actually stands: the default placement, at the head-count that fills three courts.
const block = resolveSocialMixerBlock({ ...SOCIAL_MIXER_DEFAULT_PLACEMENT, confirmed: 12, cancelled: false })!

// The grid slot whose start is `minutes` past midnight, on the mixer's own day — the common case here.
// Day-aware via `slotAtMinutes`, because the two event days open at different times (ADR-0068), so the
// same clock time is a different row on each.
const slotAt = (minutes: number) => slotAtMinutes(block.day, minutes)

const { day, startMinutes, endMinutes } = block
const [reservedCourt] = block.courts
const freeCourt = [1, 2, 3, 4, 5, 6].find(c => !block.courts.some(r => r === c))!

describe('social mixer block · courts follow the head-count (ADR-0064)', () => {
  it('gives one court per four players, from the top down', () => {
    // Four players per court and the rest rotate out (the same `floor(n / 4)` the printed rotation runs on),
    // filled from the top so court 4 — the one Sunday's finals can use — is the first released.
    expect(socialMixerCourts(0)).toEqual([6])
    expect(socialMixerCourts(6)).toEqual([6])
    expect(socialMixerCourts(8)).toEqual([5, 6])
    expect(socialMixerCourts(9)).toEqual([5, 6])
    expect(socialMixerCourts(11)).toEqual([5, 6])
    expect(socialMixerCourts(12)).toEqual([4, 5, 6])
  })

  it('caps at three courts however full the field gets', () => {
    // At the field's cap of 16 a fourth court would come out of the championship's Sunday; four players
    // rotating out is the cheaper answer (ADR-0063 §5).
    expect(socialMixerCourts(16)).toEqual([4, 5, 6])
    expect(socialMixerCourts(40)).toEqual([4, 5, 6])
  })

  it('carries the reservation into the court budget, so the gauge cannot drift from the block', () => {
    // One slot is one match: three courts × (180 / 90) = 6, the number the gauge has always shown.
    expect(socialMixerReservedSlots(block)).toBe(6)
    expect(socialMixerReservedSlots(resolveSocialMixerBlock({ day: 1, startSlot: 6, confirmed: 9 }))).toBe(4)
    expect(socialMixerReservedSlots(null)).toBe(0)
  })
})

describe('social mixer block · a cancelled mixer has no block (ADR-0064, ADR-0062)', () => {
  it('resolves to nothing at all', () => {
    expect(resolveSocialMixerBlock({ ...SOCIAL_MIXER_DEFAULT_PLACEMENT, confirmed: 12, cancelled: true })).toBeNull()
  })

  it('reserves nothing and warns nowhere', () => {
    const none = resolveSocialMixerBlock({ ...SOCIAL_MIXER_DEFAULT_PLACEMENT, confirmed: 12, cancelled: true })
    expect(socialMixerReservedSlots(none)).toBe(0)
    const v = validatePlacement(
      [pm(1, 1, 0, { p: [1, 2] })],
      { id: 1, placement: { court: reservedCourt, day, slot: slotAt(startMinutes) } },
      none
    )
    expect(v.soft).not.toContainEqual({ rule: 'social-mixer-block' })
  })
})

describe('social mixer block · the start window (ADR-0064)', () => {
  it('offers every start whose three hours finish by daylight, and no later one', () => {
    const slots = socialMixerStartSlots(day)
    expect(slots[0]).toBe(0)
    // 17:00 is the last start whose 3 hours are over by the 20:00 daylight bound; 17:30 is not.
    expect(slots).toContain(slotAt(17 * 60))
    expect(slots).not.toContain(slotAt(17 * 60 + 30))
    expect(slots.at(-1)).toBe(slotAt(17 * 60))
  })

  it('keeps the default placement inside its own window', () => {
    expect(socialMixerStartSlots(SOCIAL_MIXER_DEFAULT_PLACEMENT.day)).toContain(
      SOCIAL_MIXER_DEFAULT_PLACEMENT.startSlot
    )
    expect(slotStartMinutes(SOCIAL_MIXER_DEFAULT_PLACEMENT.day, SOCIAL_MIXER_DEFAULT_PLACEMENT.startSlot)).toBe(12 * 60)
  })
})

describe('social mixer block · overlap (ADR-0063)', () => {
  it('catches a start inside the block, on a reserved court and the mixer day', () => {
    expect(overlapsSocialMixerBlock(block, { court: reservedCourt, day, slot: slotAt(startMinutes) })).toBe(true)
  })

  it('catches a start *before* the block whose 90 minutes run into it — interval overlap, not a cell', () => {
    // The half-hour before the block: the match is still on court when the mixer starts.
    expect(overlapsSocialMixerBlock(block, { court: reservedCourt, day, slot: slotAt(startMinutes - 30) })).toBe(true)
    // A full 90 minutes before: it is over exactly as the block opens, so it clears.
    expect(
      overlapsSocialMixerBlock(block, { court: reservedCourt, day, slot: slotAt(startMinutes - SCHEDULE.matchMinutes) })
    ).toBe(false)
  })

  it('clears a start at the block’s end, and everything after it', () => {
    expect(overlapsSocialMixerBlock(block, { court: reservedCourt, day, slot: slotAt(endMinutes) })).toBe(false)
  })

  it('is scoped to the reserved courts and the mixer day', () => {
    expect(overlapsSocialMixerBlock(block, { court: freeCourt, day, slot: slotAt(startMinutes) })).toBe(false)
    const otherDay = SCHEDULE.days - 1 - day
    expect(overlapsSocialMixerBlock(block, { court: reservedCourt, day: otherDay, slot: slotAt(startMinutes) })).toBe(
      false
    )
  })

  it('moves with the block — the old cells go quiet, the new ones warn', () => {
    const moved = resolveSocialMixerBlock({
      day: 0,
      startSlot: slotAtMinutes(0, 11 * 60),
      confirmed: 12,
      cancelled: false
    })!
    // The default block's day and time no longer bite…
    expect(overlapsSocialMixerBlock(moved, { court: reservedCourt, day, slot: slotAt(startMinutes) })).toBe(false)
    // …and Saturday 11:00 now does.
    expect(overlapsSocialMixerBlock(moved, { court: reservedCourt, day: 0, slot: slotAtMinutes(0, 11 * 60) })).toBe(
      true
    )
  })

  it('narrows with the head-count — the court it no longer needs stops warning', () => {
    const two = resolveSocialMixerBlock({ ...SOCIAL_MIXER_DEFAULT_PLACEMENT, confirmed: 9, cancelled: false })!
    expect(overlapsSocialMixerBlock(block, { court: 4, day, slot: slotAt(startMinutes) })).toBe(true)
    expect(overlapsSocialMixerBlock(two, { court: 4, day, slot: slotAt(startMinutes) })).toBe(false)
    expect(overlapsSocialMixerBlock(two, { court: 5, day, slot: slotAt(startMinutes) })).toBe(true)
  })
})

describe('validatePlacement · social mixer block (ADR-0063)', () => {
  const matches = [pm(1, 1, 0, { p: [1, 2] }), pm(2, 1, 1, { p: [3, 4] })]

  it('warns — soft, never hard — when a match is placed into the block', () => {
    const v = validatePlacement(
      matches,
      { id: 1, placement: { court: reservedCourt, day, slot: slotAt(startMinutes) } },
      block
    )
    expect(v.hard).toEqual([])
    expect(v.soft).toContainEqual({ rule: 'social-mixer-block' })
  })

  it('stays silent on an unreserved court at the same time', () => {
    const v = validatePlacement(
      matches,
      { id: 1, placement: { court: freeCourt, day, slot: slotAt(startMinutes) } },
      block
    )
    expect(v.soft).not.toContainEqual({ rule: 'social-mixer-block' })
  })

  it('stays silent when no block is passed — the server enforces only the hard rules', () => {
    const v = validatePlacement(matches, {
      id: 1,
      placement: { court: reservedCourt, day, slot: slotAt(startMinutes) }
    })
    expect(v.soft).not.toContainEqual({ rule: 'social-mixer-block' })
  })
})

describe('social mixer block · downstream (ADR-0063)', () => {
  it('keeps the auto-suggest out of the block without suggest-schedule knowing about it', () => {
    // `firstValidPlacement` prefers warning-free cells, so the soft rule alone routes the fill around the
    // reservation — the property the ADR leans on to avoid touching the suggest at all.
    const suggested = suggestSchedule([pm(1, 1, 0, { p: [1, 2] }), pm(2, 1, 1, { p: [3, 4] })], block)
    for (const { placement } of suggested) expect(overlapsSocialMixerBlock(block, placement)).toBe(false)
  })

  it('prints the same courts the app reserves — the Spielleiterin’s sheet cannot drift', () => {
    // `scripts/social-mixer-rotation.mjs` is plain Node with no build step, so it carries its own copy of
    // the `floor(n / 4)` rule (ADR-0064). This is the guard on that duplication: the printed sheet must name
    // exactly the courts the grid shades, at both the two-court and the three-court head-count. The script
    // is run at config time (workerd has no child_process) and its output handed over as TEST_ROTATION_SHEETS.
    const sheets = env.TEST_ROTATION_SHEETS as Record<number, string>
    for (const players of [9, 12]) {
      const header = sheets[players].split('\n').find(line => line.includes('Platz'))!
      const courts = socialMixerCourts(players)
      for (const court of courts) expect(header).toContain(`Platz ${court}`)
      // …and no court it did not earn: at nine players court 4 stays with the championship.
      for (const court of [1, 2, 3, 4, 5, 6].filter(c => !courts.includes(c)))
        expect(header).not.toContain(`Platz ${court}`)
    }
  })
})

describe('social mixer block · the public line names its courts (ADR-0073)', () => {
  // ADR-0073 reverses ADR-0064 §6: the public line regains its court numbers, which is what lets the block
  // be a line *inside* Sunday instead of a tile above the board. Asserted at all three reservation sizes,
  // because the courts are a function of the head-count and „Platz 5 und 6" printed for a one-court
  // reservation is the exact failure the ADR names.
  const lineAt = (confirmed: number) =>
    socialMixerWhen(resolveSocialMixerBlock({ ...SOCIAL_MIXER_DEFAULT_PLACEMENT, confirmed })!)

  it('names one court in the singular', () => {
    expect(lineAt(4)).toBe('Sonntag, 23.08. · 12:00–15:00 Uhr · Platz 6')
  })

  it('joins two courts with „und"', () => {
    expect(lineAt(8)).toBe('Sonntag, 23.08. · 12:00–15:00 Uhr · Platz 5 und 6')
  })

  it('lists three courts, the last joined with „und"', () => {
    expect(lineAt(12)).toBe('Sonntag, 23.08. · 12:00–15:00 Uhr · Platz 4, 5 und 6')
  })

  it('names the courts by number only — „Nebenplätze" is not public copy', () => {
    expect(lineAt(8)).not.toContain('Nebenplätze')
  })
})
