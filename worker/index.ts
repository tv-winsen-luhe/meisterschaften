/// <reference types="@cloudflare/workers-types" />

import { app, type Env } from './app'
import { createDepsFromEnv } from './deps'

// The Hono app (worker/app.ts) now owns every route — the public API (participants/register/
// cancel) and the admin API (/api/admin/*). The catch-all serves the static Astro site (incl.
// the React admin shell) via Workers Assets for everything else.
app.all('*', c => c.env.ASSETS.fetch(c.req.raw))

export default {
  fetch: app.fetch,

  // Weekly LK sync from nuLiga (Monday morning, see wrangler.toml [triggers]): refresh seeding
  // LK across the whole roster via seedingLk.syncAll. Gated to the signup phase (ADR-0006):
  // once the draw snapshots LK at draw time, seeding is frozen, so outside signup the sync
  // is a no-op — no suppression flag, just this one phase read.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const deps = createDepsFromEnv(env)
        if ((await deps.appState.getPhase()) !== 'signup') return
        await deps.seedingLk.syncAll()
      })()
    )
  }
}
