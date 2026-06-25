import { describe, expect, it } from 'vitest'
import { canConfirm } from '../shared'

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
