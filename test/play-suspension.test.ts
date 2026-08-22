import { describe, expect, it } from 'vitest'
import {
  NOT_SUSPENDED,
  formatResumeTime,
  playSuspensionSchema,
  resolveSuspension,
  suspendedCourts,
  suspensionNotice
} from '../shared/play-suspension'
import { COURT_NUMBERS } from '../shared/schedule'
import type { PlaySuspension } from '../shared/play-suspension'

// The Play suspension (CONTEXT: Play suspension; ADR-0078) — the event-wide statement that play is not
// happening right now. A typed state, never a message: suspended yes/no plus an optional resume time, and
// the surfaces derive their finished German from it.
//
// The rules under test are the two that are easy to get backwards. **The time decays, the suspension does
// not** (ADR-0078 rule 7): once the resume time has passed the state falls back to the plain suspension —
// it never lifts itself, because an automatic lift would announce, positively and silently, that play has
// resumed. And **the impossible state is not representable**: „not suspended, but a resume time is set"
// cannot survive `resolveSuspension`, which is the normalisation the Store reads through.
//
// Every case passes its own `now`. There is no clock in the module, so a test never races one.

// 22.08.2026, 14:00 Europe/Berlin (UTC+2 in August).
const AT_1400 = Date.UTC(2026, 7, 22, 12, 0)
const AT_1430 = Date.UTC(2026, 7, 22, 12, 30)
const AT_1440 = Date.UTC(2026, 7, 22, 12, 40)

// Every court stopped — the total suspension (ADR-0078 Amendment 2 rule 1: all six *is* total), and the one
// the shell switch writes. The cases about a *subset* name their courts themselves.
const EVERY_COURT = [...COURT_NUMBERS]
const stopped = (resumesAt: number | null, courts: number[] = EVERY_COURT): PlaySuspension => ({
  suspended: true,
  resumesAt,
  courts
})

describe('the state', () => {
  it('is not suspended by default', () => {
    expect(NOT_SUSPENDED).toEqual({ suspended: false })
  })

  it('carries a suspension with no resume time', () => {
    const state = resolveSuspension(stopped(null), AT_1400)
    expect(state).toEqual(stopped(null))
  })

  it('carries a resume time that is still ahead', () => {
    const state = resolveSuspension(stopped(AT_1430), AT_1400)
    expect(state).toEqual(stopped(AT_1430))
  })
})

describe('the time decays, the suspension does not', () => {
  it('drops a resume time that has passed, keeping the suspension', () => {
    const state = resolveSuspension(stopped(AT_1430), AT_1440)
    expect(state).toEqual(stopped(null))
  })

  it('drops it at the exact moment it is reached', () => {
    const state = resolveSuspension(stopped(AT_1430), AT_1430)
    expect(state).toEqual(stopped(null))
  })

  it('never lifts the suspension itself', () => {
    // A day later, and still suspended: only the operator lifts it.
    const state = resolveSuspension(stopped(AT_1430), AT_1430 + 24 * 60 * 60 * 1000)
    expect(state.suspended).toBe(true)
  })
})

describe('the impossible state does not survive the read', () => {
  it('drops a resume time on a state that is not suspended', () => {
    // Reachable only by a hand-edited row: the two columns are independent below the Store.
    const state = resolveSuspension({ suspended: false, resumesAt: AT_1430, courts: EVERY_COURT } as never, AT_1400)
    expect(state).toEqual({ suspended: false })
  })
})

// The set of stopped courts (ADR-0078 Amendment 2 rule 1). All six is the total suspension; the empty set is
// not a state at all, and the normalisation that turns it back into „play is happening" is the same
// fail-closed one that drops a resume time from a lifted suspension.
describe('the suspension names its courts', () => {
  it('carries a subset through the read, in ascending order whatever order it was written in', () => {
    expect(resolveSuspension(stopped(null, [5, 3]), AT_1400)).toEqual(stopped(null, [3, 5]))
  })

  it('drops a duplicate and a court the event does not have', () => {
    // Reachable only by a hand-edited row; the canonical list is what every reader then asks against.
    expect(resolveSuspension(stopped(null, [4, 4, 99]), AT_1400)).toEqual(stopped(null, [4]))
  })

  it('degrades a suspension of no courts to „play is happening"', () => {
    expect(resolveSuspension(stopped(null, []), AT_1400)).toEqual(NOT_SUSPENDED)
    // And so does one whose every named court was nonsense — the same fact by the time it is normalised.
    expect(resolveSuspension(stopped(AT_1430, [99]), AT_1400)).toEqual(NOT_SUSPENDED)
  })

  it('answers the hedge with the stopped courts, and with nothing when play is happening', () => {
    expect(suspendedCourts(stopped(null, [4]), AT_1400)).toEqual([4])
    expect(suspendedCourts(NOT_SUSPENDED, AT_1400)).toEqual([])
    // The set outlives the resume time: the time decays, the suspension — and its extent — does not.
    expect(suspendedCourts(stopped(AT_1430, [4]), AT_1440)).toEqual([4])
  })
})

