import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

// Guards the weekly LK-sync cron in wrangler.toml against a real footgun (see the [triggers]
// comment there): Cloudflare's cron day-of-week is NON-standard — 1 = Sunday, 2 = Monday, …
// 7 = Saturday — unlike Unix cron where 1 = Monday. The trigger once read "0 10 * * 1", meant
// as Monday but firing every Sunday (a day before nuLiga's Monday LK update, so always stale).
// This asserts the sync resolves to Monday under Cloudflare's scheme, so re-introducing the
// numeric "1" (or any non-Monday day) fails loudly here. wrangler.toml is read at config time
// and injected as the TEST_CRONS binding (the workerd pool has no filesystem access).

// Cloudflare's day-of-week indexing (docs: "1 = Sunday to 7 = Saturday"), plus the case-insensitive
// three-letter aliases Cloudflare recommends to sidestep the ambiguity. Values map to 0 = Sunday.
const CLOUDFLARE_DAY_OF_WEEK: Record<string, number> = {
  '1': 0,
  sun: 0,
  '2': 1,
  mon: 1,
  '3': 2,
  tue: 2,
  '4': 3,
  wed: 3,
  '5': 4,
  thu: 4,
  '6': 5,
  fri: 5,
  '7': 6,
  sat: 6
}
const MONDAY = 1

const crons = env.TEST_CRONS as string[]

describe('wrangler.toml LK-sync cron trigger', () => {
  it('has exactly one weekly cron', () => {
    expect(crons).toHaveLength(1)
  })

  it('fires on Monday under Cloudflare non-standard day-of-week indexing, never Sunday', () => {
    const dayOfWeekField = crons[0].trim().split(/\s+/)[4]
    const dayOfWeek = CLOUDFLARE_DAY_OF_WEEK[dayOfWeekField.toLowerCase()]

    expect(dayOfWeek, `unrecognised day-of-week field "${dayOfWeekField}"`).toBeDefined()
    // The bug: numeric "1" is Sunday on Cloudflare — the exact regression to catch.
    expect(dayOfWeekField).not.toBe('1')
    expect(dayOfWeek).toBe(MONDAY)
  })
})
