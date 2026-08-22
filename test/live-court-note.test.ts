import { describe, expect, it } from 'vitest'
import { liveCourtNote } from '../shared'

// The Spielplan card's divergence reading (ADR-0079 rule 3). The card stays parked on its reservation —
// that is what its cell position means — so the only thing left for it to say is where the match actually
// is, and only while that differs from the reservation. The Ergebnisse row's fuller reading („Platz 3
// (geplant 5)", results-grouping.ts) answers a different question on a surface that has room for it; this
// one is a token pinned to a card whose geometry already states the planned court.
describe('liveCourtNote · the grid card reads the divergence', () => {
  it('names the actual court when the match has left its reservation', () => {
    expect(liveCourtNote({ court: 4, liveCourt: 5 })).toBe('→ Platz 5')
  })

  it('says nothing while the two courts agree', () => {
    expect(liveCourtNote({ court: 4, liveCourt: 4 })).toBe(null)
  })

  it('says nothing before the match starts — an unstarted match is on no court', () => {
    expect(liveCourtNote({ court: 4, liveCourt: null })).toBe(null)
  })

  it('says nothing for an unplaced match, which has no reservation to diverge from', () => {
    // Reachable: a running match can be cleared back to the backlog. There is no divergence to state when
    // there is nothing to diverge *from*, and „→ Platz 5" on a backlog chip would read as a placement.
    expect(liveCourtNote({ court: null, liveCourt: 5 })).toBe(null)
  })
})
