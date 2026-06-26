import { defineConfig } from 'drizzle-kit'

// Migrations are generated from the Drizzle schema and applied by wrangler
// (`wrangler d1 migrations apply`, see wrangler.toml `migrations_dir`). The flat
// `NNNN_name.sql` output drizzle-kit produces is exactly what wrangler consumes.
export default defineConfig({
  dialect: 'sqlite',
  schema: './worker/db/schema.ts',
  out: './worker/migrations'
})
