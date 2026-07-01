import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { scheduleResponseSchema } from '../shared'
import { app } from '../worker/app'

// Result entry + bracket advancement (#90), end-to-end over a real local D1: the status transition (with
// the actual court), the result write (winner advances, semifinal loser drops to the third-place playoff),
// the correction cascade, and the opportunistic per-set save. The pure transform is covered in
// draw.test.ts and the store seam in store.test.ts; here we prove the HTTP wiring and the persistence.

const JSON_HEADERS = { 'content-type': 'application/json' }
const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)
const post = (path: string, body: unknown) =>
  req(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })

const seedConfirmed = (i: number) =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
     VALUES (?, 'mens', ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
  )
    .bind(`2026-06-0${i}T10:00:00Z`, `P${i}`, `Player${i}`, `p${i}@x.de`, `${i}.0`)
    .run()

const revealFully = async () => {
  let r = { cursor: 0, total: Number.POSITIVE_INFINITY }
  do {
    const res = await post('/api/admin/draw/advance', { competition: 'mens', direction: 'forward' })
    r = (await res.json()) as { cursor: number; total: number }
  } while (r.cursor < r.total)
}

// Draw a 4-field over D1 (two semifinals + final + third-place playoff), revealed fully so the public feed
// will serve placed matches (ADR-0036).
const drawField = async () => {
  for (let i = 1; i <= 4; i++) await seedConfirmed(i)
  await post('/api/admin/phase', { phase: 'tournament' })
  await post('/api/admin/draw', { competition: 'mens' })
  await revealFully()
}

// The match rows by their bracket coordinates, so a test names „the first semifinal" not a raw id.
interface Row {
  id: number
  slot1_reg_id: number | null
  slot2_reg_id: number | null
  winner_reg_id: number | null
  outcome: string | null
  status: string
  live_court: number | null
  third_place: number
  set1_slot1: number | null
  set1_slot2: number | null
  mtb_slot1: number | null
  mtb_slot2: number | null
}
const rowAt = (round: number, position: number) =>
  env.DB.prepare('SELECT * FROM matches WHERE round = ? AND position = ?').bind(round, position).first<Row>()