describe('the wire form', () => {
  it('accepts the two legal shapes', () => {
    expect(playSuspensionSchema.parse({ suspended: false })).toEqual({ suspended: false })
    expect(playSuspensionSchema.parse(stopped(null))).toEqual(stopped(null))
  })

  it('rejects a suspension that names no court, and one that names a court the event does not have', () => {
    // Non-empty and validated against COURT_NUMBERS (Amendment 2 rule 1). The empty set is not a state — a
    // *stored* one degrades on read (see below), but nothing may ask for it over the wire.
    expect(playSuspensionSchema.safeParse(stopped(null, [])).success).toBe(false)
    expect(playSuspensionSchema.safeParse(stopped(null, [7])).success).toBe(false)
  })

  it('strips a resume time off a lifted suspension rather than carrying it through', () => {
    // Fail-closed like the Store's other readers: the impossible combination does not survive the parse.
    // Stripping rather than rejecting is the repo's convention for every wire schema here, and it is the
    // safer half — a hand-edited row degrades to „play is happening" instead of failing the whole response.
    expect(playSuspensionSchema.parse({ suspended: false, resumesAt: AT_1430 })).toEqual({ suspended: false })
  })
})

describe('the resume time reads as a Berlin clock time', () => {
  it('formats an August instant at UTC+2, not at UTC', () => {
    expect(formatResumeTime(AT_1430)).toBe('14:30')
  })
})

describe('the notice', () => {
  it('is absent when play is not suspended', () => {
    expect(suspensionNotice(NOT_SUSPENDED, AT_1400, 'schedule')).toBeNull()
  })

  it('states the shifted times on the schedule when no resume time is known', () => {
    expect(suspensionNotice(stopped(null), AT_1400, 'schedule')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: ['Alle geplanten Startzeiten verschieben sich.'],
      condensed: 'Spielbetrieb unterbrochen'
    })
  })

  it('puts the resume time in front of the shifted-times line', () => {
    expect(suspensionNotice(stopped(AT_1430), AT_1400, 'schedule')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: ['Weiter geht es ca. 14:30 Uhr.', 'Alle geplanten Startzeiten verschieben sich.'],
      condensed: 'Spielbetrieb unterbrochen · weiter ca. 14:30 Uhr'
    })
  })

  it('drops the resume line once that time has passed', () => {
    expect(suspensionNotice(stopped(AT_1430), AT_1440, 'schedule')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: ['Alle geplanten Startzeiten verschieben sich.'],
      condensed: 'Spielbetrieb unterbrochen'
    })
  })

  it('says less on the front door, which has no times to explain', () => {
    expect(suspensionNotice(stopped(AT_1430), AT_1400, 'front-door')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: ['Weiter geht es ca. 14:30 Uhr.'],
      condensed: 'Spielbetrieb unterbrochen'
    })
  })

  it('leaves the front door with the headline alone when no time is known', () => {
    expect(suspensionNotice(stopped(null), AT_1400, 'front-door')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: [],
      condensed: 'Spielbetrieb unterbrochen'
    })
  })
})

// The condensed form is the pinned band's one line (ADR-0078 rule 8 as amended). It is authored here rather
// than sliced out of `lines` by the renderer, and these are the cases that show why no slice would do: the
// half worth keeping is not at a fixed position, and on the front door there is often nothing there at all.
describe('the condensed notice', () => {
  it('keeps the resume time on the schedule, and drops the shifted-times sentence', () => {
    const notice = suspensionNotice(stopped(AT_1430), AT_1400, 'schedule')
    expect(notice?.condensed).toBe('Spielbetrieb unterbrochen · weiter ca. 14:30 Uhr')
  })

  it('falls back to the headline alone once the resume time has decayed', () => {
    // The pinned line decays with the state it states — at 14:40 „weiter ca. 14:30" has been refuted, and
    // the last line standing on the schedule is the one the condensed form deliberately does not keep.
    const notice = suspensionNotice(stopped(AT_1430), AT_1440, 'schedule')
    expect(notice?.condensed).toBe('Spielbetrieb unterbrochen')
  })

  it('gives up the time on the front door, which keeps its pointer instead', () => {
    const notice = suspensionNotice(stopped(AT_1430), AT_1400, 'front-door')
    expect(notice?.condensed).toBe('Spielbetrieb unterbrochen')
  })

  it('never shouts: the line carries a clock time and is not uppercased', () => {
    const notice = suspensionNotice(stopped(AT_1430), AT_1400, 'schedule')
    expect(notice?.condensed).not.toBe(notice?.condensed.toUpperCase())
  })
})
