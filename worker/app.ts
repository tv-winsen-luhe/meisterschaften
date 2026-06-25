import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import { participantsResponseSchema, type ParticipantsResponse } from '../shared'
import { createD1RegistrationsStore } from './store/registrations'

// The worker's bindings. Explicit `import type` for the Cloudflare types (no ambient
// `/// <reference>`) keeps this module loadable from the client's tsconfig for the
// typed `hc` client without dragging Workers globals into the DOM program.
export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PUBLIC_LIST_ENABLED: string
  ADMIN_TOKEN: string
  // Telegram-Benachrichtigung bei neuen Anmeldungen. Optional: fehlen Token/Chat
  // (z. B. lokal), wird die Benachrichtigung still übersprungen.
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

// GET /api/participants — the public list. Behaviour-preserving: PUBLIC_LIST_ENABLED
// remains the orthogonal kill-switch; "true" = visible, anything else = off.
// Routes are chained off `new Hono()` so `typeof app` carries the route schema for the
// typed `hc` client (a separate `app.get(...)` statement would not be reflected).
export const app = new Hono<{ Bindings: Env }>()
  // Mirror the legacy JSON error envelope so every API route fails the same shape;
  // without this Hono would emit a plain-text 500 for the participants route.
  .onError((err, c) => c.json({ error: 'Serverfehler. Bitte später erneut versuchen.', detail: String(err) }, 500))
  .get('/api/participants', async c => {
    if (c.env.PUBLIC_LIST_ENABLED !== 'true') {
      return c.json({ enabled: false, participants: [] } satisfies ParticipantsResponse, 200, {
        'cache-control': 'no-store'
      })
    }

    const store = createD1RegistrationsStore(c.env.DB)
    const participants = await store.listConfirmed()
    return c.json(participantsResponseSchema.parse({ enabled: true, participants }), 200, {
      'cache-control': 'no-store'
    })
  })

// The typed client (`hc`) derives its route types from this. The catch-all that
// delegates legacy routes is registered in index.ts (the worker entry the client
// never imports), so it stays out of this type.
export type AppType = typeof app
