import { describe, expect, it } from 'vitest'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'

// The public participant list carries a provisional `seedRank` by LK (ADR-0047), so the pre-draw preview
// can place the LK-strongest on the seed lines — even for a Challenger field, which stays listed by
// registration date with its LK redacted. Seed rank is LK on every field; the cut/list order never decides it.
let nextId = 1
const reg = (overrides: Partial<RegistrationRow>): RegistrationRow => ({
  id: nextId++,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  competition: 'mens',
  firstName: 'Max',
  lastName: 'Muster',
  club: 'TV Winsen',
  email: 'max@example.com',
  phone: null,
  note: null,
  playerId: null,
  lk: null,
  status: 'confirmed',
  ip: null,
  ...overrides
})

describe('listConfirmed · provisional seedRank (ADR-0047)', () => {
  it('marks the LK-strongest as seeds even for a Challenger field listed by registration date', async () => {
    // The exact prod incident. Four Challenger entries in registration order; Steimmig registers last but
    // is strongest. The public list keeps registration order and the redacted LK, but the seedRank it
    // carries is by LK — so the preview seeds Steimmig (not the earliest registrants), without the LK value.
    const store = createInMemoryRegistrationsStore([
      reg({
        competition: 'mens-challenger',
        lk: '21.9',
        firstName: 'Kasigkeit',
        createdAt: '2026-06-24T11:44:00.000Z'
      }),
      reg({ competition: 'mens-challenger', lk: '24.7', firstName: 'Luehr', createdAt: '2026-06-24T13:05:00.000Z' }),
      reg({ competition: 'mens-challenger', lk: '24.5', firstName: 'Amtsberg', createdAt: '2026-06-24T13:59:00.000Z' }),
      reg({ competition: 'mens-challenger', lk: '21.5', firstName: 'Steimmig', createdAt: '2026-07-01T20:26:00.000Z' })
    ])

    const list = await store.listConfirmed()

    expect(list.map(p => p.firstName)).toEqual(['Kasigkeit', 'Luehr', 'Amtsberg', 'Steimmig']) // registration order
    expect(list.map(p => p.lk)).toEqual([null, null, null, null]) // Challenger LK never on the public wire
    const seedByName = new Map(list.map(p => [p.firstName, p.seedRank]))
    expect(seedByName.get('Steimmig')).toBe(1) // strongest LK → seed 1, though listed last
    expect(seedByName.get('Kasigkeit')).toBe(2)
    expect(seedByName.get('Luehr')).toBeNull() // weakest → not among the two seeds
    expect(seedByName.get('Amtsberg')).toBeNull()
  })

  it('numbers a championship field’s seeds in LK order, where list order and seed order coincide', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ competition: 'mens', lk: '11.0', firstName: 'S1' }),
      reg({ competition: 'mens', lk: '12.0', firstName: 'S2' }),
      reg({ competition: 'mens', lk: '13.0', firstName: 'U1' }),
      reg({ competition: 'mens', lk: '14.0', firstName: 'U2' })
    ])

    const list = await store.listConfirmed()
    expect(list.map(p => [p.firstName, p.seedRank])).toEqual([
      ['S1', 1],
      ['S2', 2],
      ['U1', null],
      ['U2', null]
    ])
  })

  it('gives no seed ranks below the draw floor (fewer than four in a field)', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ competition: 'mens', lk: '11.0', firstName: 'A' }),
      reg({ competition: 'mens', lk: '12.0', firstName: 'B' }),
      reg({ competition: 'mens', lk: '13.0', firstName: 'C' })
    ])

    const list = await store.listConfirmed()
    expect(list.every(p => p.seedRank === null)).toBe(true)
  })

  it('never marks seeds for an unseeded Social mixer, however many sign up (ADR-0051)', async () => {
    // Four confirmed — above the draw floor — so a seeded field would carry seeds; the mixer never does.
    const store = createInMemoryRegistrationsStore([
      reg({ competition: 'womens-social', firstName: 'A', createdAt: '2026-06-24T11:00:00.000Z' }),
      reg({ competition: 'womens-social', firstName: 'B', createdAt: '2026-06-24T12:00:00.000Z' }),
      reg({ competition: 'womens-social', firstName: 'C', createdAt: '2026-06-24T13:00:00.000Z' }),
      reg({ competition: 'womens-social', firstName: 'D', createdAt: '2026-06-24T14:00:00.000Z' })
    ])

    const list = await store.listConfirmed()
    expect(list.every(p => p.seedRank === null)).toBe(true)
  })
})
