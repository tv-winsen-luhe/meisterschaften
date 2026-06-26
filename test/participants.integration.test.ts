import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../worker/app'

// Thin integration smoke over a real local D1: proves the wiring (Hono → Zod → Store →
// Drizzle → D1), not logic. The Store ordering itself is covered in store.test.ts.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

const seed = async () => {
  const insert = (
    competition: string,
    firstName: string,
    club: string,
    lk: string | null,
    status: string,
    createdAt: string
  ) =>
    env.DB.prepare(
      `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, lk, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(createdAt, competition, firstName, 'Muster', club, `${firstName}@example.com`, lk, status)

  await env.DB.batch([
    insert('mens', 'MensStrong', 'TV Winsen', '11.5', 'confirmed', '2026-06-01T10:00:00.000Z'),
    insert('mens', 'MensNoLk', 'TSV Winsen', null, 'confirmed', '2026-06-01T11:00:00.000Z'),
    insert('womens', 'Wilma', 'TV Winsen', '9.0', 'confirmed', '2026-06-01T12:00:00.000Z'),
    insert('mens', 'Pending', 'TV Winsen', '8.0', 'new', '2026-06-01T13:00:00.000Z'),
    insert('mens', 'Gone', 'TV Winsen', '7.0', 'cancelled', '2026-06-01T14:00:00.000Z')
  ])
}

describe('GET /api/participants (integration)', () => {
  it('serves confirmed entries in camelCase, in seeding order', async () => {
    await seed()

    const res = await app.request('/api/participants', {}, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { enabled: boolean; participants: unknown[] }
    expect(body.enabled).toBe(true)
    // Confirmed only (Pending/Gone excluded), ordered by competition then LK (null = 25.0).
    expect(body.participants).toEqual([
      { firstName: 'MensStrong', lastName: 'Muster', club: 'TV Winsen', competition: 'mens', lk: '11.5' },
      { firstName: 'MensNoLk', lastName: 'Muster', club: 'TSV Winsen', competition: 'mens', lk: null },
      { firstName: 'Wilma', lastName: 'Muster', club: 'TV Winsen', competition: 'womens', lk: '9.0' }
    ])
  })

  it('honours the PUBLIC_LIST_ENABLED kill-switch', async () => {
    const res = await app.request('/api/participants', {}, { DB: env.DB, PUBLIC_LIST_ENABLED: 'false' })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ enabled: false, participants: [] })
  })

  it('fails with the JSON error envelope (not a plain-text 500) when a row breaks the contract', async () => {
    await env.DB.prepare(
      `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status)
       VALUES (?, 'not-a-konkurrenz', 'Bad', 'Row', 'TV Winsen', 'bad@example.com', 'confirmed')`
    )
      .bind('2026-06-01T10:00:00.000Z')
      .run()

    const res = await app.request('/api/participants', {}, env)
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Serverfehler. Bitte später erneut versuchen.')
  })
})
