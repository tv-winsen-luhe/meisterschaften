import { describe, expect, it } from 'vitest'
import { COURT_NUMBERS } from '../shared'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'

// A Play suspension names the courts it stops (ADR-0078 Amendment 2), and this is the file where the two
// readers that had to narrow for it are pinned: the schedule's „ca." hedge, and the Live board's cells.
//
// The situation the amendment exists for: it rains, everything stops, and then court 3 dries while court 4
// still has puddles. Under the shipped all-or-nothing suspension the operator could only lie about one of
// them. So the state carries a set — all six *is* the total suspension, and the copy derives the difference
// rather than storing it.
//
// **Nothing here is reachable from the site yet.** The shell switch still writes every court, so every
// suspension the operator can currently declare is total; the subsets below are constructed directly,
// which is the whole reason this ticket could land ahead of the control that creates one. The total cases
// are therefore also regression cases: they must produce exactly the page the site produces today.
//
// It lives beside test/live-board-presence.test.ts rather than in test/match-view.test.ts or
// test/schedule-board-render.test.ts, both of which sit at the repo's 300-line budget.

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

const match = (over: Partial<ScheduleMatch> & Pick<ScheduleMatch, 'id' | 'court'>): ScheduleMatch => ({
  competition: 'mens',
  bracket: 'main',
  number: over.id,
  round: 1,
  thirdPlace: false,
  position: 0,
  totalRounds: 3,
  day: 0,
  slot: 0,
  status: 'planned',
  winner: null,
  outcome: null,
  score: NO_SCORE,
  slot1: { kind: 'player', firstName: 'Jan', lastName: 'Behrens', club: 'TV Winsen', seed: null },
  slot2: { kind: 'player', firstName: 'Til', lastName: 'Osten', club: 'TV Winsen', seed: null },
  ...over
})

const OPTIONS: ScheduleViewOptions = {
  days: [{ weekday: 'Samstag', short: '22.08.' }],
  competitions: [
    { slug: 'womens', label: 'Damen' },
    { slug: 'mens', label: 'Herren' }
  ]
}

const view = (matches: ScheduleMatch[], over: Partial<ScheduleViewOptions> = {}) =>
  scheduleView({ published: true, matches }, { ...OPTIONS, ...over })

// Every court stopped — the total suspension (ADR-0078 Amendment 2 rule 1).
const EVERY_COURT = [...COURT_NUMBERS]

describe('scheduleView · the hedge is per court (ADR-0078 Amendment 2 rule 4)', () => {
  // Courts 1–3 dried and are playing; court 4 still has puddles. Hedging court 1's times while a match is
  // actually about to start there asserts something false, which is the whole reason the flag became a list.
  const partial = [4]

  it('hedges only the not-yet-started rows on a stopped court', () => {
    const day = view([match({ id: 1, court: 1, slot: 0 }), match({ id: 2, court: 4, slot: 0 })], {
      stoppedCourts: partial
    }).days[0]
    expect(day.courts.map(c => c.rows.map(r => r.publishedTime))).toEqual([['10:00'], ['ca. 10:00']])
  })

  it('leaves a playing court’s own follow-on hedge exactly as it was', () => {
    // The structural „ca." is a fact about the reservation chain and owes the suspension nothing.
    const { rows } = view([match({ id: 1, court: 1, slot: 0 }), match({ id: 2, court: 1, slot: 3 })], {
      stoppedCourts: partial
    }).days[0].courts[0]
    expect(rows.map(r => r.publishedTime)).toEqual(['10:00', 'ca. 11:30'])
  })

  it('hedges nothing when no court is stopped', () => {
    const { rows } = view([match({ id: 1, court: 1, slot: 0 })], { stoppedCourts: [] }).days[0].courts[0]
    expect(rows.map(r => r.publishedTime)).toEqual(['10:00'])
  })
})

describe('scheduleView · the Live board marks a stopped court (ADR-0078 Amendment 2 rule 5)', () => {
  const running = (court: number) => match({ id: court, court, slot: 0, status: 'running' })

  it('marks the cell on a stopped court and leaves the playing ones alone', () => {
    const { courts } = view([running(1), running(4)], { stoppedCourts: [4] })
    expect(courts![0]).toMatchObject({ free: false, stopped: false })
    expect(courts![3]).toMatchObject({ free: false, stopped: true })
  })

  it('gives a stopped court with no match on it no cell of its own', () => {
    // The presence rule is untouched: the board shows what is *running*, and the band already names the
    // empty courts. Court 4 is stopped and idle — it stays the plain „frei" cell it would be anyway.
    const { courts } = view([running(1)], { stoppedCourts: [4] })
    expect(courts![3]).toEqual({ court: 4, label: 'Platz 4', dim: false, free: true })
  })

  it('marks nothing under a total suspension, because the band above says it once for all six', () => {
    const { courts } = view([running(1), running(4)], { stoppedCourts: EVERY_COURT })
    expect(courts!.filter(c => !c.free).map(c => c.stopped)).toEqual([false, false])
  })
})
