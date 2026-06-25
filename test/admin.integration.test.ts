import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'

// Thin integration smoke over a real local D1: proves the admin wiring (Hono → Zod →
// domain/Store → Drizzle → D1), not logic — that lives in the domain/store/seedingLk units.
// Auth is edge-only (Cloudflare Access, ADR-0008): the worker has no auth check to test here.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.exec('DELETE FROM registrations')
})

afterEach(() => vi.unstubAllGlobals())

const JSON_HEADERS = { 'content-type': 'application/json' }

const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

const seed = (overrides: Record<string, string> = {}) => {
  const row = {
    created_at: '2026-06-01T10:00:00.000Z',
    competition: 'mens',
    first_name: 'Max',
    last_name: 'Muster',
    club: 'TV Winsen',
    email: 'max@example.com',
    status: 'new',
    ...overrides
  }
  const keys = Object.keys(row)
  return env.DB.prepare(
    `INSERT INTO registrations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING id`
  )
    .bind(...Object.values(row))
    .first<{ id: number }>()
}

describe('GET /api/admin/list', () => {
  it('returns rows in the camelCase contract shape without the internal ip', async () => {
    await seed({ email: 'a@x.de', ip: '9.9.9.9' })
    const res = await req('/api/admin/list', { headers: JSON_HEADERS })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { registrations: Record<string, unknown>[] }
    expect(data.registrations).toHaveLength(1)
    expect(data.registrations[0]).toMatchObject({ email: 'a@x.de', firstName: 'Max', status: 'new' })
    expect(data.registrations[0]).not.toHaveProperty('ip')
  })
})

describe('POST /api/admin/confirm', () => {
  it('confirms with an explicit LK and persists it', async () => {
    const row = await seed()
    const res = await req('/api/admin/confirm', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: row!.id, competition: 'mens', club: 'TV Winsen', playerId: '', lk: '25.0' })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, lkFetched: null })

    const persisted = await env.DB.prepare('SELECT status, lk FROM registrations WHERE id = ?')
      .bind(row!.id)
      .first<{ status: string; lk: string }>()
    expect(persisted).toMatchObject({ status: 'confirmed', lk: '25.0' })
  })

  it('rejects a confirm without a seeding basis (canConfirm) with 400 + reason', async () => {
    const row = await seed()
    const res = await req('/api/admin/confirm', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: row!.id, competition: 'mens', club: 'TV Winsen', playerId: '', lk: '' })
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Zum Bestätigen bitte Spieler-ID eintragen oder „keine ID" (LK 25.0) setzen.'
    })
  })

  it('fetches the LK from nuLiga when a player id is linked', async () => {
    const row = await seed()
    // Stub the nuLiga club page so lkForPlayerId resolves a fresh LK.
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<tr><td>12345678</td><td>LK 11,2</td><td><a id="e_1">Muster, Max</a></td></tr>', { status: 200 })
    )
    const res = await req('/api/admin/confirm', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: row!.id, competition: 'mens', club: 'TV Winsen', playerId: '12345678', lk: '' })
    })
    expect(await res.json()).toEqual({ ok: true, lkFetched: '11.2' })
    const persisted = await env.DB.prepare('SELECT lk FROM registrations WHERE id = ?')
      .bind(row!.id)
      .first<{ lk: string }>()
    expect(persisted?.lk).toBe('11.2')
  })

  it('rejects a malformed player id at the Zod boundary', async () => {
    const row = await seed()
    const res = await req('/api/admin/confirm', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: row!.id, competition: 'mens', club: 'TV Winsen', playerId: '123', lk: '' })
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Spieler-ID muss 8-stellig sein.' })
  })
})

describe('POST /api/admin/hide + /delete', () => {
  it('hides a row', async () => {
    const row = await seed({ status: 'confirmed' })
    const res = await req('/api/admin/hide', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: row!.id })
    })
    expect(await res.json()).toEqual({ ok: true })
    const persisted = await env.DB.prepare('SELECT status FROM registrations WHERE id = ?')
      .bind(row!.id)
      .first<{ status: string }>()
    expect(persisted?.status).toBe('hidden')
  })

  it('deletes a row', async () => {
    const row = await seed()
    const res = await req('/api/admin/delete', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: row!.id })
    })
    expect(await res.json()).toEqual({ ok: true, deleted: 1 })
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM registrations WHERE id = ?')
      .bind(row!.id)
      .first<{ c: number }>()
    expect(count?.c).toBe(0)
  })
})
