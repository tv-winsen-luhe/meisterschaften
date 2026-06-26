import { beforeEach, describe, expect, it, vi } from 'vitest'

// notifyRegistration is transport I/O (Telegram); stub it so we can assert which LK the
// match→notify composition sends, without a Telegram round-trip.
vi.mock('../worker/notify', () => ({ notifyRegistration: vi.fn() }))

import type { Env } from '../worker/app'
import type { RegistrationRow } from '../worker/db/schema'
import { notifyRegistration } from '../worker/notify'
import { matchAndNotify } from '../worker/registration-effects'
import { createInMemoryRosterSource, createSeedingLk, type RosterSource } from '../worker/seeding-lk'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations'

const env = {} as Env // no Telegram creds; notifyRegistration is stubbed regardless

const reg = (overrides: Partial<RegistrationRow> = {}): RegistrationRow => ({
  id: 1,
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
  status: 'new',
  ip: null,
  ...overrides
})

const noticeArg = () => vi.mocked(notifyRegistration).mock.calls[0][1]

describe('matchAndNotify', () => {
  beforeEach(() => vi.mocked(notifyRegistration).mockClear())

  it('swallows a failing roster source and still notifies with the row’s stored LK', async () => {
    const failing: RosterSource = {
      async rosterFor() {
        throw new Error('nuLiga down')
      }
    }
    const row = reg({ lk: '12.0' })
    const seedingLk = createSeedingLk({ rosterSource: failing, store: createInMemoryRegistrationsStore([row]) })

    await expect(matchAndNotify(env, seedingLk, row)).resolves.toBeUndefined()
    expect(notifyRegistration).toHaveBeenCalledTimes(1)
    expect(noticeArg()).toMatchObject({ lk: '12.0' })
  })

  it('notifies with the freshly matched nuLiga LK and links the unmatched row', async () => {
    const row = reg({ playerId: null, lk: null })
    const store = createInMemoryRegistrationsStore([row])
    const roster = createInMemoryRosterSource({
      'TV Winsen': [{ playerId: '12345678', lk: '9.0', firstName: 'Max', lastName: 'Muster' }]
    })

    await matchAndNotify(env, createSeedingLk({ rosterSource: roster, store }), row)

    expect(noticeArg()).toMatchObject({ lk: '9.0' })
    expect((await store.findById(1))?.playerId).toBe('12345678')
  })
})
