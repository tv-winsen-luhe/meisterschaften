import { describe, expect, it } from 'vitest'
import type { Match, MatchScore, MatchStatus } from '../shared'
import {
  courtSections,
  courtText,
  effectiveCourt,
  metaParts,
  type ResultMatch,
  type ResultsCopy
} from '../src/admin/surfaces/results-grouping'

// The Ergebnisse surface's court reading (ADR-0077) — the grouping and the two meta lines, lifted out of
// the component so they are plain unit tests: no DOM, no draws response, no drawer. The admin groups
// locally over the `Match[]` it already holds rather than reusing the public `scheduleView()`, because that
// projection excludes exactly what this surface must show (unplaced matches, the unpublished plan) and adds
// what it must not have (the „ca." hedge). This file is what stops the two drifting into each other.
//
// Copy arrives as options, the same convention `scheduleView` uses (test/match-row.test.ts), so every
// assertion below is in finished German and no German literal hides in the module.

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

const COPY: ResultsCopy = {
  days: [
    { weekday: 'Samstag', short: '22.08.' },
    { weekday: 'Sonntag', short: '23.08.' }
  ],
  competitions: [
    { slug: 'mens', label: 'Herren' },
    { slug: 'womens', label: 'Damen' }
  ]
}

const match = (over: Partial<Match> = {}): Match => ({
  id: 1,
  competition: 'mens',
  bracket: 'main',
  round: 1,
  position: 0,
  thirdPlace: false,
  slot1RegId: 10,
  slot2RegId: 11,
  winnerRegId: null,
  outcome: null,
  score: NO_SCORE,
  court: null,
  day: null,
  slot: null,
  status: 'planned' as MatchStatus,
  liveCourt: null,
  ...over
})

const row = (over: Partial<Match> = {}, meta: Partial<ResultMatch> = {}): ResultMatch => ({
  match: match(over),
  number: 7,
  roundLabel: 'Viertelfinale',
  slot1: { kind: 'player', regId: 10 },
  slot2: { kind: 'player', regId: 11 },
  ...meta
})

describe('effectiveCourt', () => {
  it('is the planned court before the match starts', () => {
    expect(effectiveCourt(match({ court: 5 }))).toBe(5)
  })

  it('is the actual court once one is captured, so a running match sits where it is really played', () => {
    // ADR-0032 captures the actual court at the `running` transition precisely because it diverges; the
    // court view answers „was läuft auf Platz 3", so the answer has to be reality (ADR-0077 rule 3).
    expect(effectiveCourt(match({ court: 5, liveCourt: 3, status: 'running' }))).toBe(3)
  })

  it('is null for a match with no placement at all', () => {
    expect(effectiveCourt(match())).toBe(null)
  })
})

describe('courtText', () => {
  it('names the planned court before the start', () => {
    expect(courtText(match({ court: 3 }))).toBe('Platz 3')
  })

  it('names the actual court alone when it is the planned one', () => {
    expect(courtText(match({ court: 3, liveCourt: 3, status: 'running' }))).toBe('Platz 3')
  })

  it('names both when the actual court diverges from the plan, so a mis-started match is noticeable', () => {
    expect(courtText(match({ court: 5, liveCourt: 3, status: 'running' }))).toBe('Platz 3 (geplant 5)')
  })

  it('keeps the actual court after the match is done', () => {
    expect(courtText(match({ court: 5, liveCourt: 3, status: 'done' }))).toBe('Platz 3 (geplant 5)')
  })

  it('says nothing for an unplaced match — the surface has its own hint for that', () => {
    expect(courtText(match())).toBe(null)
  })
})

describe('metaParts, round view', () => {
  it('carries the day, the plain clock time and the court — what the round heading does not say', () => {
    // Plain „Sa 14:00", never „ca." — the hedge states what can still move a start, and the operator is
    // what moves it (ADR-0077 rule 1). Slot 8 on a 10:00 day start, 30-minute cadence.
    expect(metaParts(row({ court: 3, day: 0, slot: 8 }), 'round', COPY)).toEqual(['Sa 14:00', 'Platz 3'])
  })

  it('names the day even when it is the second one, since both days share one slot numbering', () => {
    expect(metaParts(row({ court: 3, day: 1, slot: 0 }), 'round', COPY)).toEqual(['So 10:00', 'Platz 3'])
  })

  it('says „Nicht geplant" for an unplaced match rather than falling silent', () => {
    // Rule 3: the court is shown always, and „no court at all" is legible instead of silent. The row's own
    // start hint cannot carry this — it only renders for a `planned` match with both players known, so a
    // feeder row or a cleared running match would say nothing at all.
    expect(metaParts(row(), 'round', COPY)).toEqual(['Nicht geplant'])
  })
})

