import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import { participantsResponseSchema, registerRequestSchema, type ParticipantsResponse } from '../shared'
import { createD1RegistrationsStore } from './store/registrations'
import { createRegistrationDomain } from './domain/registration'
import { createNuligaRosterSource, createSeedingLk } from './seeding-lk'
import { notifyRegistration } from './notify'

// Soft rate limit: max 3 registrations per IP per hour.
const RATE_LIMIT = 3
const RATE_WINDOW_MS = 3600_000

// The worker's bindings. Explicit `import type` for the Cloudflare types (no ambient
// `/// <reference>`) keeps this module loadable from the client's tsconfig for the
// typed `hc` client without dragging Workers globals into the DOM program.
export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PUBLIC_LIST_ENABLED: string
  ADMIN_TOKEN: string
  // Telegram notification on new registrations. Optional: if token/chat are missing
  // (e.g. locally), the notification is silently skipped.
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
  // POST /api/register — the registration write path. Thin handler: honeypot + rate-limit
  // (abuse/HTTP concerns) and Zod shape validation at the edge, then the Registration
  // domain owns the transition (revive vs insert, the one-active-entry invariant). The
  // domain returns the persisted row; the edge performs the side effects it implies — the
  // nuLiga LK match + Telegram notification — in the background via waitUntil, never
  // blocking the member's response. (Honeypot order and validation messages preserved.)
  .post('/api/register', async c => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Ungültige Anfrage.' }, 400)
    }

    // Honeypot: bots fill the hidden field → silently "succeed" (checked before validation,
    // as the legacy handler did, so a filled trap always wins over field errors).
    if (typeof body.website === 'string' && body.website.trim()) return c.json({ ok: true })

    const parsed = registerRequestSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, 400)

    const store = createD1RegistrationsStore(c.env.DB)
    const ip = c.req.header('cf-connecting-ip') ?? ''
    if (ip) {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
      if ((await store.countRecentByIp(ip, since)) >= RATE_LIMIT)
        return c.json({ error: 'Zu viele Anmeldungen in kurzer Zeit. Bitte versuch es später erneut.' }, 429)
    }

    const { competition, firstName, lastName, club, email, phone, note } = parsed.data
    const result = await createRegistrationDomain(store).register({
      competition,
      firstName,
      lastName,
      club,
      email,
      phone,
      note,
      ip: ip || null,
      now: new Date().toISOString()
    })

    if (!result.ok) return c.json({ error: 'Du bist für diese Konkurrenz bereits angemeldet.' }, 409)

    const reg = result.registration
    const seedingLk = createSeedingLk({ rosterSource: createNuligaRosterSource(), store })
    c.executionCtx.waitUntil(
      (async () => {
        let { lk } = reg
        try {
          lk = await seedingLk.matchOnRegister(reg)
        } catch {
          // nuLiga unreachable etc. → notify without an LK
        }
        await notifyRegistration(c.env, { ...reg, lk })
      })()
    )

    return c.json({ ok: true })
  })

// The typed client (`hc`) derives its route types from this. The catch-all that
// delegates legacy routes is registered in index.ts (the worker entry the client
// never imports), so it stays out of this type.
export type AppType = typeof app
