import { describe, expect, it } from 'vitest'
import { eventDayAt } from '../src/data/tournament'

// The Current event day (CONTEXT: Current event day, ADR-0081): which of the event's two days is being
// played *now*, read from a server timestamp and from nothing else. This is the only clock the public
// schedule admits, so its one interesting property is the boundary — and the boundary is calendar midnight
// in **Europe/Berlin**, not in whatever zone the runtime happens to be in.
//
// Every case passes an instant with an explicit offset, so the assertion is about the *zone conversion* and
// never about where the test runs.

describe('eventDayAt', () => {
  it('names the day being played', () => {
    expect(eventDayAt('2026-08-22T10:00:00+02:00')).toBe(0)
    expect(eventDayAt('2026-08-23T14:30:00+02:00')).toBe(1)
  })

  it('turns over at calendar midnight, Europe/Berlin', () => {
    expect(eventDayAt('2026-08-22T23:59:59+02:00')).toBe(0)
    expect(eventDayAt('2026-08-23T00:00:00+02:00')).toBe(1)
    expect(eventDayAt('2026-08-23T23:59:59+02:00')).toBe(1)
    expect(eventDayAt('2026-08-24T00:00:00+02:00')).toBeNull()
  })

  it('reads the instant in Berlin, not in UTC', () => {
    // 22:30 UTC on Saturday is already 00:30 on Sunday in Berlin — the day is Sunday.
    expect(eventDayAt('2026-08-22T22:30:00Z')).toBe(1)
    // …and 22:30 Berlin on Saturday is still Saturday, though it is 20:30 UTC.
    expect(eventDayAt('2026-08-22T22:30:00+02:00')).toBe(0)
  })

  it('has no answer outside the weekend', () => {
    expect(eventDayAt('2026-08-21T23:59:59+02:00')).toBeNull()
    expect(eventDayAt('2026-09-01T12:00:00+02:00')).toBeNull()
  })

  it('fails open on a missing or unreadable time', () => {
    // The page falls back to chronological order rather than guessing a day (ADR-0081 §6), so every one of
    // these has to be „no current day" and never a thrown error or a NaN-shaped answer.
    expect(eventDayAt(null)).toBeNull()
    expect(eventDayAt(undefined)).toBeNull()
    expect(eventDayAt('')).toBeNull()
    expect(eventDayAt('not-a-time')).toBeNull()
  })
})
