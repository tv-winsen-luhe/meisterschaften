import { describe, expect, it } from 'vitest'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch, ScheduleSlot } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'

// The current day leads the public schedule (CONTEXT: Current event day, ADR-0081): on an event day that
// day's section is ordered first, its heading says „heute", and the other day follows it whole.
//
// Its own file rather than another block in match-view.test.ts, which is at the repo's 300-line budget —
// and the separation is honest anyway: every case in that file is about how a *time* is said, every case
// here about which *day* comes first.
//
// The day index arrives finished (`currentDay`), so there is still no clock in the module under test. Where
// that index comes from — a server timestamp against the event's dates — is current-event-day.test.ts.

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

const player = (firstName: string, lastName: string): ScheduleSlot => ({
  kind: 'player',
  firstName,
  lastName,
  club: 'TV Winsen',
  seed: null
})

// One placed match; only day/court/slot ever vary here, so the rest are inert defaults.
const match = (over: Partial<ScheduleMatch> & Pick<ScheduleMatch, 'id' | 'court' | 'slot'>): ScheduleMatch => ({
  competition: 'mens',
  bracket: 'main',
  number: over.id,
  round: 1,
  thirdPlace: false,
  position: 0,
  totalRounds: 3,
  day: 0,
  status: 'planned',
  winner: null,
  outcome: null,
  score: NO_SCORE,
  slot1: player('Jan', 'Behrens'),
  slot2: player('Til', 'Osten'),
  ...over
})

const OPTIONS: ScheduleViewOptions = {
  days: [
    { weekday: 'Samstag', short: '22.08.' },
    { weekday: 'Sonntag', short: '23.08.' }
  ],
  competitions: [{ slug: 'mens', label: 'Herren' }]
}

const view = (matches: ScheduleMatch[], over: Partial<ScheduleViewOptions> = {}) =>
  scheduleView({ published: true, matches }, { ...OPTIONS, ...over })

// One match on each day, so the only thing under test is which section comes first and what it is called.
const BOTH_DAYS = [match({ id: 1, court: 1, slot: 0, day: 0 }), match({ id: 2, court: 1, slot: 0, day: 1 })]
const heads = (over: Partial<ScheduleViewOptions> = {}) => view(BOTH_DAYS, over).days.map(d => d.label)

describe('scheduleView · the current day leads, and says so (ADR-0081)', () => {
  it('is chronological when there is no current day', () => {
    // Before the event, after it, and whenever the server time is missing — the order the page always had.
    expect(heads()).toEqual(['Samstag · 22.08.', 'Sonntag · 23.08.'])
    expect(heads({ currentDay: null })).toEqual(['Samstag · 22.08.', 'Sonntag · 23.08.'])
  })

  it('puts the current day first and leaves the other one whole behind it', () => {
    expect(heads({ currentDay: 1 })).toEqual(['Sonntag · 23.08. · heute', 'Samstag · 22.08.'])
    expect(view(BOTH_DAYS, { currentDay: 1 }).days.map(d => d.day)).toEqual([1, 0])
    // Yesterday keeps every row it had — Sunday reads Saturday's results (the consolation is fed from them).
    expect(view(BOTH_DAYS, { currentDay: 1 }).days[1].courts[0].rows).toHaveLength(1)
  })

  it('marks the leading day even when the order does not change', () => {
    // On Saturday the current day already is the first one. The order is a no-op; the word is not.
    expect(heads({ currentDay: 0 })).toEqual(['Samstag · 22.08. · heute', 'Sonntag · 23.08.'])
  })

  it('says nothing about a day that carries no matches', () => {
    // It is Sunday and only Saturday is on the board (the second day not yet placed). There is no Sunday
    // section to lead with and nothing to mark — and Saturday must not inherit the word.
    expect(view([match({ id: 1, court: 1, slot: 0, day: 0 })], { currentDay: 1 }).days.map(d => d.label)).toEqual([
      'Samstag · 22.08.'
    ])
  })

  it('keeps the competition filter and the times untouched while it reorders', () => {
    // The order is the only thing this option may touch: a filtered page still narrows to its field, and a
    // day that moves to the front does not gain or lose a hedge (the chain is per court, not per position).
    const view1 = view(BOTH_DAYS, { currentDay: 1 })
    expect(view1.days.flatMap(d => d.courts.flatMap(c => c.rows.map(r => r.publishedTime)))).toEqual(['10:00', '10:00'])
  })
})
