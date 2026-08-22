import { describe, expect, it } from 'vitest'
import {
  NOT_SUSPENDED,
  formatResumeTime,
  playSuspensionSchema,
  resolveSuspension,
  suspensionNotice
} from '../shared/play-suspension'

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

describe('the state', () => {
  it('is not suspended by default', () => {
    expect(NOT_SUSPENDED).toEqual({ suspended: false })
  })

  it('carries a suspension with no resume time', () => {
    const state = resolveSuspension({ suspended: true, resumesAt: null }, AT_1400)
    expect(state).toEqual({ suspended: true, resumesAt: null })
  })

  it('carries a resume time that is still ahead', () => {
    const state = resolveSuspension({ suspended: true, resumesAt: AT_1430 }, AT_1400)
    expect(state).toEqual({ suspended: true, resumesAt: AT_1430 })
  })
})

describe('the time decays, the suspension does not', () => {
  it('drops a resume time that has passed, keeping the suspension', () => {
    const state = resolveSuspension({ suspended: true, resumesAt: AT_1430 }, AT_1440)
    expect(state).toEqual({ suspended: true, resumesAt: null })
  })

  it('drops it at the exact moment it is reached', () => {
    const state = resolveSuspension({ suspended: true, resumesAt: AT_1430 }, AT_1430)
    expect(state).toEqual({ suspended: true, resumesAt: null })
  })

  it('never lifts the suspension itself', () => {
    // A day later, and still suspended: only the operator lifts it.
    const state = resolveSuspension({ suspended: true, resumesAt: AT_1430 }, AT_1430 + 24 * 60 * 60 * 1000)
    expect(state.suspended).toBe(true)
  })
})

describe('the impossible state does not survive the read', () => {
  it('drops a resume time on a state that is not suspended', () => {
    // Reachable only by a hand-edited row: the two columns are independent below the Store.
    const state = resolveSuspension({ suspended: false, resumesAt: AT_1430 } as never, AT_1400)
    expect(state).toEqual({ suspended: false })
  })
})

describe('the wire form', () => {
  it('accepts the two legal shapes', () => {
    expect(playSuspensionSchema.parse({ suspended: false })).toEqual({ suspended: false })
    expect(playSuspensionSchema.parse({ suspended: true, resumesAt: null })).toEqual({
      suspended: true,
      resumesAt: null
    })
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
    expect(suspensionNotice({ suspended: true, resumesAt: null }, AT_1400, 'schedule')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: ['Alle geplanten Startzeiten verschieben sich.'],
      condensed: 'Spielbetrieb unterbrochen'
    })
  })

  it('puts the resume time in front of the shifted-times line', () => {
    expect(suspensionNotice({ suspended: true, resumesAt: AT_1430 }, AT_1400, 'schedule')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: ['Weiter geht es ca. 14:30 Uhr.', 'Alle geplanten Startzeiten verschieben sich.'],
      condensed: 'Spielbetrieb unterbrochen · weiter ca. 14:30 Uhr'
    })
  })

  it('drops the resume line once that time has passed', () => {
    expect(suspensionNotice({ suspended: true, resumesAt: AT_1430 }, AT_1440, 'schedule')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: ['Alle geplanten Startzeiten verschieben sich.'],
      condensed: 'Spielbetrieb unterbrochen'
    })
  })

  it('says less on the front door, which has no times to explain', () => {
    expect(suspensionNotice({ suspended: true, resumesAt: AT_1430 }, AT_1400, 'front-door')).toEqual({
      headline: 'Spielbetrieb unterbrochen',
      lines: ['Weiter geht es ca. 14:30 Uhr.'],
      condensed: 'Spielbetrieb unterbrochen'
    })
  })

  it('leaves the front door with the headline alone when no time is known', () => {
    expect(suspensionNotice({ suspended: true, resumesAt: null }, AT_1400, 'front-door')).toEqual({
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
    const notice = suspensionNotice({ suspended: true, resumesAt: AT_1430 }, AT_1400, 'schedule')
    expect(notice?.condensed).toBe('Spielbetrieb unterbrochen · weiter ca. 14:30 Uhr')
  })

  it('falls back to the headline alone once the resume time has decayed', () => {
    // The pinned line decays with the state it states — at 14:40 „weiter ca. 14:30" has been refuted, and
    // the last line standing on the schedule is the one the condensed form deliberately does not keep.
    const notice = suspensionNotice({ suspended: true, resumesAt: AT_1430 }, AT_1440, 'schedule')
    expect(notice?.condensed).toBe('Spielbetrieb unterbrochen')
  })

  it('gives up the time on the front door, which keeps its pointer instead', () => {
    const notice = suspensionNotice({ suspended: true, resumesAt: AT_1430 }, AT_1400, 'front-door')
    expect(notice?.condensed).toBe('Spielbetrieb unterbrochen')
  })

  it('never shouts: the line carries a clock time and is not uppercased', () => {
    const notice = suspensionNotice({ suspended: true, resumesAt: AT_1430 }, AT_1400, 'schedule')
    expect(notice?.condensed).not.toBe(notice?.condensed.toUpperCase())
  })
})
