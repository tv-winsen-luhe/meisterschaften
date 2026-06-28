import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CHALLENGER_MIN_LK, type CompetitionDraw } from '../shared'
import { app } from '../worker/app'
import { createDrawService } from '../worker/draw'
import { createD1DrawStore, createInMemoryDrawStore } from '../worker/store/draw'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// A confirmed registration row for the in-memory store. The seeding LK is set so the strongest (1.0)
// sorts to seed 1; createdAt rises with the id so the tiebreak is stable.
const confirmed = (id: number, overrides: Partial<RegistrationRow> = {}): RegistrationRow => ({
  id,
  createdAt: `2026-06-0${id}T10:00:00.000Z`,
  updatedAt: null,
  competition: 'mens',
  firstName: `P${id}`,
  lastName: `Player${id}`,
  club: 'TV Winsen',
  email: `p${id}@x.de`,
  phone: null,
  note: null,
  playerId: null,
  lk: `${id}.0`,
  status: 'confirmed',
  ip: null,
  ...overrides
})

const field = (n: number) => Array.from({ length: n }, (_, i) => confirmed(i + 1))

// ── Worker orchestration over the in-memory stores (no D1) ──────────────────────────────────────
// The draw service is the wiring (guards + read + pure draw + atomic write); the bracket math is
// covered in draw.test.ts. Driving it through the in-memory stores proves the orchestration and the
// gates without a runtime.
describe('createDrawService.draw', () => {
  const service = (rows: RegistrationRow[], sequence: number[]) =>
    createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(rows),
      drawStore: createInMemoryDrawStore(),
      randomSource: createFakeRandomSource(sequence)
    })

  it('draws a full field and writes the bracket + draw record', async () => {
    const svc = service(field(8), [0, 0, 0, 0, 0])
    const result = await svc.draw({ competition: 'mens', phase: 'tournament', now: '2026-08-01T09:00:00.000Z' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draw.size).toBe(8)
    expect(result.draw.bracket).toBe('main')
    expect(result.draw.seeding).toHaveLength(2)
    expect(result.draw.matches).toHaveLength(7)
    // The materialized round-1 matches carry persisted ids and the slot references.
    const round1 = result.draw.matches.filter(m => m.round === 1)
    expect(round1).toHaveLength(4)
    expect(round1.every(m => m.id > 0 && m.slot1RegId !== null && m.slot2RegId !== null)).toBe(true)
  })

  it('seeds only this competition — confirmed rows of other fields are ignored', async () => {
    const rows = [...field(8), confirmed(9, { competition: 'womens' }), confirmed(10, { competition: 'womens' })]
    const result = await service(rows, [0, 0, 0, 0, 0]).draw({
      competition: 'mens',
      phase: 'tournament',
      now: 'now'
    })
    expect(result.ok && result.draw.size).toBe(8)
  })

  it('refuses outside the tournament phase', async () => {
    const result = await service(field(8), []).draw({ competition: 'mens', phase: 'signup', now: 'now' })
    expect(result).toMatchObject({ ok: false, error: 'not-tournament' })
  })

  it('replaces an unrevealed draw on re-run (cursor 0), refuses once revealed (ADR-0026)', async () => {
    const drawStore = createInMemoryDrawStore()
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(8)),
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    })
    // While unrevealed (cursor 0, nothing public) a re-run is the only legitimate "repeat": it discards
    // and re-draws. Both attempts succeed; the second replaces the first, leaving a single draw record.
    expect((await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })).ok).toBe(true)
    expect((await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })).ok).toBe(true)
    expect(await drawStore.listDraws()).toHaveLength(1)

    // Reveal the first lot — now the draw is frozen and a further re-run is refused (no re-roll).
    expect(await svc.advance('mens', 'forward')).toMatchObject({ ok: true, cursor: 1 })
    expect(await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })).toMatchObject({
      ok: false,
      error: 'AlreadyDrawn'
    })
  })

  it('does not wipe a standing unrevealed draw when a re-run fails its preconditions', async () => {
    // The break-glass replace deletes the old draw only after the new one is known valid: a re-run that
    // fails (here: too few entries on the second attempt) must leave the existing draw untouched.
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(field(8))
    const svc = createDrawService({
      registrationsStore,
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0])
    })
    expect((await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })).ok).toBe(true)
    // A re-run in the wrong phase fails its gate before any teardown — the original draw still stands.
    expect(await svc.draw({ competition: 'mens', phase: 'signup', now: 'now' })).toMatchObject({
      ok: false,
      error: 'not-tournament'
    })
    expect(await drawStore.findDraw('mens', 'main')).not.toBeNull()
  })

  it('draws a non-full field, filling it with byes and auto-resolving them (§31)', async () => {
    const result = await service(field(7), [0, 0, 0, 0]).draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draw.size).toBe(8)
    expect(result.draw.matches).toHaveLength(7)
    // The 7th entrant rounds up to an 8-draw with one bye, resolved at draw time (winner, no score).
    const byes = result.draw.matches.filter(m => m.outcome === 'bye')
    expect(byes).toHaveLength(1)
    expect(byes[0]).toMatchObject({ round: 1, outcome: 'bye' })
    expect(byes[0]?.winnerRegId).not.toBeNull()
  })

  it('draws a 4-player field — the smallest field that forms a knockout (ADR-0034)', async () => {
    const result = await service(field(4), [0]).draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draw.size).toBe(4)
    expect(result.draw.matches).toHaveLength(3) // two semifinals + final, no byes (a full 4-draw)
  })

  it('refuses an over-full field whose size has no seed table (17+ rounds to 32)', async () => {
    const result = await service(field(17), []).draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(result).toMatchObject({ ok: false, error: 'unsupported-size' })
  })

  it('refuses fewer than four confirmed entries (2–3 are too few to seed a knockout)', async () => {
    const result = await service(field(3), []).draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(result).toMatchObject({ ok: false, error: 'too-few' })
  })
})

