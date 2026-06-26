import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'

// Thin integration smoke over a real local D1: proves the wiring (Hono → Zod → domain →
// Store → Drizzle → D1), not logic — that lives in the domain/store unit tests. The
// happy path schedules the cancellation Telegram via waitUntil, so it passes an
// ExecutionContext and stubs fetch to keep that notification offline and deterministic.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

afterEach(() => vi.unstubAllGlobals())

const post = (body: unknown, ctx?: ExecutionContext) =>
  app.request(
    '/api/cancel',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env,
    ctx
  )

// A raw (unstringified) body — for the malformed-JSON path the JSON helper can't express.
const postRaw = (raw: string) =>
  app.request('/api/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw }, env)

const insertActive = (email: string, lastName: string, competition: string, status = 'new') =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status)
     VALUES ('2026-06-01T10:00:00.000Z', ?, 'First', ?, 'TV Winsen', ?, ?)`
  )
    .bind(competition, lastName, email, status)
    .run()

const statusOf = async (email: string) =>
  (
    await env.DB.prepare('SELECT status FROM registrations WHERE email = ? COLLATE NOCASE')
      .bind(email)
      .all<{ status: string }>()
  ).results.map(r => r.status)

describe('POST /api/cancel (integration)', () => {
  it('rejects malformed input with the legacy validation message', async () => {
    const res = await post({ email: 'not-an-email', lastName: 'Muster' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Bitte gib die E-Mail-Adresse deiner Anmeldung an.' })
  })

  it('silently succeeds on a filled honeypot without cancelling anything', async () => {
    await insertActive('trap@example.com', 'Trap', 'mens')
    const res = await post({ email: 'trap@example.com', lastName: 'Trap', website: 'http://spam' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cancelled: 0 })
    expect(await statusOf('trap@example.com')).toEqual(['new'])
  })

  it('a filled honeypot wins over field errors (trap checked before validation)', async () => {
    await insertActive('trap2@example.com', 'Trap2', 'mens')
    // Invalid (malformed email) AND the trap filled: the honeypot short-circuits to a silent
    // zero-cancel success rather than leaking a 400 field error, and nothing is withdrawn.
    const res = await post({ email: 'not-an-email', lastName: 'Trap2', website: 'http://spam' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cancelled: 0 })
    expect(await statusOf('trap2@example.com')).toEqual(['new'])
  })

  it('rejects a malformed JSON body with the legacy envelope', async () => {
    const res = await postRaw('{ not json')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Ungültige Anfrage.' })
  })

  it('withdraws every active entry for the person across Konkurrenzen and reports the count', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 200 }))
    await insertActive('multi@example.com', 'Multi', 'mens', 'new')
    await insertActive('multi@example.com', 'Multi', 'womens', 'confirmed')
    await insertActive('multi@example.com', 'Multi', 'mens-challenger', 'cancelled')

    const ctx = createExecutionContext()
    const res = await post({ email: 'MULTI@example.com', lastName: 'multi' }, ctx)
    await waitOnExecutionContext(ctx)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cancelled: 2 })
    // Both active entries cancelled; the already-cancelled one is unchanged.
    expect((await statusOf('multi@example.com')).sort()).toEqual(['cancelled', 'cancelled', 'cancelled'])
  })

  it('reports zero when nothing matches', async () => {
    const res = await post({ email: 'nobody@example.com', lastName: 'Nobody' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cancelled: 0 })
  })
})
