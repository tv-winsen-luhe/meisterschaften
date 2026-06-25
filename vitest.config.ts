import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Integration tests run on the real workerd runtime (@cloudflare/vitest-pool-workers)
// with a local D1. The drizzle-kit migrations are read once and exposed as the
// TEST_MIGRATIONS binding so tests can apply them with `applyD1Migrations`.
// (0.16+ API: the pool is configured via the `cloudflareTest` Vite plugin rather than
// the old `defineWorkersConfig` + `poolOptions.workers`.)
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
            TEST_MIGRATIONS: migrations
          }
        }
      }
    })
  ]
})
