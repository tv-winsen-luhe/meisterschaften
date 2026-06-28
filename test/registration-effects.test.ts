import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../worker/app'
import type { RegistrationRow } from '../worker/db/schema'
import { buildRegistrationNotice, matchAndNotify } from '../worker/registration-effects'
import { createInMemoryRosterSource, createSeedingLk, type RosterSource } from '../worker/seeding-lk'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'

// buildRegistrationNotice owns the match→notice composition: which LK ends up on the notice (the
// freshly matched one, or the row's stored LK if nuLiga is unreachable). It returns the notice as
// data, so the choice is asserted on the return value — no vi.mock of the transport module.

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

describe('buildRegistrationNotice', () => {
  it('swallows a failing roster source and keeps the row’s stored LK on the notice', async () => {
    const failing: RosterSource = {
      async rosterFor() {
        throw new Error('nuLiga down')
      }
    }
    const row = reg({ lk: '12.0' })
    const seedingLk = createSeedingLk({ rosterSource: failing, store: createInMemoryRegistrationsStore([row]) })

    const notice = await buildRegistrationNotice(seedingLk, row)
    expect(notice).toMatchObject({ lk: '12.0' })
  })

  it('puts the freshly matched nuLiga LK on the notice and links the unmatched row', async () => {
    const row = reg({ playerId: null, lk: null })
    const store = createInMemoryRegistrationsStore([row])
    const roster = createInMemoryRosterSource({
      'TV Winsen': [{ playerId: '12345678', lk: '9.0', firstName: 'Max', lastName: 'Muster' }]
    })

    const notice = await buildRegistrationNotice(createSeedingLk({ rosterSource: roster, store }), row)

    expect(notice).toMatchObject({ lk: '9.0' })
    expect((await store.findById(1))?.playerId).toBe('12345678')
  })
})

// matchAndNotify is the glue actually wired into ctx.waitUntil (app.ts). It is verified end-to-end
// via a global-fetch spy (the established pattern in phase.integration.test.ts), not a module mock —
// proving a Telegram request is dispatched and that the matched LK reaches the message body.
describe('matchAndNotify', () => {
  afterEach(() => vi.unstubAllGlobals())

  const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' } as Env

  it('dispatches one Telegram message carrying the freshly matched LK', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const row = reg({ playerId: null, lk: null })
    const store = createInMemoryRegistrationsStore([row])
    const roster = createInMemoryRosterSource({
      'TV Winsen': [{ playerId: '12345678', lk: '9.0', firstName: 'Max', lastName: 'Muster' }]
    })

    await expect(matchAndNotify(env, createSeedingLk({ rosterSource: roster, store }), row)).resolves.toBeUndefined()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.text).toContain('🎾 <b>Neue Anmeldung</b>')
    expect(body.text).toContain('<b>LK (nuLiga):</b> 9.0')
  })
})
