import { describe, expect, it } from 'vitest'
import { COURT_NUMBERS } from '../shared'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch, ScheduleSlot } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'
import { score } from './score-text'

// The public schedule's projection (ADR-0071, #308): the one place that turns the schedule feed
// into the tree the page renders — day → court → rows — and the one place that decides how a planned time
// is *said*. The rule under test: a court's first match of the day (and every match that opens a new block
// after a gap in that court's reservation chain) states a plain clock time, „HH:MM", because nothing in
// front of it can push it; a match whose reservation abuts the one before it on that court hedges,
// „ca. HH:MM".
//
// Asserted at the interface only — finished German strings and a finished order — because that is the whole
// contract the renderer consumes. There is no clock here and none in the module: every case below is a pure
// function of day, slot and chain (ADR-0032 leaves „läuft" to the match status, not to a time comparison).

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

// A plain, unseeded TV Winsen player — the inert default. The cases that care about a crest or a seed spell
// the slot out themselves.
const player = (firstName: string, lastName: string): ScheduleSlot => ({
  kind: 'player',
  firstName,
  lastName,
  club: 'TV Winsen',
  seed: null
})

// One placed match. Only the fields a case actually exercises are ever passed; the rest are inert defaults,
// so a test reads as the situation it describes.
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

// The event's date copy and the competition labels are the client's (src/data/tournament.ts), handed in as
// data — the module owns the projection, not the calendar.
const OPTIONS: ScheduleViewOptions = {
  days: [
    { weekday: 'Samstag', short: '22.08.' },
    { weekday: 'Sonntag', short: '23.08.' }
  ],
  competitions: [
    { slug: 'womens', label: 'Damen' },
    { slug: 'mens', label: 'Herren' }
  ]
}

const view = (matches: ScheduleMatch[], over: Partial<ScheduleViewOptions> = {}) =>
  scheduleView({ published: true, matches }, { ...OPTIONS, ...over })

// The times on one court, in order — the shape most of the floor-rule cases assert.
const times = (matches: ScheduleMatch[], court = 1): string[] =>
  view(matches)
    .days[0].courts.find(c => c.court === court)
    ?.rows.map(r => r.publishedTime) ?? []

