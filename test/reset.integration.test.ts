import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/app'
import { createD1DrawStore, type SaveDrawInput } from '../worker/store/draw'

// Thin integration smoke over a real local D1: proves the debug-reset wiring (Hono → flag guard →
// reset service → stores → D1) and the RESET_ENABLED gate (ADR-0029), not logic — the cascade/guard
// rules live in the reset service unit tests. Auth is edge-only (Cloudflare Access, ADR-0008): no
// in-worker auth to test here; the flag is the second gate this file exercises.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.exec('DELETE FROM registrations')
  await env.DB.exec('DELETE FROM matches')
  await env.DB.exec('DELETE FROM draws')
  await env.DB.exec('DELETE FROM app_state')
})

const JSON_HEADERS = { 'content-type': 'application/json' }

// RESET_ENABLED is unset on the base test env (production-like). The "on" cases pass an env where the
// flag is exactly "true", the way .dev.vars sets it locally — the gate keys off that exact string.
const ON = { ...env, RESET_ENABLED: 'true' }

const reqOff = (path: string, init: RequestInit = {}) => app.request(path, init, env)
const reqOn = (path: string, init: RequestInit = {}) => app.request(path, init, ON)
const post = (req: typeof reqOn, path: string, body?: unknown) =>
  req(path, { method: 'POST', headers: JSON_HEADERS, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })

const seedConfirmed = (overrides: Record<string, string> = {}) => {
  const row = {
    created_at: '2026-06-01T10:00:00.000Z',
    competition: 'mens',
    first_name: 'Max',
    last_name: 'Muster',
    club: 'TV Winsen',
    email: 'max@example.com',
    status: 'confirmed',
    ...overrides
  }
  const keys = Object.keys(row)
  return env.DB.prepare(`INSERT INTO registrations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .bind(...Object.values(row))
    .run()
}

const drawInput = (competition: string): SaveDrawInput => ({
  competition,
  bracket: 'main',
  size: 8,
  seeding: [{ seed: 1, playerId: 1, lk: '1.0' }],
  revealSequence: [{ kind: 'seed-fixed', position: 0, playerId: 1, seed: 1 }],
  matches: [{ round: 1, position: 0, slot1RegId: 1, slot2RegId: 2, winnerRegId: null, outcome: null }],
  challengerMinLk: null,
  createdAt: '2026-08-22T10:00:00.000Z'
})

const drawCount = async () => (await env.DB.prepare('SELECT COUNT(*) AS c FROM draws').first<{ c: number }>())?.c ?? 0

describe('debug-reset · flag gate (RESET_ENABLED)', () => {
  it('GET /api/admin/reset reports the flag', async () => {
    expect(await (await reqOff('/api/admin/reset')).json()).toEqual({ enabled: false })
    expect(await (await reqOn('/api/admin/reset')).json()).toEqual({ enabled: true })
  })

  it('refuses every reset route with 403 when the flag is off', async () => {
    expect((await post(reqOff, '/api/admin/reset/undraw', { competition: 'mens' })).status).toBe(403)
    expect((await post(reqOff, '/api/admin/reset/readmit')).status).toBe(403)
    expect((await post(reqOff, '/api/admin/reset/back-to-signup')).status).toBe(403)
  })
})

describe('POST /api/admin/reset/undraw', () => {
  it('tears down the competition draw and frees it for a re-draw', async () => {
    await createD1DrawStore(env.DB).save(drawInput('mens'))
    expect(await drawCount()).toBe(1)

    const res = await post(reqOn, '/api/admin/reset/undraw', { competition: 'mens' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, undrawn: 1 })
    expect(await drawCount()).toBe(0)
  })

  it('is an idempotent no-op for an undrawn field', async () => {
    expect(await (await post(reqOn, '/api/admin/reset/undraw', { competition: 'womens' })).json()).toEqual({
      ok: true,
      undrawn: 0
    })
  })

  it('rejects an invalid competition at the Zod boundary', async () => {
    expect((await post(reqOn, '/api/admin/reset/undraw', { competition: 'nope' })).status).toBe(400)
  })
})

describe('POST /api/admin/reset/readmit', () => {
  it('moves confirmed entries back to new when no draw exists', async () => {
    await seedConfirmed({ email: 'a@x.de' })
    await seedConfirmed({ email: 'b@x.de' })

    const res = await post(reqOn, '/api/admin/reset/readmit')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, readmitted: 2 })

    const newCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM registrations WHERE status = 'new'").first<{
      c: number
    }>()
    expect(newCount?.c).toBe(2)
  })

  it('refuses with 409 while a draw still references confirmed entries', async () => {
    await seedConfirmed()
    await createD1DrawStore(env.DB).save(drawInput('mens'))

    const res = await post(reqOn, '/api/admin/reset/readmit')
    expect(res.status).toBe(409)
  })
})

describe('POST /api/admin/reset/back-to-signup', () => {
  it('cascades an undraw of all competitions and sets the phase to signup, leaving status untouched', async () => {
    await seedConfirmed()
    await env.DB.prepare("INSERT INTO app_state (id, phase) VALUES (1, 'tournament')").run()
    await createD1DrawStore(env.DB).save(drawInput('mens'))
    await createD1DrawStore(env.DB).save(drawInput('womens'))

    const res = await post(reqOn, '/api/admin/reset/back-to-signup')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phase: 'signup', undrawn: 2 })

    expect(await drawCount()).toBe(0)
    expect(await (await reqOn('/api/phase')).json()).toEqual({ phase: 'signup' })
    // Registration status is deliberately left alone — confirmed entries are valid during signup.
    const confirmed = await env.DB.prepare("SELECT COUNT(*) AS c FROM registrations WHERE status = 'confirmed'").first<{
      c: number
    }>()
    expect(confirmed?.c).toBe(1)
  })
})
