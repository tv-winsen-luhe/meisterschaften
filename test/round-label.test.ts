import { describe, expect, it } from 'vitest'
import { roundLabel } from '../shared/schedule'

// The shared round-label helper (#142): the single German round name both the admin grid card and the
// public schedule card render. Read from the end of the bracket (Finale, Halbfinale, …), so one list
// covers every draw size; the consolation bracket is prefixed, the third-place match is its own label.

describe('roundLabel', () => {
  it('names the main bracket rounds by the bracket depth (16-draw)', () => {
    // A 16-draw is four rounds deep: Achtelfinale → Viertelfinale → Halbfinale → Finale.
    const at = (round: number) => roundLabel({ bracket: 'main', round, totalRounds: 4 })
    expect(at(1)).toBe('Achtelfinale')
    expect(at(2)).toBe('Viertelfinale')
    expect(at(3)).toBe('Halbfinale')
    expect(at(4)).toBe('Finale')
  })

  it('names an 8-draw from the quarterfinals (three rounds deep)', () => {
    const at = (round: number) => roundLabel({ bracket: 'main', round, totalRounds: 3 })
    expect(at(1)).toBe('Viertelfinale')
    expect(at(2)).toBe('Halbfinale')
    expect(at(3)).toBe('Finale')
  })

  it('names a 4-draw from the semifinals (two rounds deep)', () => {
    const at = (round: number) => roundLabel({ bracket: 'main', round, totalRounds: 2 })
    expect(at(1)).toBe('Halbfinale')
    expect(at(2)).toBe('Finale')
  })

  it('prefixes the consolation bracket with „Nebenrunde · " so its final is not the real one', () => {
    expect(roundLabel({ bracket: 'consolation', round: 2, totalRounds: 2 })).toBe('Nebenrunde · Finale')
    expect(roundLabel({ bracket: 'consolation', round: 1, totalRounds: 2 })).toBe('Nebenrunde · Halbfinale')
  })

  it('labels the third-place match „Spiel um Platz 3", not a round', () => {
    // The third-place playoff carries its own label regardless of bracket/round.
    expect(roundLabel({ bracket: 'main', round: 2, totalRounds: 2, thirdPlace: true })).toBe('Spiel um Platz 3')
  })

  it('falls back to „Runde N" for a round deeper than the named list', () => {
    // A 32-draw's first round has no entry in the four-deep list — degrade rather than show undefined.
    expect(roundLabel({ bracket: 'main', round: 1, totalRounds: 5 })).toBe('Runde 1')
  })
})
