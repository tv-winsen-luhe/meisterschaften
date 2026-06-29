import { describe, expect, it } from 'vitest'
import { absoluteSlot, suggestSchedule, validatePlacement } from '../shared/schedule'
import type { Placement, SchedulableMatch } from '../shared/schedule'

// The auto-suggest planner (suggestSchedule): a greedy, deterministic fill of unplaced matches into
// valid grid cells. It is finals-day-shaped (ADR-0040) — Saturday (day 0) carries everything through the
// quarterfinals plus the consolation bracket, Sunday (day 1, the finals day) carries the semifinals and
// final — respecting every hard constraint and preferring soft-warning-free cells.

interface MatchOpts {
  p?: [number | null, number | null]
  at?: Placement
  outcome?: string | null
  bracket?: string
}

const sm = (id: number, round: number, position: number, opts: MatchOpts = {}): SchedulableMatch => ({
  id,
  competition: 'mens',
  bracket: opts.bracket ?? 'main',
  round,
  position,
  slot1RegId: opts.p?.[0] ?? (round === 1 ? id * 10 : null),
  slot2RegId: opts.p?.[1] ?? (round === 1 ? id * 10 + 1 : null),
  outcome: opts.outcome ?? null,
  court: opts.at?.court ?? null,
  day: opts.at?.day ?? null,
  slot: opts.at?.slot ?? null
})

// An 8-draw: 4 quarterfinals (round 1) → 2 semifinals (round 2) → the final (round 3). The canonical
// fixture for the round→day assignment — quarterfinals are the deepest round that still belongs on
// Saturday, the semifinals/final the rounds reserved for Sunday.
const eightDraw = (): SchedulableMatch[] => [
  sm(1, 1, 0),
  sm(2, 1, 1),
  sm(3, 1, 2),
  sm(4, 1, 3),
  sm(5, 2, 0),
  sm(6, 2, 1),
  sm(7, 3, 0)
]

// Re-validate a whole suggested plan against itself — every cell must come back with no hard violation.
const noHardViolations = (matches: SchedulableMatch[], suggestions: { id: number; placement: Placement }[]) => {
  const working = matches.map(m => ({ ...m }))
  for (const s of suggestions) {
    const idx = working.findIndex(x => x.id === s.id)
    working[idx] = { ...working[idx], ...s.placement }
  }
  for (const s of suggestions) {
    const { hard } = validatePlacement(working, { id: s.id, placement: s.placement })
    expect(hard).toEqual([])
  }
}

describe('suggestSchedule', () => {
  it('packs Saturday through the quarterfinals and reserves Sunday for the semifinals + final', () => {
    const matches = eightDraw()
    const byId = new Map(suggestSchedule(matches).map(s => [s.id, s]))

    // Quarterfinals (round 1) → Saturday (day 0).
    for (const id of [1, 2, 3, 4]) expect(byId.get(id)!.placement.day).toBe(0)
    // Semifinals (round 2) + final (round 3) → Sunday (day 1, the finals day).
    for (const id of [5, 6, 7]) expect(byId.get(id)!.placement.day).toBe(1)
  })

  it('keeps the whole consolation bracket on Saturday — even its final', () => {
    // A 2-round consolation bracket: its round-2 match is the consolation final, which by round number
    // would look like a „final" — but the consolation carries no finals-day preference, so it stays on
    // Saturday and never reads as the real final on Sunday.
    const conso = [
      sm(1, 1, 0, { bracket: 'consolation' }),
      sm(2, 1, 1, { bracket: 'consolation' }),
      sm(3, 2, 0, { bracket: 'consolation' })
    ]
    for (const s of suggestSchedule(conso)) expect(s.placement.day).toBe(0)
  })

  it('produces a plan with zero hard violations', () => {
    const matches = eightDraw()
    noHardViolations(matches, suggestSchedule(matches))
  })

  it('places the final after its semifinals (round ordering holds across the day)', () => {
    const byId = new Map(suggestSchedule(eightDraw()).map(s => [s.id, s]))
    const sfAbs = Math.max(
      absoluteSlot(byId.get(5)!.placement.day, byId.get(5)!.placement.slot),
      absoluteSlot(byId.get(6)!.placement.day, byId.get(6)!.placement.slot)
    )
    const finalAbs = absoluteSlot(byId.get(7)!.placement.day, byId.get(7)!.placement.slot)
    expect(finalAbs).toBeGreaterThan(sfAbs)
  })

  it('prefers a warning-free cell over an earlier short-rest one (within the target day)', () => {
    // Player 101 already plays a quarterfinal at day 0, slot 0 (ends 10:30). A second quarterfinal for the
    // same player must avoid the under-60-minute rest gap: the planner scans slots ascending but prefers
    // the first warning-free cell, so it lands at slot 5 (11:30 — exactly 60 minutes' rest), not the
    // earlier slots 3/4 that would warn.
    const a = sm(1, 1, 0, { p: [101, 201], at: { court: 1, day: 0, slot: 0 } })
    const candidate = sm(2, 1, 1, { p: [101, 202] })
    // The round-2/3 fillers make round 1 a quarterfinal (so it targets Saturday, not Sunday).
    const matches = [a, candidate, sm(5, 2, 0), sm(6, 2, 1), sm(7, 3, 0)]

    const placed = suggestSchedule(matches).find(s => s.id === 2)!
    expect(placed.placement.day).toBe(0)
    expect(placed.placement.slot).toBe(5)
  })

  it('leaves already-placed matches untouched (fill-around)', () => {
    const placed = sm(1, 1, 0, { at: { court: 3, day: 0, slot: 2 } })
    const matches = [placed, ...eightDraw().filter(m => m.id !== 1)]
    const suggestions = suggestSchedule(matches)

    expect(suggestions.find(s => s.id === placed.id)).toBeUndefined()
    expect(suggestions).toHaveLength(6)
  })

  it('fills only still-unplaced matches on re-run (the "finish the rest" pattern)', () => {
    const matches = eightDraw()
    const first = suggestSchedule(matches)
    // Apply only the first suggestion, leaving the rest unplaced.
    const partial = matches.map(m => (m.id === first[0].id ? { ...m, ...first[0].placement } : m))
    const second = suggestSchedule(partial)
    expect(second.find(s => s.id === first[0].id)).toBeUndefined()
    expect(second).toHaveLength(first.length - 1)
  })

  it('is deterministic across runs', () => {
    const matches = eightDraw()
    expect(suggestSchedule(matches)).toEqual(suggestSchedule(matches))
  })

  it('skips bye matches (they are never scheduled)', () => {
    const matches = [sm(1, 1, 0, { outcome: 'bye' }), sm(2, 1, 1), sm(3, 2, 0)]
    expect(suggestSchedule(matches).find(s => s.id === 1)).toBeUndefined()
  })
})
