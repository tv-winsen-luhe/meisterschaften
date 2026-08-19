import { describe, expect, it } from 'vitest'
import { scoreLine } from '../shared'

// `scoreLine` (shared/score.ts) is the one score formatter — the leaf that turns a slot's games into the
// line every surface prints (#305). It replaced two inline joins that disagreed about their separator (the
// admin results list used two spaces, the public schedule one), so the assertion that matters most is that
// one string comes out for one score, whoever asks.

describe('scoreLine', () => {
  it('writes a straight-sets score as the slot’s games, space-separated', () => {
    const score = { set1: [6, 3] as [number, number], set2: [6, 4] as [number, number], mtb: null }
    expect(scoreLine(score, 1)).toBe('6 6')
    expect(scoreLine(score, 2)).toBe('3 4')
  })

  it('includes the Match-Tie-Break points at 1:1', () => {
    const score = {
      set1: [6, 4] as [number, number],
      set2: [3, 6] as [number, number],
      mtb: [10, 8] as [number, number]
    }
    expect(scoreLine(score, 1)).toBe('6 3 10')
    expect(scoreLine(score, 2)).toBe('4 6 8')
  })

  it('writes only the saved set of a match still in progress (ADR-0032 §20)', () => {
    const score = { set1: [6, 3] as [number, number], set2: null, mtb: null }
    expect(scoreLine(score, 1)).toBe('6')
    expect(scoreLine(score, 2)).toBe('3')
  })

  it('is empty when nothing is recorded — an unplayed match or a walkover carries no numbers', () => {
    expect(scoreLine({ set1: null, set2: null, mtb: null }, 1)).toBe('')
    expect(scoreLine({ set1: null, set2: null, mtb: null }, 2)).toBe('')
  })
})
