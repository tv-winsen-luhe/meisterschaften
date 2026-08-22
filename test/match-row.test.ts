import { describe, expect, it } from 'vitest'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch, ScheduleSlot } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'
import { score } from './score-text'

// The match row's tennis anatomy (#309, ADR-0070) — a sibling of match-view.test.ts, which pins the same
// projection's grouping and its published-time floor. Split by question rather than by size: that file asks
// „is the tree right", this one asks „does one row read like a tennis result".
//
// Asserted at the interface only, in finished German — this file asks what the row *says*. What it does
// not cover is the shape the renderer builds out of that: #343 was a missing cell, not a wrong word, and
// no assertion on finished German could have caught it. That half lives in
// test/schedule-board-render.test.ts.

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

const OPTIONS: ScheduleViewOptions = {
  days: [{ weekday: 'Samstag', short: '22.08.' }],
  competitions: [{ slug: 'mens', label: 'Herren' }]
}

// One placed match on court 1. Only the fields a case exercises are passed; the rest are inert defaults.
const match = (over: Partial<ScheduleMatch> = {}): ScheduleMatch => ({
  id: 1,
  competition: 'mens',
  bracket: 'main',
  number: 1,
  round: 1,
  thirdPlace: false,
  position: 0,
  totalRounds: 3,
  court: 1,
  day: 0,
  slot: 0,
  status: 'planned',
  winner: null,
  outcome: null,
  score: NO_SCORE,
  slot1: { kind: 'player', firstName: 'Jan', lastName: 'Behrens', club: 'TV Winsen', seed: 3 },
  slot2: { kind: 'player', firstName: 'Til', lastName: 'Osten', club: 'TSV Winsen', seed: null },
  ...over
})

// The conventions all three reference tournaments share, in Winsen's terms: the club crest where they fly a
// country flag, full names where they abbreviate, the seed as a small trailing token, the winner marked
// twice, and the outcome moved out of the meta line into the score column.
describe('scheduleView · the match row reads like a tennis result', () => {
  // The default match already carries both seeding cases: a seeded TV Winsen player against an unseeded
  // TSV Winsen one.
  const anatomy = (over: Partial<ScheduleMatch> = {}) =>
    scheduleView({ published: true, matches: [match(over)] }, OPTIONS).days[0].courts[0].rows[0]

  it('names a contestant in full and carries their club for the crest', () => {
    // „J. Sinner" exists to fit 128 names into narrow cells. With twelve people who know each other the
    // abbreviation is pure loss, so the row keeps the whole name.
    const row = anatomy()
    expect(row.slot1.text).toBe('Jan Behrens')
    expect(row.slot1.club).toBe('TV Winsen')
    expect(row.slot2.club).toBe('TSV Winsen')
  })

  it('gives a seeded player a finished trailing token and an unseeded one none', () => {
    const row = anatomy()
    expect(row.slot1.seed).toEqual({ text: '3', label: 'An 3 gesetzt' })
    // Null rather than an empty token: „unseeded" is the absence of the token, not a blank one, so the
    // renderer branches on the fact instead of on an empty string.
    expect(row.slot2.seed).toBe(null)
  })

  it('leaves every placeholder line without a crest or a seed', () => {
    // None of the three is a person: there is nobody to badge and no club to fly. „Freilos" stays reserved
    // for a true round-1 bye and „offen" for a slot that would not resolve (ADR-0035) — the existing
    // honesty, now also pinned for the two fields this slice added.
    for (const [slot1, text] of [
      [{ kind: 'feeder' as const, matchNumber: 3 }, 'Sieger M3'],
      [{ kind: 'bye' as const }, 'Freilos'],
      [{ kind: 'unknown' as const }, 'offen']
    ] satisfies [ScheduleSlot, string][]) {
      expect(anatomy({ slot1 }).slot1).toMatchObject({ text, tbd: true, club: null, seed: null })
    }
  })

  it('leaves the feeder placeholder’s remaining row fields inert', () => {
    expect(anatomy({ slot1: { kind: 'feeder', matchNumber: 3 } }).slot1).toMatchObject({
      games: '',
      outcome: null,
      winner: false
    })
  })

  it('shows no crest for a club the wire could not name rather than a wrong one', () => {
    const slot1: ScheduleSlot = { kind: 'player', firstName: 'Jan', lastName: 'Behrens', club: null, seed: null }
    expect(anatomy({ slot1 }).slot1).toMatchObject({ text: 'Jan Behrens', tbd: false, club: null })
  })

  it('keeps the meta line to round · match number · competition', () => {
    // The outcome used to live here, far from where a reader looks for it. The meta line goes back to being
    // the calm line that only places the match.
    expect(anatomy({ status: 'done', winner: 1, outcome: 'retirement' }).meta).toBe('Viertelfinale · M1 · Herren')
  })

  it('carries no outcome token for a normal scored result — the sets are the result', () => {
    const row = anatomy({ status: 'done', winner: 1, score: { set1: [6, 3], set2: [6, 4], mtb: null } })
    expect(row.slot1.outcome).toBe(null)
    expect(row.slot2.outcome).toBe(null)
  })

  it('reads a retirement behind the sets that were actually played', () => {
    const row = anatomy({
      status: 'done',
      winner: 1,
      outcome: 'retirement',
      score: { set1: [6, 3], set2: null, mtb: null }
    })
    // Quoted the way a result is — behind the winner's sets, not beside the name of whoever stopped.
    expect(row.slot1.games).toBe(score('6'))
    expect(row.slot1.outcome).toBe('· Aufg.')
    expect(row.slot2.outcome).toBe(null)
  })

  it('reads a retirement before any set as a bare token, with no separator left dangling', () => {
    // Someone can retire in the first set, before it is saved. „· Aufg." would then hang off nothing.
    expect(anatomy({ status: 'done', winner: 1, outcome: 'retirement' }).slot1.outcome).toBe('Aufg.')
  })

  it('puts „w.o." in the score’s place, because a walkover has no sets', () => {
    const row = anatomy({ status: 'done', winner: 1, outcome: 'walkover' })
    expect(row.slot1.games).toBe('')
    expect(row.slot2.games).toBe('')
    expect(row.slot1.outcome).toBe('w.o.')
  })

  it('marks the winner as the one fact both the bold and the check read from', () => {
    const row = anatomy({ status: 'done', winner: 2, score: { set1: [3, 6], set2: [4, 6], mtb: null } })
    expect(row.slot2.winner).toBe(true)
    expect(row.slot1.winner).toBe(false)
  })

  it('marks nobody while a match is still running, partial score and all', () => {
    const row = anatomy({ status: 'running', score: { set1: [6, 3], set2: [2, 1], mtb: null } })
    expect(row.slot1.games).toBe(score('6 2'))
    expect(row.slot1.winner).toBe(false)
    expect(row.slot2.winner).toBe(false)
    expect(row.slot1.outcome).toBe(null)
  })
})