// ── Challenger cap binds at the draw (ADR-0024, issue #73) ───────────────────────────────────────
// The hard Challenger-LK guard on the frozen LKs: the draw snapshots the threshold, judges the field
// with the shared challengerEligibility predicate (the single authority, Slice 6), and on a violation
// blocks the draw and writes nothing. The only levers are the field-wide threshold or removing the
// entry — there is no per-player override path. Non-Challenger fields carry no cap.
describe('createDrawService.draw — Challenger cap', () => {
  // An 8-strong Challenger field with the given LKs (id i+1, createdAt rising so the order is stable).
  const challengerField = (lks: (string | null)[]) =>
    lks.map((lk, i) => confirmed(i + 1, { competition: 'mens-challenger', lk }))

  // Full unseeded fill for an 8-draw (5 lot steps) — only consumed on the pass cases that reach the draw.
  const FULL_8 = [0, 0, 0, 0, 0]

  it('blocks the draw when an entry is too strong, returns the offenders, and writes nothing', async () => {
    const drawStore = createInMemoryDrawStore()
    // One entry (LK 15.0) is stronger than the default cap of 20; the rest meet it.
    const rows = challengerField(['20.0', '21.0', '22.0', '23.0', '24.0', '25.0', '25.0', '15.0'])
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(rows),
      drawStore,
      randomSource: createFakeRandomSource([])
    })

    const result = await svc.draw({ competition: 'mens-challenger', phase: 'tournament', now: 'now' })
    expect(result).toMatchObject({ ok: false, error: 'ChallengerTooStrong' })
    if (result.ok) return
    expect(result.tooStrong).toEqual([{ id: 8, lk: '15.0' }])
    // Nothing persisted — the field stays un-drawn (snapshot → check → on violation write nothing).
    expect(await drawStore.findDraw('mens-challenger', 'main')).toBeNull()
  })

  it('draws when every entry meets the cap, snapshotting the threshold into the draw record', async () => {
    const drawStore = createInMemoryDrawStore()
    const rows = challengerField(['20.0', '21.0', '22.0', '23.0', '24.0', '25.0', '25.0', '25.0'])
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(rows),
      drawStore,
      randomSource: createFakeRandomSource(FULL_8)
    })

    const result = await svc.draw({ competition: 'mens-challenger', phase: 'tournament', now: 'now' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.draw.size).toBe(8)
    // The cap is frozen into the draw record — the default when the operator passes none.
    expect((await drawStore.findDraw('mens-challenger', 'main'))?.challengerMinLk).toBe(CHALLENGER_MIN_LK)
  })

  it('honours the operator-tuned threshold over the default, snapshotting the chosen value', async () => {
    const drawStore = createInMemoryDrawStore()
    // LK 22.0 meets the default cap (20) but is too strong at a raised cap of 23.
    const rows = challengerField(['22.0', '24.0', '25.0', '25.0', '25.0', '25.0', '25.0', '25.0'])
    const svc = () =>
      createDrawService({
        registrationsStore: createInMemoryRegistrationsStore(rows),
        drawStore,
        randomSource: createFakeRandomSource(FULL_8)
      })

    const blocked = await svc().draw({
      competition: 'mens-challenger',
      phase: 'tournament',
      challengerMinLk: 23,
      now: 'now'
    })
    expect(blocked).toMatchObject({ ok: false, error: 'ChallengerTooStrong' })
    expect(blocked.ok || blocked.tooStrong).toEqual([{ id: 1, lk: '22.0' }])
    expect(await drawStore.findDraw('mens-challenger', 'main')).toBeNull()

    // A lower cap of 10 admits the whole field; the chosen value is what gets frozen.
    const passed = await svc().draw({
      competition: 'mens-challenger',
      phase: 'tournament',
      challengerMinLk: 10,
      now: 'now'
    })
    expect(passed.ok).toBe(true)
    expect((await drawStore.findDraw('mens-challenger', 'main'))?.challengerMinLk).toBe(10)
  })

  it('does not gate non-Challenger fields — strong LKs draw freely, with no cap snapshot', async () => {
    const drawStore = createInMemoryDrawStore()
    // A Herren field of LK 1.0–8.0 (all far below the cap) draws without the Challenger guard firing.
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(8)),
      drawStore,
      randomSource: createFakeRandomSource(FULL_8)
    })

    const result = await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(result.ok).toBe(true)
    expect((await drawStore.findDraw('mens', 'main'))?.challengerMinLk).toBeNull()
  })
})

