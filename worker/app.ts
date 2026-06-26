import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodType } from 'zod'
import {
  adminListResponseSchema,
  cancelRegistrationRequestSchema,
  cancelRequestSchema,
  confirmRequestSchema,
  deleteRequestSchema,
  participantsResponseSchema,
  registerRequestSchema,
  setPhaseRequestSchema,
  type CancelRegistrationResponse,
  type ConfirmResponse,
  type DeleteResponse,
  type ParticipantsResponse,
  type PhaseResponse,
  type RefreshLkResponse,
  type SetPhaseResponse
} from '../shared'
import { createD1AppStateStore } from './store/app-state'
import { createD1RegistrationsStore } from './store/registrations'
import { createRegistrationDomain } from './domain/registration'
import { buildSeedingLk, matchAndNotify } from './registration-effects'
import { notifyCancellation } from './notify'

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
  // Telegram notification on new registrations. Optional: if token/chat are missing
  // (e.g. locally), the notification is silently skipped.
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

// ── The validation seam (ADR-0009) ──────────────────────────────────────────────────────
// Three small primitives replace the per-route parse/validate/envelope preamble the legacy
// handlers each repeated. `c.req.valid('json')` is typed from the schema, and AppType now
// carries the request contract so the typed `hc` client checks bodies at build time.
//
// One deliberate behaviour change from the legacy hand-rolled handlers: zValidator reads the
// body only for an `application/json` Content-Type (otherwise it validates `{}` → 400), where
// the legacy code parsed any body unconditionally. Every first-party caller — the public forms
// and the `hc` admin client — sends the header, and requiring it on a JSON API is the standard
// contract, so this is accepted rather than worked around.

// The single owner of the field-error envelope: validate the body against the schema, and on
// failure answer with the first issue's message (legacy parity) under the shared { error }
// shape. Wrapping zValidator preserves its generics, so the route stays typed.
const v = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, 400)
  })

// Parse-guard: a malformed (unparseable) body answers with the same { error } envelope the
// legacy try/catch did — so zValidator never throws an HTTPException into onError (which would
// surface as a 500). It reads first; v() then re-reads the body from Hono's cache.
const parseGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  try {
    await c.req.json()
  } catch {
    return c.json({ error: 'Ungültige Anfrage.' }, 400)
  }
  await next()
}

