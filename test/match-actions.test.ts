import { describe, expect, it } from 'vitest'
import type { Match } from '../shared'
import { bothPlayersKnown, cardActions } from '../src/admin/surfaces/match-actions'

// The Spielplan card's two new affordances (ADR-0080), as the pure question behind them: which doors does
// *this* match open, and what does the status control write when it is used? The card itself is chrome
// around this answer, and the answer is the half that can be wrong — a result door on a match with a
// „Sieger M3" line has nothing to enter, and a start that forgets to state the actual court would put the
// match nowhere the public board can read (ADR-0079 rule 1).

const match = (overrides: Partial<Match> = {}): Match => ({
  id: 1,
  competition: 'mens',
  bracket: 'main',
  round: 1,
  position: 0,
  thirdPlace: false,
  slot1RegId: 11,
  slot2RegId: 22,
  winnerRegId: null,
  outcome: null,
  score: { set1: null, set2: null, mtb: null },
  court: 3,
  day: 0,
  slot: 4,
  status: 'planned',
  liveCourt: null,
  ...overrides
})

describe('both players known', () => {
  it('is true once both slots hold a player', () => {
    expect(bothPlayersKnown(match())).toBe(true)
  })

  it('is false while either slot still waits on a feeder', () => {
    expect(bothPlayersKnown(match({ slot1RegId: null }))).toBe(false)
    expect(bothPlayersKnown(match({ slot2RegId: null }))).toBe(false)
    expect(bothPlayersKnown(match({ slot1RegId: null, slot2RegId: null }))).toBe(false)
  })
})

describe('the placed card’s actions (ADR-0080)', () => {
  it('offers the result door and a start on a planned match with both players', () => {
    expect(cardActions(match())).toEqual({ result: true, status: { next: 'running', liveCourt: 3 } })
  })

  it('withholds both doors while a player is still a feeder', () => {
    expect(cardActions(match({ slot1RegId: null }))).toEqual({ result: false, status: null })
  })

  it('starts a match on the court it actually is on, not the one it was reserved for', () => {
    // A match taken back to „geplant" and started again keeps the court the operator last stated: the
    // actual court is tracked for the life of the match (ADR-0079 rule 1), and the grid is not the lever
    // that pulls it back to its reservation.
    expect(cardActions(match({ liveCourt: 5 }))).toEqual({ result: true, status: { next: 'running', liveCourt: 5 } })
  })

  it('takes a running match back to „geplant" with no court — the Store clears the actual one', () => {
    expect(cardActions(match({ status: 'running', liveCourt: 5 }))).toEqual({
      result: true,
      status: { next: 'planned' }
    })
  })

  it('keeps the result door on a finished match, and drops the status control', () => {
    // „beendet" is the one one-way door (ADR-0079 rule 6); correcting the result is still a door.
    expect(cardActions(match({ status: 'done', winnerRegId: 11 }))).toEqual({ result: true, status: null })
  })

  it('offers no start without a court — a „läuft" has no court to state', () => {
    // The rule, not a grid state: a placed card always has a court, and this is what keeps the function
    // total rather than starting a match onto `undefined`. It is the same rule the Ergebnisse row states
    // in prose („Zum Starten erst im Spielplan platzieren"), which is the surface where it can be seen.
    expect(cardActions(match({ court: null, day: null, slot: null }))).toEqual({ result: true, status: null })
  })
})