// ── HTTP integration over a real local D1 ────────────────────────────────────────────────────────
// Smoke over the full wiring (Hono → Zod → draw service → DrawStore → Drizzle → D1): the route gates,
// writes, and reads the bracket back. Auth is edge-only (ADR-0008), so there is none to test here.
const JSON_HEADERS = { 'content-type': 'application/json' }
const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

const seedConfirmed = (i: number, competition = 'mens') =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
     VALUES (?, ?, ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
  )
    .bind(`2026-06-${String(i).padStart(2, '0')}T10:00:00Z`, competition, `P${i}`, `Player${i}`, `p${i}@x.de`, `${i}.0`)
    .run()

// A confirmed row with an explicit competition + LK — for the Challenger-cap cases that need to place
// an entry on a specific side of the threshold (seedConfirmed's `${i}.0` LK can't express that).
const seedConfirmedLk = (i: number, competition: string, lk: string) =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
     VALUES (?, ?, ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
  )
    .bind(`2026-06-${String(i).padStart(2, '0')}T10:00:00Z`, competition, `P${i}`, `Player${i}`, `p${i}@x.de`, lk)
    .run()

const setPhase = (phase: string) =>
  req('/api/admin/phase', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ phase }) })

const draw = (competition: string) =>
  req('/api/admin/draw', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ competition }) })

