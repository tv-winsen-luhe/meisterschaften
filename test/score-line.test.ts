import { describe, expect, it } from 'vitest'
import { scoreLine } from '../shared'

// `scoreLine` (shared/score.ts) is the one score formatter — the leaf that turns a slot's games into the
// line every surface prints (#305). It replaced two inline joins that disagreed about their separator (the
// admin results list used two spaces, the public schedule one), so the assertion that matters most is that
// one string comes out for one score, whoever asks.
//
// It also owns the **column**: every entry is padded out to two characters with U+2007 FIGURE SPACE, a blank
// exactly a digit wide in the tabular figures all three surfaces set. This is the one file that spells that
// codepoint out, so the padding rule is pinned in exactly one place — the view tests read it through
// `score()` (test/score-text.ts) rather than repeating it. Without the padding, right alignment lined the
// *end* of the line up instead of the sets: a two-digit Match-Tie-Break on one line and a one-digit one on
// the other slid the whole shorter line a character along.
const FIGURE_SPACE = '\u2007'

describe('scoreLine', () => {
  it('writes a straight-sets score as the slot’s games, each in its own column', () => {
    const score = { set1: [6, 3] as [number, number], set2: [6, 4] as [number, number], mtb: null }
    expect(scoreLine(score, 1)).toBe(`6${FIGURE_SPACE} 6${FIGURE_SPACE}`)
    expect(scoreLine(score, 2)).toBe(`3${FIGURE_SPACE} 4${FIGURE_SPACE}`)
  })

  it('includes the Match-Tie-Break points at 1:1', () => {
    const score = {
      set1: [6, 4] as [number, number],
      set2: [3, 6] as [number, number],
      mtb: [10, 8] as [number, number]
    }
    expect(scoreLine(score, 1)).toBe(`6${FIGURE_SPACE} 3${FIGURE_SPACE} 10`)
    expect(scoreLine(score, 2)).toBe(`4${FIGURE_SPACE} 6${FIGURE_SPACE} 8${FIGURE_SPACE}`)
  })

  it('writes only the saved set of a match still in progress (ADR-0032 §20)', () => {
    const score = { set1: [6, 3] as [number, number], set2: null, mtb: null }
    expect(scoreLine(score, 1)).toBe(`6${FIGURE_SPACE}`)
    expect(scoreLine(score, 2)).toBe(`3${FIGURE_SPACE}`)
  })

  it('is empty when nothing is recorded — an unplayed match or a walkover carries no numbers', () => {
    expect(scoreLine({ set1: null, set2: null, mtb: null }, 1)).toBe('')
    expect(scoreLine({ set1: null, set2: null, mtb: null }, 2)).toBe('')
  })
})
