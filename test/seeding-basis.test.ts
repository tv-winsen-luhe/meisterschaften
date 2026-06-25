import { describe, expect, it } from 'vitest'
import { DEFAULT_LK, resolveSeedingBasis } from '../shared'

// resolveSeedingBasis derives the seeding-basis fields (player id / LK) from raw form input,
// owning the "no nuLiga ID ⇒ default LK 25.0" policy once (ADR-0011 amendment). Both the React
// admin (affordance) and the domain confirm (authority) shape their input through it; its output
// feeds straight into canConfirm. Empty strings normalise to null so absence is a real null.
describe('resolveSeedingBasis', () => {
  it.each([
    [
      { playerId: '12345678', lk: '' },
      { playerId: '12345678', lk: null }
    ],
    [
      { playerId: ' 12345678 ', lk: ' 15.0 ' },
      { playerId: '12345678', lk: '15.0' }
    ],
    [
      { playerId: '', lk: '25.0' },
      { playerId: null, lk: '25.0' }
    ],
    [
      { playerId: '', lk: '' },
      { playerId: null, lk: null }
    ],
    [
      { playerId: '   ', lk: '   ' },
      { playerId: null, lk: null }
    ]
  ])('without noId: %o → %o', (input, expected) => {
    expect(resolveSeedingBasis(input)).toEqual(expected)
  })

  it.each([
    // noId clears the player id and falls back to the default LK when none was typed.
    [
      { playerId: '12345678', lk: '', noId: true },
      { playerId: null, lk: DEFAULT_LK }
    ],
    [
      { playerId: '', lk: '', noId: true },
      { playerId: null, lk: DEFAULT_LK }
    ],
    // An explicit LK on the no-ID path is kept (the operator may seed off the default).
    [
      { playerId: '', lk: '26.0', noId: true },
      { playerId: null, lk: '26.0' }
    ],
    [
      { playerId: '12345678', lk: ' 26.0 ', noId: true },
      { playerId: null, lk: '26.0' }
    ]
  ])('with noId: %o → %o', (input, expected) => {
    expect(resolveSeedingBasis(input)).toEqual(expected)
  })
})
