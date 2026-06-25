import { describe, expect, it } from 'vitest'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations'
import { createRegistrationDomain, isTooStrongForChallenger, type RegisterInput } from '../worker/domain/registration'
import type { RegistrationRow } from '../worker/db/schema'

let nextId = 1
const reg = (overrides: Partial<RegistrationRow>): RegistrationRow => ({
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
})

const input = (overrides: Partial<RegisterInput> = {}): RegisterInput => ({
  competition: 'mens',
  firstName: 'Max',
  lastName: 'Muster',
  club: 'TV Winsen',
  email: 'max@example.com',
  phone: '',
  note: '',
  ip: '1.2.3.4',
  now: '2026-06-02T09:00:00.000Z',
  ...overrides
})

describe('registration domain · register', () => {
  it('inserts a new registration when the person has no entry for the Konkurrenz', async () => {
    const store = createInMemoryRegistrationsStore()
    const result = await createRegistrationDomain(store).register(input({ phone: '0151', note: 'hi' }))

    expect(result).toMatchObject({ ok: true, outcome: 'registered' })
    if (!result.ok) throw new Error('expected ok')
    expect(result.registration).toMatchObject({
      competition: 'mens',
      firstName: 'Max',
      lastName: 'Muster',
      email: 'max@example.com',
      status: 'new',
      phone: '0151',
      note: 'hi',
      ip: '1.2.3.4',
      createdAt: '2026-06-02T09:00:00.000Z'
    })
    // Persisted and now the active entry for the person.
    const active = await store.findActiveRegistration({
      email: 'max@example.com',
      lastName: 'Muster',
      competition: 'mens'
    })
    expect(active?.id).toBe(result.registration.id)
  })

  it('stores empty optional fields as null', async () => {
    const store = createInMemoryRegistrationsStore()
    const result = await createRegistrationDomain(store).register(input())
    if (!result.ok) throw new Error('expected ok')
    expect(result.registration.phone).toBeNull()
    expect(result.registration.note).toBeNull()
  })

  it('revives a previously cancelled entry instead of inserting a duplicate', async () => {
    const cancelled = reg({
      status: 'cancelled',
      firstName: 'OldFirst',
      club: 'TSV Winsen',
      playerId: '12345678',
      lk: '15.0'
    })
    const store = createInMemoryRegistrationsStore([cancelled])

    const result = await createRegistrationDomain(store).register(
      input({ firstName: 'NewFirst', club: 'TV Winsen', now: '2026-06-03T08:00:00.000Z' })
    )

    expect(result).toMatchObject({ ok: true, outcome: 'revived' })
    if (!result.ok) throw new Error('expected ok')
    // Same row, revived back to 'new', contact fields refreshed…
    expect(result.registration.id).toBe(cancelled.id)
    expect(result.registration).toMatchObject({
      status: 'new',
      firstName: 'NewFirst',
      club: 'TV Winsen',
      createdAt: '2026-06-03T08:00:00.000Z'
    })
    // …but the nuLiga linkage is preserved.
    expect(result.registration.playerId).toBe('12345678')
    expect(result.registration.lk).toBe('15.0')
  })

  it('rejects a second active sign-up for the same person+Konkurrenz (one-active-entry invariant)', async () => {
    const store = createInMemoryRegistrationsStore([reg({ status: 'new' })])
    const result = await createRegistrationDomain(store).register(input())
    expect(result).toEqual({ ok: false, error: 'AlreadyRegistered' })
  })

  it('treats a confirmed entry as active too', async () => {
    const store = createInMemoryRegistrationsStore([reg({ status: 'confirmed' })])
    const result = await createRegistrationDomain(store).register(input())
    expect(result).toEqual({ ok: false, error: 'AlreadyRegistered' })
  })

  it('allows the same person to enter a different Konkurrenz', async () => {
    const store = createInMemoryRegistrationsStore([reg({ status: 'new', competition: 'mens' })])
    const result = await createRegistrationDomain(store).register(input({ competition: 'womens' }))
    expect(result).toMatchObject({ ok: true, outcome: 'registered' })
  })

  it('matches the person case-insensitively on email and last name', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ status: 'cancelled', email: 'MAX@example.com', lastName: 'MUSTER' })
    ])
    const result = await createRegistrationDomain(store).register(
      input({ email: 'max@example.com', lastName: 'muster' })
    )
    expect(result).toMatchObject({ ok: true, outcome: 'revived' })
  })
})

describe('registration domain · cancel', () => {
  it('withdraws every active entry for the person across Konkurrenzen and returns them', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ status: 'new', competition: 'mens' }),
      reg({ status: 'confirmed', competition: 'womens' }),
      reg({ status: 'cancelled', competition: 'mens-challenger' })
    ])

    const result = await createRegistrationDomain(store).cancel({ email: 'max@example.com', lastName: 'Muster' })

    // Both active entries withdrawn; the already-cancelled one is left untouched.
    expect(result.cancelled.map(r => r.competition).sort()).toEqual(['mens', 'womens'])
    expect(result.cancelled.every(r => r.status === 'cancelled')).toBe(true)
    expect(
      await store.findActiveRegistration({ email: 'max@example.com', lastName: 'Muster', competition: 'mens' })
    ).toBeNull()
  })

  it('returns an empty list when nothing matches', async () => {
    const store = createInMemoryRegistrationsStore([reg({ status: 'new', email: 'other@example.com' })])
    const result = await createRegistrationDomain(store).cancel({ email: 'max@example.com', lastName: 'Muster' })
    expect(result.cancelled).toEqual([])
  })

  it('matches the person case-insensitively on email and last name', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ status: 'confirmed', email: 'MAX@example.com', lastName: 'MUSTER' })
    ])
    const result = await createRegistrationDomain(store).cancel({ email: 'max@example.com', lastName: 'muster' })
    expect(result.cancelled).toHaveLength(1)
  })

  it('does not touch a row that is already cancelled', async () => {
    const store = createInMemoryRegistrationsStore([reg({ status: 'cancelled' })])
    const result = await createRegistrationDomain(store).cancel({ email: 'max@example.com', lastName: 'Muster' })
    expect(result.cancelled).toEqual([])
  })
})

describe('isTooStrongForChallenger', () => {
  it.each([
    ['mens-challenger', '19.5', true],
    ['mens-challenger', '20.0', false],
    ['mens-challenger', '20', false],
    ['mens-challenger', null, false],
    ['mens-challenger', 'kaputt', false],
    ['mens', '5.0', false],
    ['womens', '3.0', false]
  ])('(%s, %s) → %s', (competition, lk, expected) => {
    expect(isTooStrongForChallenger(competition, lk)).toBe(expected)
  })
})