describe('metaParts, court view', () => {
  it('drops the day (the heading says it) and adds the round and the field (the headings cannot)', () => {
    // The field tabs are hidden in this view, so the competition is the one thing a court group cannot
    // tell you — required here, not optional (ADR-0077 rule 6).
    expect(metaParts(row({ court: 3, day: 0, slot: 8 }), 'court', COPY)).toEqual(['14:00', 'Viertelfinale', 'Herren'])
  })

  it('falls back to the wire slug for a field whose label the copy does not know', () => {
    expect(metaParts(row({ competition: 'mens-challenger', court: 3, day: 0, slot: 0 }), 'court', COPY)).toEqual([
      '10:00',
      'Viertelfinale',
      'mens-challenger'
    ])
  })

  it('carries round and field with no time in the „Nicht geplant" group', () => {
    expect(metaParts(row(), 'court', COPY)).toEqual(['Viertelfinale', 'Herren'])
  })

  it('keeps the day on a timed row with no court, because its group heading names no day', () => {
    // Rule 2 — the day travels with the time, *always*. In the court view the day heading normally says it,
    // but a row without a court sits under „Nicht geplant", which does not: so the time re-takes its prefix
    // rather than reading as an unqualified „14:00" on one of two days.
    expect(metaParts(row({ day: 0, slot: 8 }), 'court', COPY)).toEqual(['Sa 14:00', 'Viertelfinale', 'Herren'])
  })
})

describe('courtSections', () => {
  it('groups day → court → chronological, the fixed public hierarchy', () => {
    const rows = [
      row({ id: 1, court: 3, day: 0, slot: 8 }),
      row({ id: 2, court: 1, day: 0, slot: 0 }),
      row({ id: 3, court: 3, day: 0, slot: 2 }),
      row({ id: 4, court: 2, day: 1, slot: 4 })
    ]
    const sections = courtSections(rows, COPY)
    expect(sections.map(s => s.label)).toEqual(['Samstag · 22.08.', 'Sonntag · 23.08.'])
    expect(sections[0].courts.map(c => c.label)).toEqual(['Platz 1', 'Platz 3'])
    // Within a court, chronological — slot 2 before slot 8, whatever order they arrived in.
    expect(sections[0].courts[1].rows.map(r => r.match.id)).toEqual([3, 1])
    expect(sections[1].courts.map(c => c.label)).toEqual(['Platz 2'])
  })

  it('drops empty courts and empty days rather than printing six „frei" headings a day', () => {
    const sections = courtSections([row({ id: 1, court: 6, day: 1, slot: 0 })], COPY)
    expect(sections).toHaveLength(1)
    expect(sections[0].label).toBe('Sonntag · 23.08.')
    expect(sections[0].courts.map(c => c.label)).toEqual(['Platz 6'])
  })

  it('files a running match under its actual court, not the one it was planned on', () => {
    const sections = courtSections([row({ id: 1, court: 5, day: 0, slot: 4, liveCourt: 3, status: 'running' })], COPY)
    expect(sections[0].courts.map(c => c.label)).toEqual(['Platz 3'])
  })

  it('collects placement-less matches in a trailing „Nicht geplant" group, so nothing vanishes', () => {
    const rows = [row({ id: 1 }), row({ id: 2, court: 3, day: 0, slot: 0 }), row({ id: 3 })]
    const sections = courtSections(rows, COPY)
    expect(sections.map(s => s.label)).toEqual(['Samstag · 22.08.', 'Nicht geplant'])
    const backlog = sections[1].courts
    expect(backlog).toHaveLength(1)
    // No court heading inside it — there is no court to name.
    expect(backlog[0].label).toBe(null)
    expect(backlog[0].rows.map(r => r.match.id)).toEqual([1, 3])
  })

  it('is empty for no rows at all', () => {
    expect(courtSections([], COPY)).toEqual([])
  })
})
