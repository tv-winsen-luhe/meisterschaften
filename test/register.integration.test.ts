import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'
import { createD1RegistrationsStore } from '../worker/store/registrations'

// Thin integration smoke over a real local D1: proves the wiring (Hono → Zod → domain →
// Store → Drizzle → D1), not logic — that lives in the domain/seedingLk/store unit tests.
// The error/honeypot/dup cases answer before the response is sent, so they never reach the
// background waitUntil. The happy path does, so it passes an ExecutionContext and stubs
// fetch to keep the nuLiga match offline and deterministic.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

afterEach(() => vi.unstubAllGlobals())

const post = (body: unknown) =>
  app.request(
    '/api/register',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env
  )

// A raw (unstringified) body — for the malformed-JSON path the JSON helper can't express.
const postRaw = (raw: string) =>
  app.request('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw }, env)

const valid = {
  competition: 'mens',
  firstName: 'Max',
  lastName: 'Muster',
  club: 'TV Winsen',
  email: 'max@example.com',
  consent: 'yes'
}

describe('D1 registrations store (integration)', () => {
  it('insert persists a row that reads back through findActiveRegistration', async () => {
    const store = createD1RegistrationsStore(env.DB)
    const inserted = await store.insert({
      createdAt: '2026-06-01T10:00:00.000Z',
      competition: 'womens',
      firstName: 'Wilma',
      lastName: 'Wright',
      club: 'TV Winsen',
      email: 'wilma@example.com',
      phone: null,
      note: null,
      ip: null
    })
    expect(inserted.id).toBeGreaterThan(0)
    expect(inserted.status).toBe('new')

    const found = await store.findActiveRegistration({
      email: 'WILMA@example.com',
      lastName: 'wright',
      competition: 'womens'
    })
    expect(found?.id).toBe(inserted.id)
  })

  it('revive flips a cancelled row back to new and keeps its linkage', async () => {
    const store = createD1RegistrationsStore(env.DB)
    await env.DB.prepare(
      `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, player_id, lk, status)
       VALUES ('2026-06-01T10:00:00.000Z', 'mens', 'Old', 'Reviver', 'TSV Winsen', 'rev@example.com', '12345678', '15.0', 'cancelled')`
    ).run()
    const cancelled = await store.findCancelledRegistration({
      email: 'rev@example.com',
      lastName: 'Reviver',
      competition: 'mens'
    })
    expect(cancelled).not.toBeNull()

    const revived = await store.revive(cancelled!.id, {
      createdAt: '2026-06-05T10:00:00.000Z',
      firstName: 'New',
      lastName: 'Reviver',
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

  it('countRecentByIp counts this IP after the cutoff', async () => {
    const store = createD1RegistrationsStore(env.DB)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, ip, status)
         VALUES ('2026-06-10T10:00:00.000Z', 'mens', 'A', 'A', 'TV Winsen', 'a@ip.de', '9.9.9.9', 'new')`
      ),
      env.DB.prepare(
        `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, ip, status)
         VALUES ('2026-06-10T08:00:00.000Z', 'mens', 'B', 'B', 'TV Winsen', 'b@ip.de', '9.9.9.9', 'new')`
      )
    ])
    expect(await store.countRecentByIp('9.9.9.9', '2026-06-10T09:00:00.000Z')).toBe(1)
  })
})

describe('POST /api/register (integration)', () => {
  it('rejects malformed input with the legacy validation message', async () => {
    const res = await post({ ...valid, firstName: '' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Bitte gib deinen Vornamen an.' })
  })

  it('silently succeeds on a filled honeypot without inserting a row', async () => {
    const res = await post({ ...valid, email: 'bot@example.com', website: 'http://spam' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM registrations WHERE email = ?')
      .bind('bot@example.com')
      .first<{ c: number }>()
    expect(row?.c).toBe(0)
  })

  it('a filled honeypot wins over field errors (trap checked before validation)', async () => {
    // Invalid (empty firstName) AND the trap filled: the honeypot must short-circuit to a
    // silent success rather than leaking a 400 field error to the bot.
    const res = await post({ ...valid, firstName: '', website: 'http://spam' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejects a malformed JSON body with the legacy envelope', async () => {
    const res = await postRaw('{ not json')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Ungültige Anfrage.' })
  })

  it('requires the application/json content-type to read the body (zValidator gate)', async () => {
    // Deliberate contract: without the application/json header, zValidator validates {} and 400s
    // — even for an otherwise-valid body. A string body defaults to text/plain, exercising it.
    // Every first-party caller (forms + hc client) sends the header, so the browser path is fine.
    const res = await app.request('/api/register', { method: 'POST', body: JSON.stringify(valid) }, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Bitte wähle eine gültige Konkurrenz.' })
  })

  it('rejects a second active sign-up for the same person+Konkurrenz (one-active-entry invariant)', async () => {
    await createD1RegistrationsStore(env.DB).insert({
      createdAt: '2026-06-01T10:00:00.000Z',
      competition: 'mens',
      firstName: 'Dupe',
      lastName: 'Dupe',
      club: 'TV Winsen',
      email: 'dupe@example.com',
      phone: null,
      note: null,
      ip: null
    })
    const res = await post({ ...valid, firstName: 'Dupe', lastName: 'Dupe', email: 'dupe@example.com' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Du bist für diese Konkurrenz bereits angemeldet.' })
  })

  it('rejects a 4th sign-up from the same IP within the hour (soft rate limit)', async () => {
    // Three recent rows from one IP put the count at the RATE_LIMIT of 3; the 4th request is
    // rejected with 429 before it reaches the domain. created_at is `now` so the rows fall inside
    // the route's live `now − 1h` window. The rate check runs ahead of the dup/validation paths,
    // so the body content is irrelevant — it never gets that far.
    const ip = '5.5.5.5'
    const now = new Date().toISOString()
    await env.DB.batch(
      ['rl1', 'rl2', 'rl3'].map((slug, i) =>
        env.DB.prepare(
          `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, ip, status)
           VALUES (?, 'mens', ?, ?, 'TV Winsen', ?, ?, 'new')`
        ).bind(now, slug, slug, `${slug}-${i}@ip.de`, ip)
      )
    )

    const res = await app.request(
      '/api/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({ ...valid, email: 'rate-limited@example.com' })
      },
      env
    )
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({
      error: 'Zu viele Anmeldungen in kurzer Zeit. Bitte versuch es später erneut.'
    })
  })

  it('persists a new registration on the happy path (end to end, incl. the background match)', async () => {
    // Keep the background nuLiga match offline: an empty roster yields no match.
    vi.stubGlobal('fetch', async () => new Response('', { status: 200 }))
    const ctx = createExecutionContext()
    const res = await app.request(
      '/api/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...valid, email: 'happy@example.com', firstName: 'Happy', lastName: 'Path' })
      },
      env,
      ctx
    )
    await waitOnExecutionContext(ctx)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const row = await env.DB.prepare('SELECT status FROM registrations WHERE email = ?')
      .bind('happy@example.com')
      .first<{ status: string }>()
    expect(row?.status).toBe('new')
  })
})
