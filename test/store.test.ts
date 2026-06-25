import { describe, expect, it } from 'vitest'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations'
import type { RegistrationRow } from '../worker/db/schema'

let nextId = 1
const reg = (overrides: Partial<RegistrationRow>): RegistrationRow => {
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

describe('in-memory registrations store · write + lookup ops', () => {
  it('insert persists a new row with an id and status "new"', async () => {
    const store = createInMemoryRegistrationsStore()
    const inserted = await store.insert({
      createdAt: '2026-06-01T10:00:00.000Z',
      competition: 'mens',
      firstName: 'Max',
      lastName: 'Muster',
      club: 'TV Winsen',
      email: 'max@example.com',
      phone: null,
      note: null,
      ip: '1.2.3.4'
    })
    expect(inserted.id).toBeGreaterThan(0)
    expect(inserted).toMatchObject({ status: 'new', playerId: null, lk: null })
    const found = await store.findActiveRegistration({
      email: 'max@example.com',
      lastName: 'Muster',
      competition: 'mens'
    })
    expect(found?.id).toBe(inserted.id)
  })

  it('findActive / findCancelled distinguish by status and match case-insensitively', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ status: 'cancelled', email: 'a@x.de', lastName: 'Alpha' }),
      reg({ status: 'new', email: 'b@x.de', lastName: 'Beta' })
    ])
    expect(
      await store.findCancelledRegistration({ email: 'A@X.DE', lastName: 'alpha', competition: 'mens' })
    ).not.toBeNull()
    expect(await store.findActiveRegistration({ email: 'A@X.DE', lastName: 'alpha', competition: 'mens' })).toBeNull()
    expect(
      await store.findActiveRegistration({ email: 'b@x.de', lastName: 'Beta', competition: 'mens' })
    ).not.toBeNull()
  })

  it('revive flips a cancelled row to new, refreshes contact fields, keeps the linkage', async () => {
    const cancelled = reg({
      status: 'cancelled',
      firstName: 'Old',
      club: 'TSV Winsen',
      playerId: '12345678',
      lk: '15.0'
    })
    const store = createInMemoryRegistrationsStore([cancelled])
    const revived = await store.revive(cancelled.id, {
      createdAt: '2026-06-03T08:00:00.000Z',
      firstName: 'New',
      lastName: 'Muster',
      club: 'TV Winsen',
      phone: null,
      note: null,
      ip: null
    })
    expect(revived).toMatchObject({
      status: 'new',
      firstName: 'New',
      club: 'TV Winsen',
      playerId: '12345678',
      lk: '15.0'
    })
  })

  it('setMatch links player id + LK on a single row', async () => {
    const r = reg({ status: 'new', playerId: null, lk: null })
    const store = createInMemoryRegistrationsStore([r])
    await store.setMatch(r.id, '12345678', '11.5')
    const found = await store.findActiveRegistration({
      email: r.email,
      lastName: r.lastName,
      competition: r.competition
    })
    expect(found).toMatchObject({ playerId: '12345678', lk: '11.5' })
  })

  it('countRecentByIp counts only this IP after the cutoff', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ ip: '1.1.1.1', createdAt: '2026-06-01T10:00:00.000Z' }),
      reg({ ip: '1.1.1.1', createdAt: '2026-06-01T11:00:00.000Z' }),
      reg({ ip: '1.1.1.1', createdAt: '2026-06-01T08:00:00.000Z' }),
      reg({ ip: '2.2.2.2', createdAt: '2026-06-01T11:00:00.000Z' })
    ])
    expect(await store.countRecentByIp('1.1.1.1', '2026-06-01T09:00:00.000Z')).toBe(2)
  })
})
