import type { D1Database, D1Migration } from '@cloudflare/workers-types'

// Bindings provided by vitest.config.ts to the workers test pool.
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database
    PUBLIC_LIST_ENABLED: string
    TEST_MIGRATIONS: D1Migration[]
  }
}
