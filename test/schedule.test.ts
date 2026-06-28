import { describe, expect, it } from 'vitest'
import {
  feederPosition,
  numberMatches,
  resolveBracket,
  slotLabel,
  slotTime,
  validatePlacement,
  viewSlot
} from '../shared/schedule'
import type { Placement } from '../shared/schedule'

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

  it('degrades an unresolvable feeder to an undecided slot, never a bogus matchNumber 0', () => {
    // A later-round empty slot whose feeding match is missing (e.g. a row hard-deleted under a frozen
    // draw) — the bracket should materialize whole, so this is an inconsistency, not a normal state.
    // It must degrade to `unknown`, not the `matchNumber: 0` that 500s the public feed (ADR-0035).
    const orphan = m(9, 2, 0, null, null)
    const missingFeeder = () => undefined
    expect(viewSlot(orphan, 1, new Map(), missingFeeder)).toEqual({ kind: 'unknown' })
  })
})

describe('slotLabel', () => {
  it('spells the German label for each non-player slot, the single copy both surfaces render', () => {
    expect(slotLabel({ kind: 'bye' })).toBe('Freilos')
    expect(slotLabel({ kind: 'feeder', matchNumber: 3 })).toBe('Sieger M3')
    expect(slotLabel({ kind: 'unknown' })).toBe('offen')
  })
})

describe('resolveBracket', () => {
  it('numbers and resolves a whole bracket in one pass, regardless of input order', () => {
    // A scrambled 4-draw: two semifinals (M1, M2) feeding the final (M3); M2 already advanced a bye
    // winner (103) into the final's first slot.
    const resolved = resolveBracket([m(3, 2, 0, 103, null), m(1, 1, 0, 101, 102), m(2, 1, 1, 103, null)])
    const byId = new Map(resolved.map(r => [r.match.id, r]))
    expect(byId.get(1)).toMatchObject({
      number: 1,
      slot1: { kind: 'player', regId: 101 },
      slot2: { kind: 'player', regId: 102 }
    })
    // M2's empty round-1 slot is a bye line.
    expect(byId.get(2)).toMatchObject({ number: 2, slot2: { kind: 'bye' } })
    // The final: slot1 is the advanced player, slot2 still waits on the M2 feeder.
    expect(byId.get(3)).toMatchObject({
      number: 3,
      slot1: { kind: 'player', regId: 103 },
      slot2: { kind: 'feeder', matchNumber: 2 }
    })
  })

  it('returns one row per input match, preserving input order', () => {
    const out = resolveBracket([m(3, 2, 0), m(1, 1, 0, 101, 102), m(2, 1, 1, 103, 104)])
    expect(out.map(r => r.match.id)).toEqual([3, 1, 2])
  })
})

interface MatchOpts {
  p?: [number | null, number | null]
  at?: Placement
}