describe('POST /api/admin/draw + GET /api/admin/draws', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  it('refuses to draw before registration is closed', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    const res = await draw('mens')
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('Anmeldeschluss') })
  })

  it('draws a full field, persists matches, and serves the bracket', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    await setPhase('tournament')

    const res = await draw('mens')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; draw: CompetitionDraw }
    expect(body.draw.size).toBe(8)
    expect(body.draw.matches).toHaveLength(7)

    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM matches').first<{ c: number }>()
    expect(count?.c).toBe(7)

    const list = await req('/api/admin/draws', { headers: JSON_HEADERS })
    const listed = (await list.json()) as { draws: CompetitionDraw[] }
    expect(listed.draws).toEqual([expect.objectContaining({ competition: 'mens', size: 8 })])
  })

  it('draws a non-full field, persisting the byes as resolved matches', async () => {
    for (let i = 1; i <= 7; i++) await seedConfirmed(i)
    await setPhase('tournament')

    const res = await draw('mens')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; draw: CompetitionDraw }
    expect(body.draw.size).toBe(8)
    expect(body.draw.matches).toHaveLength(7)

    const byes = await env.DB.prepare("SELECT COUNT(*) AS c FROM matches WHERE outcome = 'bye'").first<{ c: number }>()
    expect(byes?.c).toBe(1)
  })

  it('draws a 16-draw field with byes over D1 — match insert is chunked under D1 100-param cap', async () => {
    // A 16-draw materializes 15 match rows × 8 columns = 120 bound params, over D1's 100-per-query
    // limit; the store must chunk the insert. 13 entrants ⇒ a 16-draw with 3 byes (all to seeds).
    for (let i = 1; i <= 13; i++) await seedConfirmed(i)
    await setPhase('tournament')

    const res = await draw('mens')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; draw: CompetitionDraw }
    expect(body.draw.size).toBe(16)
    expect(body.draw.matches).toHaveLength(15)

    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM matches').first<{ c: number }>()
    expect(count?.c).toBe(15)
    const byes = await env.DB.prepare("SELECT COUNT(*) AS c FROM matches WHERE outcome = 'bye'").first<{ c: number }>()
    expect(byes?.c).toBe(3)
  })

  it('still rejects a field whose draw size has no seed table (17+ rounds to 32) with 400', async () => {
    // 4 is now supported (ADR-0034); an over-full field (17 → size 32) still has no seed table.
    for (let i = 1; i <= 17; i++) await seedConfirmed(i)
    await setPhase('tournament')
    const res = await draw('mens')
    expect(res.status).toBe(400)
  })

  it('blocks a Challenger draw with a too-strong entry (400 + offenders), persisting nothing (ADR-0024)', async () => {
    // Seven entries meet the cap (LK 25.0); one is too strong (LK 15.0 < 20).
    for (let i = 1; i <= 7; i++) await seedConfirmedLk(i, 'mens-challenger', '25.0')
    await seedConfirmedLk(8, 'mens-challenger', '15.0')
    await setPhase('tournament')

    const res = await draw('mens-challenger')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; tooStrong: { id: number; lk: string }[] }
    expect(body.error).toContain('Challenger')
    expect(body.tooStrong).toHaveLength(1)
    expect(body.tooStrong[0]?.lk).toBe('15.0')

    // Nothing written — neither the draw record nor any match row.
    const draws = await env.DB.prepare('SELECT COUNT(*) AS c FROM draws').first<{ c: number }>()
    const matches = await env.DB.prepare('SELECT COUNT(*) AS c FROM matches').first<{ c: number }>()
    expect(draws?.c).toBe(0)
    expect(matches?.c).toBe(0)
  })

  it('draws a within-cap Challenger field and freezes the threshold into the draw record', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmedLk(i, 'mens-challenger', '22.0')
    await setPhase('tournament')

    const res = await draw('mens-challenger')
    expect(res.status).toBe(200)

    const snapshot = await env.DB.prepare('SELECT challenger_min_lk AS cap FROM draws').first<{ cap: number }>()
    expect(snapshot?.cap).toBe(CHALLENGER_MIN_LK)
  })

  it('fails loudly at the store seam on a malformed seeding column (ADR-0009 type-chain hole)', async () => {
    // A stored row whose seeding JSON no longer matches the schema (here: a seed missing playerId/lk).
    // The atomic write makes this unreachable in practice, but if it happens the parse must throw at
    // the store — not surface as a wrong-looking bracket downstream (or, later, on the beamer).
    await env.DB.prepare(
      "INSERT INTO draws (competition, bracket, size, seeding, reveal_sequence, created_at) VALUES ('mens', 'main', 8, '[{\"seed\":1}]', '[]', 'now')"
    ).run()

    const store = createD1DrawStore(env.DB)
    await expect(store.getDraw('mens', 'main')).rejects.toThrow()
  })
})
