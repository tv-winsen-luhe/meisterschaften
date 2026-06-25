import { describe, expect, it } from 'vitest'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations'
import type { RegistrationRow } from '../worker/db/schema'

let nextId = 1
function reg(overrides: Partial<RegistrationRow>): RegistrationRow {
  return {
    id: nextId++,
    createdAt: '2026-06-01T10:00:00.000Z',
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
  }
}

describe('in-memory registrations store · listConfirmed', () => {
  it('returns only confirmed entries, projected to the public contract shape', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ status: 'new', firstName: 'New' }),
      reg({ status: 'cancelled', firstName: 'Gone' }),
      reg({ status: 'hidden', firstName: 'Hidden' }),
      reg({ status: 'confirmed', firstName: 'Real', lk: '12.0' })
    ])

    const list = await store.listConfirmed()

    expect(list).toEqual([
      { firstName: 'Real', lastName: 'Muster', club: 'TV Winsen', competition: 'mens', lk: '12.0' }
    ])
  })

  it('orders by competition, then seeding LK (null = 25.0), then created_at', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ competition: 'womens', lk: '9.0', firstName: 'W' }),
      reg({ competition: 'mens', lk: null, firstName: 'MensNoLk' }),
      reg({ competition: 'mens', lk: '11.5', firstName: 'MensStrong' }),
      reg({ competition: 'mens-challenger', lk: '22.0', firstName: 'Chall' })
    ])

    const order = (await store.listConfirmed()).map(p => `${p.competition}:${p.firstName}`)

    expect(order).toEqual(['mens:MensStrong', 'mens:MensNoLk', 'mens-challenger:Chall', 'womens:W'])
  })
})
