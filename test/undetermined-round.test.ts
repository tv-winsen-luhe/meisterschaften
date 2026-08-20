import { describe, expect, it } from 'vitest'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch, ScheduleSlot } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'

// The undetermined round (#333): a group of the public schedule whose every match still has a **feeder
// placeholder** for both contestants collapses to one summarised block. A sibling of match-view.test.ts and
// match-row.test.ts, split by question the way those two are — that file asks „is the tree right", the row's
// asks „does one row read like a tennis result", and this one asks „does a group that names nobody say so".
// Its own file rather than more of match-view.test.ts because that file is at the repo's 300-line budget;
// the same reason the row's cases live apart from the tree's.
//
// Asserted at the interface only, in finished German. The collapse is a decision about the content and lives
// in the projection; whether the block is **open** is renderer state, and the renderer that turns this tree
// into nodes is a translation deliberately left untested (#304) — so there is nothing about a `<details>`
// here.

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

describe('scheduleView · an undetermined round collapses to one summarised block (#333)', () => {
  it('summarises a group whose every match names nobody', () => {
    // Sunday's wall: consecutive rows reading „Sieger M11 — Sieger M12". Between them they say exactly one
    // useful thing — how many matches wait on this court, and roughly when the first of them starts.
    const { undetermined } = court([
      match({ id: 1, slot: 0 }),
      match({ id: 2, slot: 3, slot1: loser(11), slot2: loser(12) }),
      match({ id: 3, slot: 6, slot1: feeder(1), slot2: loser(2) })
    ])
    expect(undetermined).toEqual({
      matchCount: 3,
      earliestTime: '10:00',
      summary: '3 Spiele · ab 10:00 · noch ohne Namen'
    })
  })

  it('keeps the full rows behind the summary rather than dropping them', () => {
    // The block summarises; it never withholds. Expansion is the renderer's state, so the rows it expands
    // to are still here, unchanged — the same „Sieger M11" placeholder line the row has always rendered.
    const { rows } = court([match({ id: 1, slot: 0 })])
    expect(rows.map(r => [r.slot1.text, r.slot2.text])).toEqual([['Sieger M11', 'Sieger M12']])
    expect(rows[0].slot1.tbd).toBe(true)
    expect(rows[0].publishedTime).toBe('10:00')
  })

  it('does not collapse a group with a real player in any of its matches', () => {
    // One named contestant is enough to make the column worth reading down: a player looking for their own
    // afternoon would otherwise have to expand a block to find themselves in it.
    const { undetermined } = court([
      match({ id: 1, slot: 0 }),
      match({ id: 2, slot: 3, slot1: player('Jan', 'Behrens') })
    ])
    expect(undetermined).toBe(null)
  })

  it('does not collapse a bye or an unresolvable slot — neither is a feeder waiting on a result', () => {
    // „Freilos" and „offen" are placeholders too, but not of the „waiting on the match in front of it" kind
    // this block is about: a bye is already decided, and „offen" is a slot that failed to resolve
    // (ADR-0035). Summarising either would hide a fact rather than a wall of noise.
    expect(court([match({ id: 1, slot: 0, slot1: { kind: 'bye' } })]).undetermined).toBe(null)
    expect(court([match({ id: 2, slot: 0, slot1: { kind: 'unknown' } })]).undetermined).toBe(null)
  })

  it('hedges the summary’s time exactly where the reservations touch (ADR-0071)', () => {
    // The block's earliest start is a follow-on like any other row's, so it carries the same hedge with the
    // number still in front of it — the summary states the plan, it does not restate the convention. And it
    // follows the women's match filtered out of this column, because the chain is a fact about the court.
    const { undetermined } = court(
      [
        match({ id: 1, slot: 0, competition: 'womens', slot1: player('Ida', 'Rehm'), slot2: player('Eva', 'Nolte') }),
        match({ id: 2, slot: 3 })
      ],
      { competition: 'mens' }
    )
    expect(undetermined).toEqual({
      matchCount: 1,
      earliestTime: 'ca. 11:30',
      summary: '1 Spiel · ab ca. 11:30 · noch ohne Namen'
    })
  })

  it('leaves the Live board untouched — a running match is never in an undetermined round', () => {
    // A match on court has two people on it, so its group cannot be all-placeholder. The board reads live
    // truth either way: the collapse is a statement about the plan and reaches only the day → court tree.
    const result = view([
      match({ id: 1, slot: 0, status: 'running', slot1: player('Jan', 'Behrens'), slot2: player('Til', 'Osten') }),
      match({ id: 2, slot: 0, court: 2 })
    ])
    expect(result.days[0].courts[0].undetermined).toBe(null)
    expect(result.days[0].courts[1].undetermined).not.toBe(null)
    expect(result.courts[0]).toMatchObject({ court: 1, free: false })
    expect(result.courts[1]).toMatchObject({ court: 2, free: true })
  })
})
