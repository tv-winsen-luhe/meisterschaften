import { describe, expect, it } from 'vitest'
import { DEFAULT_LK, resolveSeedingBasis } from '../shared'

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
