import { describe, expect, it } from 'vitest'
import { DEFAULT_LK, resolveSeedingBasis, seedingValue } from '../shared'

// resolveSeedingBasis derives the seeding-basis fields (player id / LK) from the only seeding
// input the operator gives: whether the entry is linked to a nuLiga player id, or explicitly has
// none ("keine nuLiga-ID"). The LK is never typed — it is derived (ADR-0020): a linked player's
// LK is fetched from nuLiga at confirm time (so it resolves to null here, to be filled by the
// edge), and any entry with no resolvable rating defaults to DEFAULT_LK (25.0). Both the React
// admin (affordance) and the domain confirm (authority) shape their input through it; its output
// feeds straight into canConfirm.
describe('resolveSeedingBasis', () => {
  it.each([
    // A linked player id: kept (trimmed); the LK is left null, fetched from nuLiga by the edge.
    [{ playerId: '12345678' }, { playerId: '12345678', lk: null }],
    [{ playerId: ' 12345678 ' }, { playerId: '12345678', lk: null }],
    // No id and no explicit "keine ID" choice → no basis yet (canConfirm rejects this).
    [{ playerId: '' }, { playerId: null, lk: null }],
    [{ playerId: '   ' }, { playerId: null, lk: null }]
  ])('without noId: %o → %o', (input, expected) => {
    expect(resolveSeedingBasis(input)).toEqual(expected)
  })

  it.each([
    // "keine nuLiga-ID": the player id is cleared and the LK is the default — never operator-typed.
    [
      { playerId: '', noId: true },
      { playerId: null, lk: DEFAULT_LK }
    ],
    // noId wins even if an id was left in the field — the explicit choice is "no link".
    [
      { playerId: '12345678', noId: true },
      { playerId: null, lk: DEFAULT_LK }
    ]
  ])('with noId: %o → %o', (input, expected) => {
    expect(resolveSeedingBasis(input)).toEqual(expected)
  })
})

// seedingValue turns a row's LK string into the number it is seeded by (ascending → strongest
// first, since the scale runs 1.0 strongest … 25.0 weakest). It owns the "no resolvable rating ⇒
// DEFAULT_LK" rule once, so the participant list and the future Setzung share one encoding instead
// of the SQL-vs-JS pair this replaced. Missing OR unratable both seed as the weakest (25.0) — never
// 0, which the old SQL CAST produced and which would have seeded junk as stronger than any player.
describe('seedingValue', () => {
  it.each([
    ['1.0', 1],
    ['12.5', 12.5],
    ['25.0', 25],
    // No LK on the row → the default (treated as weakest).
    [null, 25],
    // Unratable strings resolve to the default too (glossary: no resolvable rating ⇒ defaultLk),
    // not to 0. Unreachable in practice (LK is server-authored, ADR-0020) but stated coherently.
    ['', 25],
    ['abc', 25]
  ])('%o → %d', (lk, expected) => {
    expect(seedingValue(lk)).toBe(expected)
  })

  it('parses the dot-decimal DEFAULT_LK to the same number', () => {
    expect(seedingValue(null)).toBe(Number(DEFAULT_LK))
  })
})
