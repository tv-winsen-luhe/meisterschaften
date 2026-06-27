import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import type { RegistrationRow } from '../worker/db/schema'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import { createTestDeps } from './test-deps'

// Proof of life for the composition root (ADR-0030): a route driven through `createApp(() => deps)`
// over the in-memory adapters — no D1, no cloudflare:test pool. This is the pattern the logic-heavy
// route tests can migrate onto; the D1 integration tests stay for what fakes cannot prove (real SQL,
// migrations, COLLATE NOCASE, param chunking).

const newRow = (overrides: Partial<RegistrationRow> = {}): RegistrationRow => ({
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

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

describe('composition root · HTTP seam over in-memory deps (ADR-0030)', () => {
  it('runs the real registration domain on confirm, no D1', async () => {
    const store = createInMemoryRegistrationsStore([newRow()])
    const app = createApp(() => createTestDeps({ registrationsStore: store }))

    const res = await app.request(
      '/api/admin/confirm',
      postJson({ id: 1, competition: 'mens', club: 'TV Winsen', playerId: '', noId: true })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, lkFetched: null })
    // The actual domain transition ran over the fake store: the row is confirmed and seeded at the
    // no-id default LK (ADR-0020), and resolveLkOnConfirm reported nothing to fetch.
    expect(await store.findById(1)).toMatchObject({ status: 'confirmed', lk: '25.0' })
  })

  it('serves the participant list from injected deps when the kill-switch is on', async () => {
    const app = createApp(() =>
      createTestDeps({ registrationsStore: createInMemoryRegistrationsStore([newRow({ status: 'confirmed' })]) })
    )

    const res = await app.request('/api/participants', {}, { PUBLIC_LIST_ENABLED: 'true' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { enabled: boolean; participants: unknown[] }
    expect(body.enabled).toBe(true)
    expect(body.participants).toHaveLength(1)
  })
})
