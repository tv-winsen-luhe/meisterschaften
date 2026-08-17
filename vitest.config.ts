import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Read the deployed cron triggers out of wrangler.toml at config time (Node context, fs works
// here — same trick as readD1Migrations) so cron-trigger.test.ts can assert on them from inside
// the workerd pool, where the filesystem is sandboxed away.
const readCrons = (): string[] => {
  const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8')
  const match = toml.match(/crons\s*=\s*\[([^\]]*)\]/)
  if (!match) throw new Error('no [triggers] crons entry found in wrangler.toml')
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
}

// Integration tests run on the real workerd runtime (@cloudflare/vitest-pool-workers)
// with a local D1. The drizzle-kit migrations are read once and exposed as the
// TEST_MIGRATIONS binding so tests can apply them with `applyD1Migrations`.
// (0.16+ API: the pool is configured via the `cloudflareTest` Vite plugin rather than
// the old `defineWorkersConfig` + `poolOptions.workers`.)
// Run the offline rotation script here in the Node context (workerd has no child_process) and hand its
// printed sheet to the test as a binding — the same config-time trick as readCrons. The script carries its
// own copy of the mixer's court rule because it is plain Node with no build step (ADR-0064), and this is
// what stops that copy drifting: the test compares the columns it prints against `socialMixerCourts`. Two
// head-counts, so both the two-court and the three-court shape are pinned rather than one point of a rule.
const readRotationSheet = (players: number): string =>
  execFileSync('node', [new URL('./scripts/social-mixer-rotation.mjs', import.meta.url).pathname, `--n=${players}`], {
    encoding: 'utf8'
  })

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations('./worker/migrations')
      return {
        miniflare: {
          compatibilityDate: '2025-06-01',
          d1Databases: ['DB'],
          bindings: {
            PUBLIC_LIST_ENABLED: 'true',
            TEST_MIGRATIONS: migrations,
            TEST_CRONS: readCrons(),
            TEST_ROTATION_SHEETS: { 9: readRotationSheet(9), 12: readRotationSheet(12) }
          }
        }
      }
    })
  ]
})
