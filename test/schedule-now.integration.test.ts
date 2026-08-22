import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { scheduleResponseSchema } from '../shared'
import { app } from '../worker/app'

// The server says what time it is (ADR-0081): GET /api/schedule carries `now`, an ISO instant, and it is the
// **only** clock the public schedule admits. The page turns it into the Current event day and leads with
// that day's section; a feed without it leaves the schedule in plain chronological order.
//
// It rides this wire — the one that carries the days — rather than /api/phase, which carries operator-set
// state (phase, cancelled fields, mixer, suspension) and no wall clock.
//
// Its own file, like schedule-publish.integration.test.ts: one concern per file, both under the line cap.

const req = (path: string) => app.request(path, {}, env)

const feed = async () => scheduleResponseSchema.parse(await (await req('/api/schedule')).json())

describe('GET /api/schedule · the server says what time it is (ADR-0081)', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
    await env.DB.exec('DELETE FROM matches')
  })

  it('carries this request’s clock, not a baked-in constant', () => {
    const before = Date.now()
    return feed().then(served => {
      const after = Date.now()
      expect(served.now).toBeTypeOf('string')
      const at = new Date(served.now ?? '').getTime()
      expect(Number.isNaN(at)).toBe(false)
      expect(at).toBeGreaterThanOrEqual(before - 1000)
      expect(at).toBeLessThanOrEqual(after + 1000)
    })
  })

  it('says it on an empty plan too', async () => {
    // The state the page spends most of its life in. „Welcher Tag ist heute" is true before a single match
    // is on the grid — the mixer band heads its own day whether or not anything is placed.
    const served = await feed()
    expect(served.matches).toEqual([])
    expect(served.now).toBeTypeOf('string')
  })
})
