import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import {
  adminListResponseSchema,
  cancelRequestSchema,
  confirmRequestSchema,
  deleteRequestSchema,
  hideRequestSchema,
  participantsResponseSchema,
  registerRequestSchema,
  type ConfirmResponse,
  type DeleteResponse,
  type HideResponse,
  type ParticipantsResponse,
  type RefreshLkResponse
} from '../shared'
import { createD1RegistrationsStore } from './store/registrations'
import { createRegistrationDomain } from './domain/registration'
import { createNuligaRosterSource, createSeedingLk } from './seeding-lk'
import { notifyCancellation, notifyRegistration } from './notify'

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
  // POST /api/cancel — the self-service withdrawal path. Thin handler: honeypot + Zod shape
  // validation at the edge, then the Registration domain's `cancel` transition withdraws
  // every active entry for the person and returns the affected rows. The edge sends the
  // cancellation Telegram from those rows in the background via waitUntil. (Honeypot order
  // and validation messages preserved from the legacy handler.)
  .post('/api/cancel', async c => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Ungültige Anfrage.' }, 400)
    }

    // Honeypot: bots fill the hidden field → silently "succeed" with nothing cancelled.
    if (typeof body.website === 'string' && body.website.trim()) return c.json({ ok: true, cancelled: 0 })

    const parsed = cancelRequestSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, 400)

    const store = createD1RegistrationsStore(c.env.DB)
    const { cancelled } = await createRegistrationDomain(store).cancel(parsed.data)

    if (cancelled.length > 0) c.executionCtx.waitUntil(notifyCancellation(c.env, cancelled))

    return c.json({ ok: true, cancelled: cancelled.length })
  })
  // ── Admin (operator) routes ───────────────────────────────────────────────────────────
  // In production these sit behind Cloudflare Access (email-OTP, ADR-0008); the x-admin-token
  // check is the active gate for `wrangler dev` (Access does not apply locally) and a harmless
  // second factor in prod. (The Access-header bypass is deferred until VS6 configures Access —
  // adding it before /api/admin/* is Access-protected would let a client spoof the header.)
  .use('/api/admin/*', async (c, next) => {
    const token = c.req.header('x-admin-token') ?? ''
    if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) return c.json({ error: 'Nicht autorisiert.' }, 401)
    await next()
  })
  // GET /api/admin/list — every registration for the admin table (camelCase; the response
  // schema strips the internal `ip`, which the legacy list never exposed either).
  .get('/api/admin/list', async c => {
    const registrations = await createD1RegistrationsStore(c.env.DB).listAll()
    return c.json(adminListResponseSchema.parse({ registrations }), 200, { 'cache-control': 'no-store' })
  })
  // POST /api/admin/confirm — apply the operator's field edits and confirm the row. The domain
  // enforces canConfirm (NotConfirmable → 400 with the reason). When a player id was linked, the
  // edge best-effort fetches its current LK from nuLiga (legacy parity; reported as lkFetched).
  .post('/api/admin/confirm', async c => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Ungültige Anfrage.' }, 400)
    }

    const parsed = confirmRequestSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, 400)

    const { id, competition, club, playerId, lk } = parsed.data
    const store = createD1RegistrationsStore(c.env.DB)
    const result = await createRegistrationDomain(store).confirm(id, { competition, club, playerId, lk })
    if (!result.ok) {
      if (result.error === 'NotFound') return c.json({ error: 'Anmeldung nicht gefunden.' }, 404)
      return c.json({ error: result.reason }, 400)
    }

    let lkFetched: string | null = null
    if (playerId) {
      try {
        const seedingLk = createSeedingLk({ rosterSource: createNuligaRosterSource(), store })
        const fetched = await seedingLk.lkForPlayerId(result.registration.club, playerId)
        if (fetched) {
          await store.setLk(id, fetched)
          lkFetched = fetched
        }
      } catch {
        // nuLiga unreachable → keep the operator-entered LK; no LK reported.
      }
    }

    return c.json({ ok: true, lkFetched } satisfies ConfirmResponse)
  })
  // POST /api/admin/hide — move a row to 'hidden' (drops it from the public list).
  .post('/api/admin/hide', async c => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Ungültige Anfrage.' }, 400)
    }

    const parsed = hideRequestSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, 400)

    const result = await createRegistrationDomain(createD1RegistrationsStore(c.env.DB)).hide(parsed.data.id)
    if (!result.ok) return c.json({ error: 'Anmeldung nicht gefunden.' }, 404)
    return c.json({ ok: true } satisfies HideResponse)
  })
  // POST /api/admin/delete — hard-delete a row (no domain rule; a pure Store op).
  .post('/api/admin/delete', async c => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Ungültige Anfrage.' }, 400)
    }

    const parsed = deleteRequestSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, 400)

    const deleted = await createD1RegistrationsStore(c.env.DB).remove(parsed.data.id)
    return c.json({ ok: true, deleted } satisfies DeleteResponse)
  })
  // POST /api/admin/refresh-lk — refresh seeding LK across the roster via seedingLk.syncAll.
  .post('/api/admin/refresh-lk', async c => {
    const seedingLk = createSeedingLk({
      rosterSource: createNuligaRosterSource(),
      store: createD1RegistrationsStore(c.env.DB)
    })
    return c.json({ ok: true, updated: await seedingLk.syncAll() } satisfies RefreshLkResponse)
  })
  // GET /export — operator CSV of every registration. A separate operator-facing artifact:
  // it stays snake_case (decoupled from the camelCase contract) and authorises via a query
  // token, since it is opened as a plain link/new tab where headers cannot be set.
  .get('/export', async c => {
    const token = c.req.query('token') ?? ''
    if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) return c.text('Nicht autorisiert.', 401)

    const rows = (await createD1RegistrationsStore(c.env.DB).listAll())
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const cols: [string, (r: (typeof rows)[number]) => unknown][] = [
      ['id', r => r.id],
      ['created_at', r => r.createdAt],
      ['competition', r => r.competition],
      ['first_name', r => r.firstName],
      ['last_name', r => r.lastName],
      ['club', r => r.club],
      ['email', r => r.email],
      ['phone', r => r.phone],
      ['note', r => r.note],
      ['player_id', r => r.playerId],
      ['lk', r => r.lk],
      ['status', r => r.status]
    ]
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = cols.map(([name]) => name).join(',')
    const body = rows.map(r => cols.map(([, get]) => esc(get(r))).join(',')).join('\n')
    const csv = '﻿' + [header, body].filter(Boolean).join('\n')

    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="anmeldungen-winsener-meisterschaften.csv"',
      'cache-control': 'no-store'
    })
  })

// The typed client (`hc`) derives its route types from this. The catch-all that
// delegates legacy routes is registered in index.ts (the worker entry the client
// never imports), so it stays out of this type.
export type AppType = typeof app