describe('scheduleView · the time is plain when nothing can push it, hedged when something can (ADR-0071)', () => {
  it('states a plain clock time for a court’s first match of the day', () => {
    // Both days open at 10:00 (ADR-0071), so slot 0 is 10:00 — and it carries no „ca.", because nothing can
    // run late into it. The absence of the hedge is the claim.
    expect(times([match({ id: 1, court: 1, slot: 0 })])).toEqual(['10:00'])
  })

  it('hedges with „ca." only where the reservations actually abut', () => {
    // A 90-minute reservation spans three 30-minute steps, so slot 3 begins exactly where slot 0 ends.
    // 11:30 can then only be missed late: the match before it can overrun, never underrun.
    expect(times([match({ id: 1, court: 1, slot: 0 }), match({ id: 2, court: 1, slot: 3 })])).toEqual([
      '10:00',
      'ca. 11:30'
    ])
  })

  it('re-anchors a match that opens a new block after a gap', () => {
    // Slot 0 ends at 11:30 and the next reservation starts at 12:30 — an hour of air. Nothing is waiting to
    // push this start, so the row drops the hedge.
    expect(times([match({ id: 1, court: 1, slot: 0 }), match({ id: 2, court: 1, slot: 5 })])).toEqual([
      '10:00',
      '12:30'
    ])
  })

  it('treats the mixer block’s hole in a court as the gap it is (ADR-0064)', () => {
    // The Social mixer holds courts 12:00–15:00 (ADR-0063); a championship match after it starts at 15:00 =
    // slot 10. The block never reaches this feed — it is simply a court with no reservation in between, and
    // that is exactly what breaks the chain.
    expect(times([match({ id: 1, court: 1, slot: 0 }), match({ id: 2, court: 1, slot: 10 })])).toEqual([
      '10:00',
      '15:00'
    ])
  })

  it('states a plain time for a court that carries exactly one match', () => {
    expect(times([match({ id: 1, court: 1, slot: 4 })])).toEqual(['12:00'])
  })

  it('chains onward through a three-match court', () => {
    expect(
      times([
        match({ id: 1, court: 1, slot: 0 }),
        match({ id: 2, court: 1, slot: 3 }),
        match({ id: 3, court: 1, slot: 6 })
      ])
    ).toEqual(['10:00', 'ca. 11:30', 'ca. 13:00'])
  })

  it('gives each day its own first start', () => {
    // Both days currently open at 10:00 (ADR-0071), but the arithmetic stays per-day — and a court’s chain
    // never runs across the night, so day 1 slot 0 anchors on its own rather than following day 0’s last.
    const { days } = view([match({ id: 1, court: 1, slot: 0, day: 0 }), match({ id: 2, court: 1, slot: 0, day: 1 })])
    expect(days.map(d => d.label)).toEqual(['Samstag · 22.08.', 'Sonntag · 23.08.'])
    expect(days[0].courts[0].rows.map(r => r.publishedTime)).toEqual(['10:00'])
    expect(days[1].courts[0].rows.map(r => r.publishedTime)).toEqual(['10:00'])
  })

  it('carries whether the time is a follow-on, so a caller never reads the German back', () => {
    const { rows } = view([match({ id: 1, court: 1, slot: 0 }), match({ id: 2, court: 1, slot: 3 })]).days[0].courts[0]
    expect(rows.map(r => r.followsOn)).toEqual([false, true])
  })

  it('anchors an overlapping pair rather than hedging against a predecessor it does not follow', () => {
    // Two starts on one court are never closer than a full reservation on a valid plan — occupancy is
    // interval-based and server-enforced (ADR-0040). But a *running* match reports its **actual** court
    // (ADR-0032), so an operator moving a live match onto a busy court puts it inside that court's chain.
    // That is an overlap, not a follow-on: the previous reservation is still covering this start, so the
    // plain time — which promises nothing about a predecessor — is the safe claim.
    const { rows } = view([match({ id: 1, court: 1, slot: 0 }), match({ id: 2, court: 1, slot: 1, status: 'running' })])
      .days[0].courts[0]
    expect(rows.map(r => r.publishedTime)).toEqual(['10:00', '10:30'])
    expect(rows.map(r => r.followsOn)).toEqual([false, false])
  })

  it('reads the chain off the whole court, not off the filtered rows', () => {
    // The reservation chain is a fact about the court; the filter is a fact about the reader. A women’s
    // match that follows a men’s match still follows it, so hiding the men’s row must not promote the
    // women’s row to a plain, unpushable time.
    const matches = [
      match({ id: 1, court: 1, slot: 0, competition: 'mens' }),
      match({ id: 2, court: 1, slot: 3, competition: 'womens' })
    ]
    const filtered = view(matches, { competition: 'womens' })
    expect(filtered.days[0].courts[0].rows.map(r => r.publishedTime)).toEqual(['ca. 11:30'])
  })
})

describe('scheduleView · the tree is finished — grouped, ordered, labelled', () => {
  it('groups day → court, both ascending, rows by slot', () => {
    const result = view([
      match({ id: 1, court: 3, slot: 6, day: 1 }),
      match({ id: 2, court: 1, slot: 3, day: 0 }),
      match({ id: 3, court: 1, slot: 0, day: 0 }),
      match({ id: 4, court: 2, slot: 0, day: 0 })
    ])
    expect(result.days.map(d => d.day)).toEqual([0, 1])
    expect(result.days[0].courts.map(c => c.label)).toEqual(['Platz 1', 'Platz 2'])
    expect(result.days[0].courts[0].rows.map(r => r.id)).toEqual([3, 2])
    expect(result.days[1].courts.map(c => c.label)).toEqual(['Platz 3'])
  })

  it('names only the courts and days that carry a match', () => {
    const result = view([match({ id: 1, court: 5, slot: 0, day: 1 })])
    expect(result.days.map(d => d.day)).toEqual([1])
    expect(result.days[0].courts.map(c => c.court)).toEqual([5])
  })

  it('finishes the meta line — round, match number, competition', () => {
    const [row] = view([match({ id: 1, court: 1, slot: 0, number: 3, round: 2, totalRounds: 3 })]).days[0].courts[0]
      .rows
    expect(row.meta).toBe('Halbfinale · M3 · Herren')
    // A planned row carries no badge: „geplant" was the default state printed on every row of the page.
    expect(row.statusLabel).toBe(null)
  })

  it('carries a running match’s status and its partial score', () => {
    const [row] = view([
      match({
        id: 1,
        court: 2,
        slot: 0,
        status: 'running',
        score: { set1: [6, 3], set2: null, mtb: null }
      })
    ]).days[0].courts[0].rows
    expect(row.status).toBe('running')
    expect(row.statusLabel).toBe('läuft')
    expect(row.slot1.games).toBe(score('6'))
    expect(row.slot2.games).toBe(score('3'))
    expect(row.slot1.winner).toBe(false)
  })

  it('marks the winner and prints both slots’ games on a finished match', () => {
    const [row] = view([
      match({
        id: 1,
        court: 1,
        slot: 0,
        status: 'done',
        winner: 2,
        score: { set1: [6, 3], set2: [4, 6], mtb: [8, 10] }
      })
    ]).days[0].courts[0].rows
    // No „beendet" either — the score is what says the match is over.
    expect(row.statusLabel).toBe(null)
    expect(row.slot1.games).toBe(score('6 4 8'))
    expect(row.slot2.games).toBe(score('3 6 10'))
    expect(row.slot2.winner).toBe(true)
    expect(row.slot1.winner).toBe(false)
  })
})