// Honeypot = parse-guard + trap check, ordered BEFORE validation so a filled trap always wins
// over field errors (legacy behaviour). Bots fill the hidden `website` field → silently
// "succeed"; the success envelope differs per route (register vs cancel), so it is a parameter.
const honeypot =
  (trap: (c: Context<{ Bindings: Env }>) => Response): MiddlewareHandler<{ Bindings: Env }> =>
  async (c, next) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Ungültige Anfrage.' }, 400)
    }
    if (typeof body.website === 'string' && body.website.trim()) return trap(c)
    await next()
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
  // GET /api/phase — the current operator-controlled phase (ADR-0006). Public and outside
  // Access: every surface (the public list, later the draw/live views) reads it at runtime.
  // PUBLIC_LIST_ENABLED stays an orthogonal kill-switch — the phase does not gate the list.
  .get('/api/phase', async c => {
    const phase = await createD1AppStateStore(c.env.DB).getPhase()
    return c.json({ phase } satisfies PhaseResponse, 200, { 'cache-control': 'no-store' })
  })
  // POST /api/register — the registration write path. Thin handler: honeypot + rate-limit
  // (abuse/HTTP concerns) and Zod shape validation at the edge, then the Registration
  // domain owns the transition (revive vs insert, the one-active-entry invariant). The
  // domain returns the persisted row; the edge performs the side effects it implies — the
  // nuLiga LK match + Telegram notification — in the background via waitUntil, never
  // blocking the member's response. (Honeypot order and validation messages preserved.)
  .post(
    '/api/register',
    honeypot(c => c.json({ ok: true })),
    v(registerRequestSchema),
    async c => {
      const store = createD1RegistrationsStore(c.env.DB)
      const ip = c.req.header('cf-connecting-ip') ?? ''
      if (ip) {
        const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
        if ((await store.countRecentByIp(ip, since)) >= RATE_LIMIT)
          return c.json({ error: 'Zu viele Anmeldungen in kurzer Zeit. Bitte versuch es später erneut.' }, 429)
      }

      const { competition, firstName, lastName, club, email, phone, note } = c.req.valid('json')
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

      // The side effect a registration implies — the nuLiga LK match + Telegram — runs in the
      // background (registration-effects.ts owns the composition); the member's response never waits.
      c.executionCtx.waitUntil(matchAndNotify(c.env, buildSeedingLk(store), result.registration))

      return c.json({ ok: true })
    }
  )
  // POST /api/cancel — the self-service withdrawal path. Thin handler: honeypot + Zod shape
  // validation at the edge, then the Registration domain's `cancel` transition withdraws
  // every active entry for the person and returns the affected rows. The edge sends the
  // cancellation Telegram from those rows in the background via waitUntil. (Honeypot order
  // and validation messages preserved from the legacy handler.)
  .post(
    '/api/cancel',
    honeypot(c => c.json({ ok: true, cancelled: 0 })),
    v(cancelRequestSchema),
    async c => {
      const store = createD1RegistrationsStore(c.env.DB)
      const { cancelled } = await createRegistrationDomain(store).cancel(c.req.valid('json'))

      if (cancelled.length > 0) c.executionCtx.waitUntil(notifyCancellation(c.env, cancelled))

      return c.json({ ok: true, cancelled: cancelled.length })
    }
  )
  // ── Admin (operator) routes ───────────────────────────────────────────────────────────
  // Auth is edge-only (ADR-0008): Cloudflare Access gates `/admin` and `/api/admin/*` in
  // production, and `workers_dev = false` leaves the worker no un-gated hostname — so there is
  // deliberately no auth check here. Load-bearing consequence: every operator endpoint MUST live
  // under `/api/admin/*` (the Access destination); a route outside it is born public. Local
  // `wrangler dev` has neither Access nor a token — the admin is simply open on localhost.
  // GET /api/admin/list — every registration for the admin table (camelCase; the response
  // schema strips the internal `ip`, which the legacy list never exposed either).
  .get('/api/admin/list', async c => {
    const registrations = await createD1RegistrationsStore(c.env.DB).listAll()
    return c.json(adminListResponseSchema.parse({ registrations }), 200, { 'cache-control': 'no-store' })
  })
  // POST /api/admin/confirm — apply the operator's field edits and confirm the row. The domain
  // enforces canConfirm (NotConfirmable → 400 with the reason). When a player id was linked, the
  // edge best-effort fetches its current LK from nuLiga (legacy parity; reported as lkFetched).
  .post('/api/admin/confirm', parseGuard, v(confirmRequestSchema), async c => {
    const { id, competition, club, playerId, lk } = c.req.valid('json')
    const store = createD1RegistrationsStore(c.env.DB)
    const result = await createRegistrationDomain(store).confirm(id, { competition, club, playerId, lk })
    if (!result.ok) {
      if (result.error === 'NotFound') return c.json({ error: 'Anmeldung nicht gefunden.' }, 404)
      return c.json({ error: result.reason }, 400)
    }

    let lkFetched: string | null = null
    if (playerId) {
      try {
        const fetched = await buildSeedingLk(store).lkForPlayerId(result.registration.club, playerId)
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
  // POST /api/admin/cancel — operator cancel by id (ADR-0018): records a drop-out the desk was
  // told about, moving the row to the single terminal 'cancelled' state. Distinct from the
  // public self-service /api/cancel (by person) — it sends no member notification, since the
  // operator is the actor. NotFound → 404, mirroring the former hide.
  .post('/api/admin/cancel', parseGuard, v(cancelRegistrationRequestSchema), async c => {
    const result = await createRegistrationDomain(createD1RegistrationsStore(c.env.DB)).cancelById(
      c.req.valid('json').id
    )
    if (!result.ok) return c.json({ error: 'Anmeldung nicht gefunden.' }, 404)
    return c.json({ ok: true } satisfies CancelRegistrationResponse)
  })
  // POST /api/admin/delete — hard-delete a row (no domain rule; a pure Store op).
  .post('/api/admin/delete', parseGuard, v(deleteRequestSchema), async c => {
    const deleted = await createD1RegistrationsStore(c.env.DB).remove(c.req.valid('json').id)
    return c.json({ ok: true, deleted } satisfies DeleteResponse)
  })
  // POST /api/admin/refresh-lk — refresh seeding LK across the roster via seedingLk.syncAll.
  .post('/api/admin/refresh-lk', async c => {
    const seedingLk = buildSeedingLk(createD1RegistrationsStore(c.env.DB))
    return c.json({ ok: true, updated: await seedingLk.syncAll() } satisfies RefreshLkResponse)
  })
  // POST /api/admin/phase — the operator sets the phase (ADR-0006). Zod validates the value;
  // the set is the only transition gate the foundation realises — advancing past 'signup'
  // makes the weekly cron a no-op (it reads this value). Returns the persisted phase.
  .post('/api/admin/phase', parseGuard, v(setPhaseRequestSchema), async c => {
    const { phase } = c.req.valid('json')
    await createD1AppStateStore(c.env.DB).setPhase(phase)
    return c.json({ ok: true, phase } satisfies SetPhaseResponse)
  })
// The typed client (`hc`) derives its route types from this. The catch-all that
// delegates legacy routes is registered in index.ts (the worker entry the client
// never imports), so it stays out of this type.
export type AppType = typeof app
