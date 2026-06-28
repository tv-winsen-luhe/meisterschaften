import { describe, expect, it } from 'vitest'
import { feederPosition, numberMatches, slotTime, viewSlot } from '../shared/schedule'

// The pure schedule helpers (shared/schedule.ts): the slot-time cadence, match numbering, and the
// feeder resolution the admin grid and the public feed both read. Deterministic, no deps — the
// prior art is draw.test.ts.

// A minimal bracket position. Round-1 matches pair adjacent first-round lines; later rounds carry the
// implicit feeders (null slots until a result advances a player).
const m = (id: number, round: number, position: number, slot1: number | null = null, slot2: number | null = null) => ({
  id,
  round,
  position,
  slot1RegId: slot1,
  slot2RegId: slot2
})

describe('slotTime', () => {
  it('counts up from the 09:00 first slot at the fixed 90-minute cadence', () => {
    expect(slotTime(0)).toBe('09:00')
    expect(slotTime(1)).toBe('10:30')
    expect(slotTime(2)).toBe('12:00')
    expect(slotTime(5)).toBe('16:30')
  })
})

describe('numberMatches', () => {
  it('numbers a bracket M1.. by round then position, regardless of input order', () => {
    // A scrambled 4-draw: two semifinals (round 1) + final (round 2).
    const numbers = numberMatches([m(30, 2, 0), m(10, 1, 1), m(20, 1, 0)])
    expect(numbers.get(20)).toBe(1) // round 1, position 0
    expect(numbers.get(10)).toBe(2) // round 1, position 1
    expect(numbers.get(30)).toBe(3) // round 2, position 0 — the final, last
  })
})

describe('feederPosition', () => {
  it('maps a later-round slot to the feeding (round−1, 2p[+1]) position', () => {
    expect(feederPosition(2, 0, 1)).toEqual({ round: 1, position: 0 })
    expect(feederPosition(2, 0, 2)).toEqual({ round: 1, position: 1 })
    expect(feederPosition(3, 1, 2)).toEqual({ round: 2, position: 3 })
  })

  it('has no feeder in round 1 (its slots are drawn, not fed)', () => {
    expect(feederPosition(1, 0, 1)).toBeNull()
  })
})

describe('viewSlot', () => {
  const matches = [m(1, 1, 0, 101, 102), m(2, 1, 1, 103, null), m(3, 2, 0, 103, null)]
  const numbers = numberMatches(matches)
  const matchAt = (round: number, position: number) => matches.find(x => x.round === round && x.position === position)

  it('shows a filled slot as its player, whatever the round', () => {
    expect(viewSlot(matches[0], 1, numbers, matchAt)).toEqual({ kind: 'player', regId: 101 })
    // A bye winner already advanced into round 2 reads as a player, not a feeder.
    expect(viewSlot(matches[2], 1, numbers, matchAt)).toEqual({ kind: 'player', regId: 103 })
  })

  it('shows an empty round-1 slot as a bye line', () => {
    expect(viewSlot(matches[1], 2, numbers, matchAt)).toEqual({ kind: 'bye' })
  })

  it('shows an empty later-round slot as a feeder labelled by the feeding match number', () => {
    // The final's second slot is fed by M2 (round 1, position 1) — still undecided.
    expect(viewSlot(matches[2], 2, numbers, matchAt)).toEqual({ kind: 'feeder', matchNumber: 2 })
  })
})