describe('POST /api/admin/match/{status,result,set} (#90)', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  it('marks a match läuft and captures the actual court, defaulting to the planned court', async () => {
    await drawField()
    const semi = (await rowAt(1, 0))!
    await post('/api/admin/match/place', { id: semi.id, placement: { court: 2, day: 0, slot: 0 } })

    // No explicit court → falls back to the planned court (2).
    expect((await post('/api/admin/match/status', { id: semi.id, status: 'running' })).status).toBe(200)
    expect(await rowAt(1, 0)).toMatchObject({ status: 'running', live_court: 2 })

    // An explicit court overrides — the match moved to a freed court 5.
    await post('/api/admin/match/status', { id: semi.id, status: 'running', liveCourt: 5 })
    expect(await rowAt(1, 0)).toMatchObject({ status: 'running', live_court: 5 })
  })

  it('records a completed result, advancing the winner to the final and the loser to the third-place playoff', async () => {
    await drawField()
    const semi = (await rowAt(1, 0))!
    const res = await post('/api/admin/match/result', {
      id: semi.id,
      winner: 1,
      outcome: null,
      score: { set1: [6, 3], set2: [6, 4], mtb: null }
    })
    expect(res.status).toBe(200)

    const decided = (await rowAt(1, 0))!
    expect(decided).toMatchObject({ winner_reg_id: semi.slot1_reg_id, status: 'done', set1_slot1: 6, set1_slot2: 3 })
    // The winner advances into the final's slot 1, the loser into the third-place playoff's slot 1.
    expect((await rowAt(2, 0))!.slot1_reg_id).toBe(semi.slot1_reg_id)
    const third = (await rowAt(2, 1))!
    expect(third.third_place).toBe(1)
    expect(third.slot1_reg_id).toBe(semi.slot2_reg_id)
  })

  it('records a retirement with a Match-Tie-Break score', async () => {
    await drawField()
    const semi = (await rowAt(1, 1))!
    await post('/api/admin/match/result', {
      id: semi.id,
      winner: 2,
      outcome: 'retirement',
      score: { set1: [6, 0], set2: [3, 6], mtb: [10, 7] }
    })
    expect(await rowAt(1, 1)).toMatchObject({
      winner_reg_id: semi.slot2_reg_id,
      outcome: 'retirement',
      status: 'done',
      mtb_slot1: 10,
      mtb_slot2: 7
    })
  })

  it('cascade-clears the dependent final when a semifinal winner is corrected', async () => {
    await drawField()
    const semi1 = (await rowAt(1, 0))!
    const semi2 = (await rowAt(1, 1))!
    // Resolve both semis and the final.
    await post('/api/admin/match/result', {
      id: semi1.id,
      winner: 1,
      outcome: null,
      score: { set1: [6, 0], set2: [6, 0], mtb: null }
    })
    await post('/api/admin/match/result', {
      id: semi2.id,
      winner: 1,
      outcome: null,
      score: { set1: [6, 0], set2: [6, 0], mtb: null }
    })
    const final = (await rowAt(2, 0))!
    await post('/api/admin/match/result', {
      id: final.id,
      winner: 1,
      outcome: null,
      score: { set1: [6, 4], set2: [6, 4], mtb: null }
    })
    expect((await rowAt(2, 0))!.status).toBe('done')

    // Correct semifinal 1: the winner flips to slot 2. The final consumed the old winner, so it clears.
    await post('/api/admin/match/result', {
      id: semi1.id,
      winner: 2,
      outcome: null,
      score: { set1: [4, 6], set2: [4, 6], mtb: null }
    })
    expect((await rowAt(1, 0))!.winner_reg_id).toBe(semi1.slot2_reg_id)
    const cleared = (await rowAt(2, 0))!
    expect(cleared).toMatchObject({
      slot1_reg_id: semi1.slot2_reg_id,
      winner_reg_id: null,
      status: 'planned',
      set1_slot1: null
    })
  })

  it('saves a single set opportunistically without resolving the match', async () => {
    await drawField()
    const semi = (await rowAt(1, 0))!
    expect((await post('/api/admin/match/set', { id: semi.id, set: 1, score: [6, 3] })).status).toBe(200)
    expect(await rowAt(1, 0)).toMatchObject({ set1_slot1: 6, set1_slot2: 3, winner_reg_id: null, status: 'planned' })
  })

  it('serves the actual (live) court on the public schedule once a match is running (ADR-0032)', async () => {
    await drawField()
    const semi = (await rowAt(1, 0))!
    await post('/api/admin/match/place', { id: semi.id, placement: { court: 2, day: 0, slot: 0 } })
    await post('/api/admin/match/status', { id: semi.id, status: 'running', liveCourt: 5 })

    const feed = scheduleResponseSchema.parse(await (await req('/api/schedule')).json())
    const row = feed.matches.find(m => m.id === semi.id)!
    // The planned court was 2; the public board points at the actual court 5 — never a stale planned court.
    expect(row).toMatchObject({ court: 5, status: 'running' })
  })

  it('marks the third-place playoff on the public schedule wire so it is not mislabeled „Finale" (#90)', async () => {
    await drawField()
    const third = (await rowAt(2, 1))! // the third-place playoff shares the final's round
    expect(third.third_place).toBe(1)
    await post('/api/admin/match/place', { id: third.id, placement: { court: 6, day: 1, slot: 0 } })
    await post('/api/admin/schedule/publish', {})

    const feed = scheduleResponseSchema.parse(await (await req('/api/schedule')).json())
    const row = feed.matches.find(m => m.id === third.id)!
    // The wire carries the flag, so the page labels it „Spiel um Platz 3" instead of deriving „Finale" from
    // round === totalRounds; the real final (round 2, position 0) carries thirdPlace false.
    expect(row.thirdPlace).toBe(true)
  })

  it('rejects a result on a match whose two players are not both known (400)', async () => {
    await drawField()
    const final = (await rowAt(2, 0))! // its feeders (the semis) are undecided
    const res = await post('/api/admin/match/result', {
      id: final.id,
      winner: 1,
      outcome: null,
      score: { set1: [6, 0], set2: [6, 0], mtb: null }
    })
    expect(res.status).toBe(400)
  })

  it('404s a result for an unknown match', async () => {
    await drawField()
    const res = await post('/api/admin/match/result', {
      id: 99999,
      winner: 1,
      outcome: null,
      score: { set1: [6, 0], set2: [6, 0], mtb: null }
    })
    expect(res.status).toBe(404)
  })
})