describe('validatePlacement', () => {
  // A placed/placeable match in the „mens" main bracket. `at` is its cell (omit ⇒ backlog), `p` its
  // two player regIds.
  const pm = (id: number, round: number, position: number, { p = [null, null], at }: MatchOpts = {}) => ({
    id,
    competition: 'mens',
    bracket: 'main',
    round,
    position,
    slot1RegId: p[0],
    slot2RegId: p[1],
    court: at?.court ?? null,
    day: at?.day ?? null,
    slot: at?.slot ?? null
  })

  // A 4-draw: two semifinals (M1 r1p0, M2 r1p1) feeding the final (M3 r2p0).
  const semi1 = pm(1, 1, 0, { p: [101, 102] })
  const semi2 = pm(2, 1, 1, { p: [103, 104] })
  const final = pm(3, 2, 0)

  it('accepts a sound placement — no hard blocks, no soft warnings', () => {
    // Semis on day 0 slots 0/1, the final after both at slot 2.
    const matches = [{ ...semi1, court: 1, day: 0, slot: 0 }, { ...semi2, court: 2, day: 0, slot: 0 }, final]
    expect(validatePlacement(matches, { id: 3, placement: { court: 1, day: 0, slot: 2 } })).toEqual({
      hard: [],
      soft: []
    })
  })

  describe('hard — round dependency', () => {
    it('blocks a match sharing or preceding a feeder it depends on', () => {
      const matches = [{ ...semi1, court: 1, day: 0, slot: 2 }, semi2, final]
      // The final into the same slot as semifinal M1 — its winner could not have arrived.
      const { hard } = validatePlacement(matches, { id: 3, placement: { court: 2, day: 0, slot: 2 } })
      expect(hard).toEqual([{ rule: 'feeder-order', otherMatchId: 1 }])
    })

    it('blocks a feeder placed at or after the match it feeds (the reverse direction)', () => {
      const matches = [semi1, semi2, { ...final, court: 1, day: 0, slot: 1 }]
      // Semifinal M1 into a slot after the final it feeds.
      const { hard } = validatePlacement(matches, { id: 1, placement: { court: 2, day: 0, slot: 3 } })
      expect(hard).toEqual([{ rule: 'feeder-order', otherMatchId: 3 }])
    })

    it('does not block against a feeder still in the backlog (nothing to order against yet)', () => {
      const matches = [semi1, semi2, final] // semis unplaced
      const { hard } = validatePlacement(matches, { id: 3, placement: { court: 1, day: 0, slot: 0 } })
      expect(hard).toEqual([])
    })
  })

  describe('hard — court occupancy', () => {
    it('blocks a match dropped on a court+day+slot another match already holds', () => {
      const occupant = pm(10, 1, 0, { at: { court: 3, day: 0, slot: 1 } })
      const candidate = pm(99, 1, 1)
      const { hard } = validatePlacement([occupant, candidate], { id: 99, placement: { court: 3, day: 0, slot: 1 } })
      expect(hard).toEqual([{ rule: 'court-taken', otherMatchId: 10 }])
    })

    it('allows a match in a busy slot on a free court — up to the 6 courts, never a 7th', () => {
      // Five courts taken in day 0 slot 0; the candidate fills the sixth (court is schema-bounded to 1..6,
      // so a seventh would have to reuse a court and be blocked as court-taken).
      const fillers = Array.from({ length: 5 }, (_, i) => pm(10 + i, 1, i, { at: { court: i + 1, day: 0, slot: 0 } }))
      const candidate = pm(99, 1, 6)
      const { hard } = validatePlacement([...fillers, candidate], { id: 99, placement: { court: 6, day: 0, slot: 0 } })
      expect(hard).toEqual([])
    })
  })

  describe('soft — player load', () => {
    it('warns (does not block) on a player with more than 2 matches in a day', () => {
      // Player 101 already plays two day-0 matches; the candidate is their third.
      const a = pm(20, 1, 0, { p: [101, 201], at: { court: 1, day: 0, slot: 0 } })
      const b = pm(21, 1, 1, { p: [101, 202], at: { court: 1, day: 0, slot: 2 } })
      const candidate = pm(22, 1, 2, { p: [101, 203] })
      const { hard, soft } = validatePlacement([a, b, candidate], { id: 22, placement: { court: 1, day: 0, slot: 4 } })
      expect(hard).toEqual([])
      expect(soft).toContainEqual({ rule: 'player-load', regId: 101, count: 3 })
    })

    it('does not warn when a players two day-0 matches sit on different days', () => {
      const a = pm(20, 1, 0, { p: [101, 201], at: { court: 1, day: 0, slot: 0 } })
      const candidate = pm(21, 1, 1, { p: [101, 202] })
      // The candidate lands on day 1 — only its own appearance counts for that day.
      const { soft } = validatePlacement([a, candidate], { id: 21, placement: { court: 1, day: 1, slot: 0 } })
      expect(soft).toEqual([])
    })
  })

  describe('soft — back-to-back', () => {
    it('warns on a player playing adjacent same-day slots with no rest gap', () => {
      const earlier = pm(30, 1, 0, { p: [101, 201], at: { court: 1, day: 0, slot: 1 } })
      const candidate = pm(31, 1, 1, { p: [101, 202] })
      const { soft } = validatePlacement([earlier, candidate], { id: 31, placement: { court: 2, day: 0, slot: 2 } })
      expect(soft).toContainEqual({ rule: 'back-to-back', regId: 101, otherMatchId: 30 })
    })

    it('does not warn when the player has a slot of rest between matches', () => {
      const earlier = pm(30, 1, 0, { p: [101, 201], at: { court: 1, day: 0, slot: 0 } })
      const candidate = pm(31, 1, 1, { p: [101, 202] })
      const { soft } = validatePlacement([earlier, candidate], { id: 31, placement: { court: 2, day: 0, slot: 2 } })
      expect(soft).toEqual([])
    })
  })
})
