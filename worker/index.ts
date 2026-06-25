/// <reference types="@cloudflare/workers-types" />

import { app, type Env } from './app'
import { createNuligaRosterSource, createSeedingLk } from './seeding-lk'
import { createD1RegistrationsStore } from './store/registrations'

// The Hono app (worker/app.ts) now owns every route — the public API (participants/register/
// cancel), the admin API (/api/admin/*), and the CSV /export. The catch-all serves the static
// Astro site (incl. the React admin shell) via Workers Assets for everything else.
app.all('*', c => c.env.ASSETS.fetch(c.req.raw))

export default {
  fetch: app.fetch,

  // Weekly LK sync from nuLiga (Monday morning, see wrangler.toml [triggers]): refresh seeding
  // LK across the whole roster via seedingLk.syncAll. (Gating this to the Anmeldung phase is VS5.)
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const seedingLk = createSeedingLk({
      rosterSource: createNuligaRosterSource(),
      store: createD1RegistrationsStore(env.DB)
    })
    ctx.waitUntil(seedingLk.syncAll())
  }
}