describe('scheduleView · it never throws', () => {
  it('degrades an unresolvable slot to „offen" rather than breaking the page (ADR-0035)', () => {
    const [row] = view([match({ id: 1, court: 1, slot: 0, slot1: { kind: 'unknown' } })]).days[0].courts[0].rows
    expect(row.slot1).toMatchObject({ text: 'offen', tbd: true })
    expect(row.slot2).toMatchObject({ text: 'Til Osten', tbd: false })
  })

  it('names a feeder and a bye as themselves, not as a free pass', () => {
    const [row] = view([
      match({ id: 1, court: 1, slot: 0, slot1: { kind: 'feeder', matchNumber: 3 }, slot2: { kind: 'bye' } })
    ]).days[0].courts[0].rows
    expect(row.slot1).toMatchObject({ text: 'Sieger M3', tbd: true })
    expect(row.slot2.tbd).toBe(true)
  })

  it('falls back to a numbered day rather than a blank heading when the copy is short', () => {
    const result = scheduleView(
      { published: true, matches: [match({ id: 1, court: 1, slot: 0, day: 1 })] },
      { ...OPTIONS, days: [{ weekday: 'Samstag', short: '22.08.' }] }
    )
    expect(result.days[0].label).toBe('Tag 2')
  })

  it('returns an empty tree for an empty feed', () => {
    expect(view([])).toMatchObject({ days: [], competitions: [], selected: null })
  })
})

describe('scheduleView · the competition filter', () => {
  it('offers only the fields the feed actually carries, in the display order', () => {
    // A cancelled field stops being carried by the feed (ADR-0062), so it leaves the filter without anyone
    // telling the filter — and it leaves the schedule with it.
    const result = view([
      match({ id: 1, court: 1, slot: 0, competition: 'mens' }),
      match({ id: 2, court: 2, slot: 0, competition: 'womens' })
    ])
    expect(result.competitions).toEqual([
      { slug: 'womens', label: 'Damen' },
      { slug: 'mens', label: 'Herren' }
    ])
  })

  it('leaves no trace of a field the feed stopped carrying', () => {
    // A cancelled field leaves the whole page, not only the filter (ADR-0062) — and it needs no gate of its
    // own to do it: the feed simply stops carrying its matches, so there is nothing to group.
    const result = view([match({ id: 1, court: 1, slot: 0, competition: 'mens' })])
    const rows = result.days.flatMap(d => d.courts.flatMap(c => c.rows))
    expect(rows).toHaveLength(1)
    expect(result.competitions.some(c => c.slug === 'womens')).toBe(false)
    expect(rows.every(r => r.meta.includes('Herren'))).toBe(true)
  })

  it('narrows the tree to the selected field', () => {
    const result = view(
      [
        match({ id: 1, court: 1, slot: 0, competition: 'mens' }),
        match({ id: 2, court: 2, slot: 0, competition: 'womens' })
      ],
      { competition: 'womens' }
    )
    expect(result.selected).toBe('womens')
    expect(result.days[0].courts.map(c => c.court)).toEqual([2])
  })

  it('degrades a field it has never heard of to „Alle"', () => {
    // The selection arrives from the URL now (#310), so it can say anything at all — a typo, a slug from a
    // past year, a competition someone invented. It is read like any other selection the page cannot honour
    // and falls back to the full board, quietly and without an error.
    const result = view(
      [
        match({ id: 1, court: 1, slot: 0, competition: 'mens' }),
        match({ id: 2, court: 2, slot: 0, competition: 'womens' })
      ],
      { competition: 'juniors' }
    )
    expect(result.selected).toBe(null)
    expect(result.days[0].courts.map(c => c.court)).toEqual([1, 2])
  })

  it('drops a selection the feed no longer carries, and one with nothing to choose between', () => {
    const gone = view([match({ id: 1, court: 1, slot: 0, competition: 'mens' })], { competition: 'womens' })
    expect(gone.selected).toBe(null)
    expect(gone.competitions).toEqual([])
    expect(gone.days[0].courts[0].rows).toHaveLength(1)
  })
})

