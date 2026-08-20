import { describe, expect, it } from 'vitest'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch, ScheduleSlot } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'

// The Social mixer as a field of the schedule's competition filter (ADR-0074). It is the one option the feed
// can never supply — the engine models no mixer match — so the caller says whether it takes place, and
// selecting it narrows the schedule to nothing on purpose: the mixer's court-time is an appointment the page
// states outside this tree, and „nothing else" is the whole answer.
//
// Its own file rather than more of match-view.test.ts (at the repo's 300-line budget), and asserted at the
// interface only.

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

const player = (firstName: string, lastName: string): ScheduleSlot => ({
  kind: 'player',
  firstName,
  lastName,
  club: 'TV Winsen',
  seed: null
})

const match = (over: Partial<ScheduleMatch> & Pick<ScheduleMatch, 'id' | 'slot'>): ScheduleMatch => ({
  competition: 'mens',
  bracket: 'main',
  number: over.id,
  round: 1,
  thirdPlace: false,
  position: 0,
  totalRounds: 2,
  court: 1,
  day: 1,
  status: 'planned',
  winner: null,
  outcome: null,
  score: NO_SCORE,
  slot1: player('Jan', 'Behrens'),
  slot2: player('Til', 'Osten'),
  ...over
})

// The whole client copy, mixer included — the page hands the view every competition it knows and the view
// keeps the ones that belong in the filter.
const OPTIONS: ScheduleViewOptions = {
  days: [
    { weekday: 'Samstag', short: '22.08.' },
    { weekday: 'Sonntag', short: '23.08.' }
  ],
  competitions: [
    { slug: 'womens', label: 'Damen' },
    { slug: 'mens', label: 'Herren' },
    { slug: 'womens-social', label: 'Damen Doppel' }
  ]
}

const view = (matches: ScheduleMatch[], over: Partial<ScheduleViewOptions> = {}) =>
  scheduleView({ published: true, matches }, { ...OPTIONS, ...over })

// Two drawn fields on the board, so the filter has something to be part of.
const DRAWN = [
  match({ id: 1, slot: 0 }),
  match({ id: 2, slot: 3, competition: 'womens', slot1: player('Ida', 'Rehm'), slot2: player('Eva', 'Nolte') })
]

describe('scheduleView · the Social mixer is a filter field without matches (ADR-0074)', () => {
  it('offers it behind the drawn fields when the caller says it takes place', () => {
    const { competitions } = view(DRAWN, { socialMixer: true })
    expect(competitions.map(c => c.label)).toEqual(['Damen', 'Herren', 'Damen Doppel'])
  })

  it('does not offer it otherwise — a cancelled mixer is not a field to filter by', () => {
    // Absent means „do not offer it", so a caller that knows nothing about the mixer gets the old filter;
    // the page passes `false` once the phase read reports the cancellation (ADR-0062).
    expect(view(DRAWN).competitions.map(c => c.slug)).toEqual(['womens', 'mens'])
    expect(view(DRAWN, { socialMixer: false }).competitions.map(c => c.slug)).toEqual(['womens', 'mens'])
  })

  it('does not turn a single drawn field into a filter', () => {
    // „Nothing at all below two" still counts the *drawn* fields: a Herren-only event plus the mixer is not a
    // choice the page grew a filter for, and the mixer's own line stands on the page either way.
    expect(view([match({ id: 1, slot: 0 })], { socialMixer: true }).competitions).toEqual([])
  })

  it('narrows the schedule to nothing when selected', () => {
    // The appointment is not a row, so there is no row to show — and the empty tree is what leaves the
    // mixer's band standing alone as the answer.
    const result = view(DRAWN, { socialMixer: true, competition: 'womens-social' })
    expect(result.selected).toBe('womens-social')
    expect(result.days).toEqual([])
  })

  it('fades the whole Live board back while it is selected', () => {
    // No mixer match can be on court, so every cell sits outside the focused field — the board says „nothing
    // of yours is running" by the same rule every other field uses, with no special case of its own.
    const result = view([match({ id: 1, slot: 0, status: 'running' }), ...DRAWN.slice(1)], {
      socialMixer: true,
      competition: 'womens-social'
    })
    expect(result.courts!.every(c => c.dim)).toBe(true)
  })

  it('drops a stored mixer selection once the mixer is off the list', () => {
    // The same fallback every dropped field gets: a selection with no chip left to widen it again would
    // narrow the page for good.
    const result = view(DRAWN, { competition: 'womens-social' })
    expect(result.selected).toBe(null)
    expect(result.days.length).toBe(1)
  })
})
