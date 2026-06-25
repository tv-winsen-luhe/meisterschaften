import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'
import worker from '../worker/index'

// Thin integration smoke over a real local D1: proves the phase wiring (Hono → Zod → app-state
// Store → Drizzle → D1) and the cron's phase gate (ADR-0006), not logic. The app-state default
// lives in the Store; the cron no-op outside Anmeldung is the only new behaviour.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.exec('DELETE FROM app_state')
})

afterEach(() => vi.unstubAllGlobals())

const JSON_HEADERS = { 'content-type': 'application/json' }

const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

describe('GET /api/phase', () => {
  it('defaults to anmeldung on a fresh app-state', async () => {
    const res = await req('/api/phase')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ phase: 'anmeldung' })
  })

  it('reflects a persisted phase', async () => {
    await env.DB.prepare("INSERT INTO app_state (id, phase) VALUES (1, 'live')").run()
    expect(await (await req('/api/phase')).json()).toEqual({ phase: 'live' })
  })
})

describe('POST /api/admin/phase', () => {
  it('sets the phase and persists it (read back via GET)', async () => {
    const res = await req('/api/admin/phase', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phase: 'auslosung' })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phase: 'auslosung' })
    expect(await (await req('/api/phase')).json()).toEqual({ phase: 'auslosung' })
  })

  it('keeps a single row across repeated sets', async () => {
    await req('/api/admin/phase', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ phase: 'live' }) })
    await req('/api/admin/phase', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phase: 'post-event' })
    })
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM app_state').first<{ c: number }>()
    expect(count?.c).toBe(1)
    expect(await (await req('/api/phase')).json()).toEqual({ phase: 'post-event' })
  })

  it('rejects an invalid phase at the Zod boundary', async () => {
    const res = await req('/api/admin/phase', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phase: 'nope' })
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Ungültige Phase.' })
  })
})

describe('weekly cron · phase gate', () => {
  const runScheduled = async () => {
    const ctx = createExecutionContext()
    await worker.scheduled({ scheduledTime: 0, cron: '0 5 * * 1', noRetry: () => {} }, env, ctx)
    await waitOnExecutionContext(ctx)
  }

  it('runs syncAll during anmeldung (fetches the nuLiga rosters)', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await runScheduled()
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('no-ops outside anmeldung (never touches nuLiga)', async () => {
    await env.DB.prepare("INSERT INTO app_state (id, phase) VALUES (1, 'auslosung')").run()
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await runScheduled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
