import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'
import worker from '../worker/index'
import { isCancelledCompetition, resolveSocialMixerBlock, SOCIAL_MIXER_DEFAULT_PLACEMENT } from '../shared'
import type { PhaseResponse } from '../shared'

// Thin integration smoke over a real local D1: proves the phase wiring (Hono → Zod → app-state
// Store → Drizzle → D1) and the cron's phase gate (ADR-0006), not logic. The app-state default
// lives in the Store; the cron no-op outside signup is the only new behaviour.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.exec('DELETE FROM app_state')
  await env.DB.exec('DELETE FROM registrations')
})

afterEach(() => vi.unstubAllGlobals())

const JSON_HEADERS = { 'content-type': 'application/json' }

const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

const phaseResponse = async () => (await (await req('/api/phase')).json()) as PhaseResponse

// One confirmed entry in a field — the mixer's head-count is how many of these carry `womens-social`.
const seedConfirmed = (competition: string, i: number) =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
     VALUES (?, ?, ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
  )
    .bind(`2026-06-01T10:00:0${i % 10}Z`, competition, `P${i}`, `Player${i}`, `p${i}@x.de`, `${(i % 20) + 1}.0`)
    .run()

const seedMixerEntries = async (n: number) => {
  for (let i = 0; i < n; i++) await seedConfirmed('womens-social', i)
}

describe('GET /api/phase', () => {
  it('defaults to signup on a fresh app-state', async () => {
    const res = await req('/api/phase')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      phase: 'signup',
      cancelledCompetitions: [],
      socialMixerPlacement: SOCIAL_MIXER_DEFAULT_PLACEMENT,
      socialMixerCourts: [6]
    })
  })

  it('reflects a persisted phase', async () => {
    await env.DB.prepare("INSERT INTO app_state (id, phase) VALUES (1, 'tournament')").run()
    expect(await (await req('/api/phase')).json()).toEqual({
      phase: 'tournament',
      cancelledCompetitions: [],
      socialMixerPlacement: SOCIAL_MIXER_DEFAULT_PLACEMENT,
      socialMixerCourts: [6]
    })
  })
})

// The mixer's courts on the public signal (ADR-0073): the server runs the head-count derivation and ships
// the **result**, so the courts become public and the confirmed count does not. `[5, 6]` means 8–11 entries,
// which is not a number — that non-recovery is the whole point of shipping the list.
describe('GET /api/phase · the mixer courts (ADR-0073)', () => {
  it('resolves the court list from the confirmed head-count', async () => {
    await seedMixerEntries(9)
    expect((await phaseResponse()).socialMixerCourts).toEqual([5, 6])
  })

  it('grows to three courts and stops there', async () => {
    await seedMixerEntries(20)
    expect((await phaseResponse()).socialMixerCourts).toEqual([4, 5, 6])
  })

  it('counts only the mixer — the championship fields do not size its reservation', async () => {
    await seedMixerEntries(4)
    for (let i = 0; i < 12; i++) await seedConfirmed('womens', 100 + i)
    expect((await phaseResponse()).socialMixerCourts).toEqual([6])
  })

  it('publishes no head-count anywhere in the payload', async () => {
    await seedMixerEntries(9)
    const body = await phaseResponse()
    expect(Object.keys(body).sort()).toEqual([
      'cancelledCompetitions',
      'phase',
      'socialMixerCourts',
      'socialMixerPlacement'
    ])
    // Not „9 appears nowhere" — a slot index may legitimately be 9. The count is absent because no field
    // carries it: the courts are the only trace, and they do not recover to it.
    expect(JSON.stringify(body)).not.toContain('confirmed')
  })

  it('carries the operator’s placement alongside the derived courts', async () => {
    await seedMixerEntries(9)
    await req('/api/admin/social-mixer-block', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ day: 0, startSlot: 10 })
    })
    const body = await phaseResponse()
    expect(body.socialMixerPlacement).toEqual({ day: 0, startSlot: 10 })
    expect(body.socialMixerCourts).toEqual([5, 6])
  })

  it('leaves a cancelled mixer with no block for the page to render', async () => {
    await seedMixerEntries(9)
    await env.DB.prepare(`INSERT INTO app_state (id, cancelled_competitions) VALUES (1, '["womens-social"]')`).run()
    const body = await phaseResponse()
    expect(body.cancelledCompetitions).toContain('womens-social')
    // What the page does with the signal: no block, so no band (ADR-0062, ADR-0064).
    const cancelled = isCancelledCompetition(body.cancelledCompetitions, 'womens-social')
    expect(resolveSocialMixerBlock({ ...body.socialMixerPlacement, confirmed: 9, cancelled })).toBeNull()
  })
})

describe('POST /api/admin/social-mixer-block', () => {
  const move = (json: unknown) =>
    req('/api/admin/social-mixer-block', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(json) })

  it('moves the block and persists it, read back on the public signal', async () => {
    const res = await move({ day: 0, startSlot: 10 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, socialMixerPlacement: { day: 0, startSlot: 10 } })
    const phase = (await (await req('/api/phase')).json()) as { socialMixerPlacement: unknown }
    expect(phase.socialMixerPlacement).toEqual({ day: 0, startSlot: 10 })
  })

  it('refuses a start whose three hours would run past daylight — the server, not only the dialog', async () => {
    // Sunday's slot 17 starts at 18:30, so the block would end at 21:30 (ADR-0064 §4).
    expect((await move({ day: 1, startSlot: 17 })).status).toBe(400)
    expect((await move({ day: 2, startSlot: 6 })).status).toBe(400)
    // …and nothing was written: the public signal still carries the planned placement.
    const phase = (await (await req('/api/phase')).json()) as { socialMixerPlacement: unknown }
    expect(phase.socialMixerPlacement).toEqual(SOCIAL_MIXER_DEFAULT_PLACEMENT)
  })

  it('leaves the other globals on the single row untouched', async () => {
    await req('/api/admin/phase', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phase: 'tournament' })
    })
    await move({ day: 0, startSlot: 0 })
    const phase = (await (await req('/api/phase')).json()) as { phase: string; cancelledCompetitions: string[] }
    expect(phase.phase).toBe('tournament')
    expect(phase.cancelledCompetitions).toEqual([])
  })
})

describe('POST /api/admin/phase', () => {
  it('sets the phase and persists it (read back via GET)', async () => {
    const res = await req('/api/admin/phase', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phase: 'tournament' })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phase: 'tournament' })
    expect(await (await req('/api/phase')).json()).toEqual({
      phase: 'tournament',
      cancelledCompetitions: [],
      socialMixerPlacement: SOCIAL_MIXER_DEFAULT_PLACEMENT,
      socialMixerCourts: [6]
    })
  })

  it('keeps a single row across repeated sets', async () => {
    await req('/api/admin/phase', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phase: 'tournament' })
    })
    await req('/api/admin/phase', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phase: 'post-event' })
    })
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM app_state').first<{ c: number }>()
    expect(count?.c).toBe(1)
    expect(await (await req('/api/phase')).json()).toEqual({
      phase: 'post-event',
      cancelledCompetitions: [],
      socialMixerPlacement: SOCIAL_MIXER_DEFAULT_PLACEMENT,
      socialMixerCourts: [6]
    })
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

  it('runs syncAll during signup (fetches the nuLiga rosters)', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await runScheduled()
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('no-ops outside signup (never touches nuLiga)', async () => {
    await env.DB.prepare("INSERT INTO app_state (id, phase) VALUES (1, 'tournament')").run()
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await runScheduled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
