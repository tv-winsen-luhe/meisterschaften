import { describe, expect, it } from 'vitest'
import type { MatchScore } from '../shared'
import { changedSets, offersPartialSave } from '../src/admin/surfaces/result-save'

// The result drawer's second save path (ADR-0032, Amendment 2026-08-20): the Zwischenstand. The drawer's
// Save used to be a dead disabled button whenever the score was legal but not yet decisive („der Sieger
// steht noch nicht fest"); in that exact state it becomes „Zwischenstand speichern" and posts each changed
// set to /api/admin/match/set. This file pins the two rules that decide it — *when* the path is offered,
// and *what* it writes.

const score = (over: Partial<MatchScore> = {}): MatchScore => ({ set1: null, set2: null, mtb: null, ...over })

describe('offersPartialSave · the drawer offers the Zwischenstand exactly in the undecided state', () => {
  it('offers it for a running match with one set standing', () => {
    // The first Zwischenstand: one set is over, the second is on court. Nothing decides the match yet.
    expect(offersPartialSave('running', null, score({ set1: [6, 3] }))).toBe(true)
  })

  it('offers it at 1:1 while the Match-Tie-Break is running', () => {
    // The only other Zwischenstand there is — a decisive score ends the match.
    expect(offersPartialSave('running', null, score({ set1: [6, 3], set2: [4, 6] }))).toBe(true)
  })

  it('offers it for an empty score, so the operator can clear a mistyped set', () => {
    // Emptying the fields and saving is how a set is corrected; the writes list decides whether that save
    // has anything to do.
    expect(offersPartialSave('running', null, score())).toBe(true)
  })

  it('does not offer it once the score decides the match — that is a result', () => {
    expect(offersPartialSave('running', null, score({ set1: [6, 3], set2: [6, 4] }))).toBe(false)
    expect(offersPartialSave('running', null, score({ set1: [6, 3], set2: [4, 6], mtb: [10, 8] }))).toBe(false)
  })

  it('does not offer it for an illegal set — the flagged row blocks both paths', () => {
    // `3:2` is not a coarse reading of a running set; a saved set is a completed set (ADR-0045).
    expect(offersPartialSave('running', null, score({ set1: [3, 2] }))).toBe(false)
  })

  it('does not offer it for a planned or finished match', () => {
    // A planned match is started with „Läuft" first (that transition carries the actual court, which only
    // the operator knows); a finished one is corrected through /result.
    expect(offersPartialSave('planned', null, score({ set1: [6, 3] }))).toBe(false)
    expect(offersPartialSave('done', null, score({ set1: [6, 3] }))).toBe(false)
  })

  it('does not offer it for a Walkover or an Aufgabe — those are endings, not interim states', () => {
    expect(offersPartialSave('running', 'walkover', score())).toBe(false)
    expect(offersPartialSave('running', 'retirement', score({ set1: [6, 3] }))).toBe(false)
  })
})

describe('changedSets · only what changed is posted', () => {
  it('posts nothing when the entered score matches what is recorded', () => {
    expect(changedSets(score({ set1: [6, 3] }), score({ set1: [6, 3] }), false)).toEqual([])
  })

  it('posts the one set that was typed', () => {
    expect(changedSets(score(), score({ set1: [6, 3] }), false)).toEqual([{ set: 1, score: [6, 3] }])
  })

  it('leaves an untouched set alone when the next one is typed', () => {
    // One request per changed set, at most three; an untouched set costs no request (ADR-0021).
    expect(changedSets(score({ set1: [6, 3] }), score({ set1: [6, 3], set2: [4, 6] }), true)).toEqual([
      { set: 2, score: [4, 6] }
    ])
  })

  it('writes null when a set is emptied — clearing is how a mistyped set is corrected', () => {
    expect(changedSets(score({ set1: [6, 3] }), score(), false)).toEqual([{ set: 1, score: null }])
  })

  it('posts the Match-Tie-Break as set 3', () => {
    const recorded = score({ set1: [6, 3], set2: [4, 6] })
    expect(changedSets(recorded, { ...recorded, mtb: [10, 8] }, true)).toEqual([{ set: 3, score: [10, 8] }])
  })

  it('posts every changed set in set order, three at most', () => {
    expect(changedSets(score({ set1: [6, 4] }), score({ set1: [6, 3], set2: [4, 6], mtb: [10, 8] }), true)).toEqual([
      { set: 1, score: [6, 3] },
      { set: 2, score: [4, 6] },
      { set: 3, score: [10, 8] }
    ])
  })

  it('leaves a recorded Match-Tie-Break alone while its row is hidden', () => {
    // Clearing set 2 to retype a digit hides the MTB row, which makes the entered MTB read as empty. A set
    // the operator cannot see is a set they did not change — without this the retype would wipe the MTB too.
    const recorded = score({ set1: [6, 3], set2: [4, 6], mtb: [10, 8] })
    expect(changedSets(recorded, score({ set1: [6, 3] }), false)).toEqual([{ set: 2, score: null }])
  })

  it('sees a corrected digit in an already-recorded set', () => {
    expect(changedSets(score({ set1: [6, 3] }), score({ set1: [6, 2] }), false)).toEqual([{ set: 1, score: [6, 2] }])
  })
})
