import { describe, expect, it } from 'vitest'
import { COURT_NUMBERS, courtStoppedHint, NOT_SUSPENDED, suspendedCourts } from '../shared'

// The Ergebnisse row's soft hint (ADR-0078 Amendment 2 rule 5). Setting a match to „läuft" on a court the
// operator has marked as stopped is neither impossible nor obviously unwise — the court may simply have
// dried without anybody saying so — so under ADR-0033 it warns and never blocks. Nothing here writes: the
// hint's whole job is to put the contradiction in front of the only person who can resolve it, and to let
// them resolve it either way. Auto-releasing the court on the start is the tempting version, and it fails
// exactly the way rule 7 rejects auto-lifting the suspension — it would announce, positively and silently,
// that play has resumed there.
//
// The helper answers „is this court stopped"; *when to ask it* belongs to the row, which asks only while the
// match is still `geplant`. A match already `läuft` on a stopped court is no contradiction — it is the normal
// shape of a rain delay (ADR-0078 rule 3), and during a total suspension every running row would repeat it.
describe('courtStoppedHint · starting on a stopped court warns, never blocks', () => {
  it('names the court the match would start on', () => {
    expect(courtStoppedHint(4, [4, 5])).toBe('Platz 4 ist als unterbrochen markiert')
  })

  it('says nothing when the court is not among the stopped ones', () => {
    expect(courtStoppedHint(3, [4, 5])).toBe(null)
  })

  it('says nothing when no suspension stands', () => {
    expect(courtStoppedHint(4, suspendedCourts(NOT_SUSPENDED, 0))).toBe(null)
  })

  it('speaks for every court of a total suspension — all six is the total one', () => {
    const stopped = suspendedCourts({ suspended: true, resumesAt: null, courts: [...COURT_NUMBERS] }, 0)
    for (const court of COURT_NUMBERS) {
      expect(courtStoppedHint(court, stopped)).toBe(`Platz ${court} ist als unterbrochen markiert`)
    }
  })

  it('speaks for the actual court, not the reservation — the row hands it the court it is about to write', () => {
    // The row's select holds `pick ?? liveCourt ?? court`: a match reserved on 3 that the operator has just
    // moved to 4 starts on 4, so it is court 4's state the hint reads.
    expect(courtStoppedHint(4, [4])).toBe('Platz 4 ist als unterbrochen markiert')
    expect(courtStoppedHint(3, [4])).toBe(null)
  })
})
