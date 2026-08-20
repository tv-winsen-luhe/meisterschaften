import { describe, expect, it } from 'vitest'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch, ScheduleSlot } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'

// A column that names nobody yet (#333, #346, ADR-0072 amendment 2026-08-20): every match in it still has a
// **feeder placeholder** for both contestants — Sunday's wall of „Sieger M11 — Sieger M12". Such a column
// used to collapse to one summarised block that the reader had to open; it no longer does, and this file is
// the guard on that. What the summary was carrying — which round, and when — is on the rows themselves, so
// the reader gets it without tapping anything, and this asserts exactly that.
//
// A sibling of match-view.test.ts and match-row.test.ts, split by question the way those two are — that file
// asks „is the tree right", the row's asks „does one row read like a tennis result", and this one asks „what
// does a reader get from a column that names nobody". Its own file rather than more of match-view.test.ts
// because that file is at the repo's 300-line budget.
//
// Asserted at the interface only, in finished German.

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

const player = (firstName: string, lastName: string): ScheduleSlot => ({
  kind: 'player',
  firstName,
  lastName,
  club: 'TV Winsen',
  seed: null
})

// „Sieger M11" / „Verlierer M13" — a contestant that is still the match in front of it, not a person.
const feeder = (matchNumber: number): ScheduleSlot => ({ kind: 'feeder', matchNumber })
const loser = (matchNumber: number): ScheduleSlot => ({ kind: 'loser', matchNumber })

// One placed match on court 1. Only the fields a case exercises are passed; the rest are inert defaults.
const match = (over: Partial<ScheduleMatch> & Pick<ScheduleMatch, 'id' | 'slot'>): ScheduleMatch => ({
  competition: 'mens',
  bracket: 'main',
  number: over.id,
  round: 2,
  thirdPlace: false,
  position: 0,
  totalRounds: 3,
  court: 1,
  day: 0,
  status: 'planned',
  winner: null,
  outcome: null,
  score: NO_SCORE,
  slot1: feeder(11),
  slot2: feeder(12),
  ...over
})

const OPTIONS: ScheduleViewOptions = {
  days: [{ weekday: 'Sonntag', short: '23.08.' }],
  competitions: [
    { slug: 'womens', label: 'Damen' },
    { slug: 'mens', label: 'Herren' }
  ]
}

const view = (matches: ScheduleMatch[], over: Partial<ScheduleViewOptions> = {}) =>
  scheduleView({ published: true, matches }, { ...OPTIONS, ...over })

// Court 1's column on the Sunday — where every case but the last one lives.
const court = (matches: ScheduleMatch[], over: Partial<ScheduleViewOptions> = {}) =>
  view(matches, over).days[0].courts[0]

describe('scheduleView · a column that names nobody keeps every row (ADR-0072 amendment)', () => {
  it('renders one row per match rather than a block to open', () => {
    // Sunday's wall: consecutive rows reading „Sieger M11 — Sieger M12". They stay rows, and each says which
    // round it is and when it starts — the two facts the collapsed summary existed to rescue.
    const { rows } = court([
      match({ id: 1, slot: 0, round: 2 }),
      match({ id: 2, slot: 3, round: 3, totalRounds: 3, slot1: loser(11), slot2: loser(12), thirdPlace: true })
    ])
    expect(rows.map(r => [r.publishedTime, r.meta])).toEqual([
      ['10:00', 'Halbfinale · M1 · Herren'],
      ['ca. 11:30', 'Spiel um Platz 3 · M2 · Herren']
    ])
  })

  it('states the placeholder contestants as the tbd lines they are', () => {
    const { rows } = court([match({ id: 1, slot: 0 })])
    expect(rows.map(r => [r.slot1.text, r.slot2.text])).toEqual([['Sieger M11', 'Sieger M12']])
    expect(rows[0].slot1.tbd).toBe(true)
  })

  it('hedges each row exactly where the reservations touch (ADR-0071)', () => {
    // The chain is a fact about the court, so a row still follows the women's match filtered out of this
    // column — the filter narrows the rows, never the chain.
    const { rows } = court(
      [
        match({ id: 1, slot: 0, competition: 'womens', slot1: player('Ida', 'Rehm'), slot2: player('Eva', 'Nolte') }),
        match({ id: 2, slot: 3 })
      ],
      { competition: 'mens' }
    )
    expect(rows.map(r => [r.publishedTime, r.followsOn])).toEqual([['ca. 11:30', true]])
  })

  it('leaves the Live board untouched — a running match has two people on it', () => {
    // The board reads live truth and never the plan, so a column of placeholders beside a running match
    // changes nothing about either.
    const result = view([
      match({ id: 1, slot: 0, status: 'running', slot1: player('Jan', 'Behrens'), slot2: player('Til', 'Osten') }),
      match({ id: 2, slot: 0, court: 2 })
    ])
    expect(result.days[0].courts.map(c => c.rows.length)).toEqual([1, 1])
    expect(result.courts![0]).toMatchObject({ court: 1, free: false })
    expect(result.courts![1]).toMatchObject({ court: 2, free: true })
  })
})