describe('scheduleView · the courts board reads live truth', () => {
  it('shows the running match on its court and „frei" everywhere else', () => {
    const result = view([
      match({ id: 1, court: 2, slot: 0, status: 'running', score: { set1: [6, 3], set2: null, mtb: null } }),
      match({ id: 2, court: 3, slot: 0, status: 'planned' })
    ])
    expect(result.courts).toHaveLength(6)
    const two = result.courts![1]
    expect(two).toMatchObject({ court: 2, label: 'Platz 2', free: false, dim: false })
    // Narrow the union — a free cell carries no contestants to ask about.
    if (two.free) throw new Error('Platz 2 should be live')
    expect(two.meta).toBe('Viertelfinale · Herren')
    expect(two.slot1).toMatchObject({ text: 'Jan Behrens', games: score('6') })
    // A planned match never occupies a court on the board — only a running one does (ADR-0032).
    expect(result.courts![2]).toMatchObject({ court: 3, free: true })
  })

  it('fades the courts outside the filtered field instead of blanking them', () => {
    const result = view(
      [
        match({ id: 1, court: 1, slot: 0, status: 'running', competition: 'mens' }),
        match({ id: 2, court: 2, slot: 0, status: 'running', competition: 'womens' })
      ],
      { competition: 'womens' }
    )
    expect(result.courts![0]).toMatchObject({ free: false, dim: true })
    expect(result.courts![1]).toMatchObject({ free: false, dim: false })
    expect(result.courts![2]).toMatchObject({ free: true, dim: true })
  })
})

// Every court stopped — the total suspension, which is what the shell switch writes and therefore the only
// one the site can currently be in (ADR-0078 Amendment 2 rule 1: all six *is* total).
const EVERY_COURT = [...COURT_NUMBERS]

describe('scheduleView · a Play suspension hedges every not-yet-started time (ADR-0078 rule 4)', () => {
  it('hedges a court’s first match of the day, which nothing structural could push', () => {
    // The plain 10:00 of the anchoring case above. Suspended, it is no longer unpushable: the suspension is
    // precisely „what can still move this start" — ADR-0071's own definition of what a hedge is about — and
    // it moves everything, including the row that had nothing in front of it.
    expect(times([match({ id: 1, court: 1, slot: 0 })])).toEqual(['10:00'])
    const { rows } = view([match({ id: 1, court: 1, slot: 0 })], { stoppedCourts: EVERY_COURT }).days[0].courts[0]
    expect(rows.map(r => r.publishedTime)).toEqual(['ca. 10:00'])
  })

  it('carries the hedge as a fact, so the renderer styles it like any other', () => {
    const { rows } = view([match({ id: 1, court: 1, slot: 0 })], { stoppedCourts: EVERY_COURT }).days[0].courts[0]
    expect(rows.map(r => r.followsOn)).toEqual([true])
  })

  it('leaves a match that has already started alone', () => {
    // „Not yet started" is the whole scope: a running match's start is history, not a claim about the
    // future. Only the plan ahead moves.
    const { rows } = view(
      [match({ id: 1, court: 1, slot: 0, status: 'running' }), match({ id: 2, court: 1, slot: 3 })],
      {
        stoppedCourts: EVERY_COURT
      }
    ).days[0].courts[0]
    expect(rows.map(r => r.publishedTime)).toEqual(['10:00', 'ca. 11:30'])
  })

  it('does not double the hedge on a time that already carried one', () => {
    const { rows } = view([match({ id: 1, court: 1, slot: 0 }), match({ id: 2, court: 1, slot: 3 })], {
      stoppedCourts: EVERY_COURT
    }).days[0].courts[0]
    expect(rows.map(r => r.publishedTime)).toEqual(['ca. 10:00', 'ca. 11:30'])
  })
})
