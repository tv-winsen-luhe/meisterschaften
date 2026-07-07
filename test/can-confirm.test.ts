import { describe, expect, it } from 'vitest'
import { canConfirm, canConfirmEntry } from '../shared'

// canConfirm is the authoritative confirmation precondition (ADR-0011): the domain enforces
// it and the admin renders its reason from the same source. A row is confirmable once it has
// a seeding basis — a player id OR an explicit LK.
describe('canConfirm', () => {
  const reason = 'Zum Bestätigen bitte Spieler-ID eintragen oder „keine ID" (LK 25.0) setzen.'

  it.each([
    [{ playerId: '12345678', lk: null }, true],
    [{ playerId: null, lk: '25.0' }, true],
    [{ playerId: '12345678', lk: '15.0' }, true],
    [{ playerId: null, lk: null }, reason],
    [{ playerId: '', lk: '' }, reason],
    [{ playerId: '   ', lk: '  ' }, reason]
  ])('%o → %s', (reg, expected) => {
    expect(canConfirm(reg)).toBe(expected)
  })
})

// canConfirmEntry (ADR-0051) accounts for the field type: an unseeded field (Social mixer) needs no
// seeding basis and is always confirmable; a seeded field delegates to canConfirm.
describe('canConfirmEntry', () => {
  const noBasis = { playerId: null, lk: null }
  const withId = { playerId: '12345678', lk: null }

  it('is always confirmable for an unseeded Social mixer, even with no seeding basis', () => {
    expect(canConfirmEntry(noBasis, 'womens-social')).toBe(true)
    expect(canConfirmEntry(withId, 'womens-social')).toBe(true)
  })

  it('delegates to canConfirm for a seeded field', () => {
    expect(canConfirmEntry(withId, 'womens')).toBe(true)
    // A seeded field with no basis fails with canConfirm's own reason (one authority).
    expect(canConfirmEntry(noBasis, 'womens')).toBe(canConfirm(noBasis))
    expect(canConfirmEntry(noBasis, 'mens-challenger')).not.toBe(true)
  })
})
