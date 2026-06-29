import { describe, expect, it } from 'vitest'
import { suggestSchedule, validatePlacement } from '../shared/schedule'
import type { Placement, SchedulableMatch } from '../shared/schedule'

// The auto-suggest planner (suggestSchedule): a greedy, deterministic fill of unplaced matches into
// valid grid cells, respecting hard constraints and preferring soft-warning-free placements.

interface MatchOpts {
  p?: [number | null, number | null]
  at?: Placement
  outcome?: string | null
}

const sm = (id: number, round: number, position: number, opts: MatchOpts = {}): SchedulableMatch => ({
  id,
  competition: 'mens',
  bracket: 'main',
  round,
  position,
  slot1RegId: opts.p?.[0] ?? (round === 1 ? id * 10 : null),
  slot2RegId: opts.p?.[1] ?? (round === 1 ? id * 10 + 1 : null),
  outcome: opts.outcome ?? null,
  court: opts.at?.court ?? null,
  day: opts.at?.day ?? null,
  slot: opts.at?.slot ?? null
})

describe('suggestSchedule', () => {
  it('fills a full unplaced 4-draw with zero hard violations', () => {
    const matches = [sm(1, 1, 0), sm(2, 1, 1), sm(3, 2, 0)]
    const suggestions = suggestSchedule(matches)

    expect(suggestions).toHaveLength(3)
    // Every suggestion must pass validation with no hard violations.
    const working = matches.map(m => ({ ...m }))
    for (const s of suggestions) {
      const idx = working.findIndex(x => x.id === s.id)
      working[idx] = { ...working[idx], ...s.placement }
    }
    for (const s of suggestions) {
      const { hard } = validatePlacement(working, { id: s.id, placement: s.placement })
      expect(hard).toEqual([])
    }
  })

  it('preserves already-placed matches (fill-around)', () => {
    const placed = sm(1, 1, 0, { at: { court: 3, day: 0, slot: 2 } })
    const matches = [placed, sm(2, 1, 1), sm(3, 2, 0)]
    const suggestions = suggestSchedule(matches)

    // The already-placed match is not in the suggestions.
    expect(suggestions.find(s => s.id === placed.id)).toBeUndefined()
    // The other two are filled.
    expect(suggestions).toHaveLength(2)
  })

  it('packs round 1 from the first slot (day 0 slot 0)', () => {
    const matches = [sm(1, 1, 0), sm(2, 1, 1), sm(3, 2, 0)]
    const suggestions = suggestSchedule(matches)

    // Round-1 matches should land in the first slot (day 0, slot 0).
    const r1 = suggestions.filter(s => matches.find(m => m.id === s.id)!.round === 1)
    for (const s of r1) {
      expect(s.placement.day).toBe(0)
      expect(s.placement.slot).toBe(0)
    }
  })

  it('places later rounds after their feeders (round ordering)', () => {
    const matches = [sm(1, 1, 0), sm(2, 1, 1), sm(3, 2, 0)]
    const suggestions = suggestSchedule(matches)

    const byId = new Map(suggestions.map(s => [s.id, s]))
    const r1Slot = byId.get(1)!.placement
    const finalSlot = byId.get(3)!.placement
    const r1Abs = r1Slot.day * 6 + r1Slot.slot
    const finalAbs = finalSlot.day * 6 + finalSlot.slot
    expect(finalAbs).toBeGreaterThan(r1Abs)
  })

  it('avoids soft warnings on a forced choice', () => {
    // Player 101 already has two matches on day 0 (at different slots). A third on the same day
    // would trigger player-load. The planner should prefer day 1.
    const a = sm(10, 1, 0, { p: [101, 201], at: { court: 1, day: 0, slot: 0 } })
    const b = sm(11, 1, 1, { p: [101, 202], at: { court: 2, day: 0, slot: 2 } })
    const candidate = sm(12, 1, 2, { p: [101, 203] })
    const matches = [a, b, candidate]
    const suggestions = suggestSchedule(matches)

    const placed = suggestions.find(s => s.id === 12)!
    // The planner should avoid day 0 to skip the player-load warning.
    expect(placed.placement.day).toBe(1)
  })

  it('is deterministic across runs', () => {
    const matches = [sm(1, 1, 0), sm(2, 1, 1), sm(3, 1, 2), sm(4, 1, 3), sm(5, 2, 0), sm(6, 2, 1), sm(7, 3, 0)]
    const run1 = suggestSchedule(matches)
    const run2 = suggestSchedule(matches)
    expect(run1).toEqual(run2)
  })

  it('fills only still-unplaced matches on re-run (the "finish the rest" pattern)', () => {
    const matches = [sm(1, 1, 0), sm(2, 1, 1), sm(3, 2, 0)]
    const first = suggestSchedule(matches)
    // Apply only the first suggestion, leaving the rest unplaced.
    const partial = matches.map(m => (m.id === first[0].id ? { ...m, ...first[0].placement } : m))
    const second = suggestSchedule(partial)
    // Should not re-suggest the already-placed match.
    expect(second.find(s => s.id === first[0].id)).toBeUndefined()
    expect(second).toHaveLength(2)
  })

  it('skips bye matches (they are never scheduled)', () => {
    const matches = [sm(1, 1, 0, { outcome: 'bye' }), sm(2, 1, 1), sm(3, 2, 0)]
    const suggestions = suggestSchedule(matches)
    expect(suggestions.find(s => s.id === 1)).toBeUndefined()
  })
})
