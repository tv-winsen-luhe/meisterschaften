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
  drawRequestSchema,
  drawsResponseSchema,
  participantsResponseSchema,
  registerRequestSchema,
  setPhaseRequestSchema,
  undrawRequestSchema,
  type BackToSignupResponse,
  type CancelRegistrationResponse,
  type ConfirmResponse,
  type DeleteResponse,
  type DrawResponse,
  type ParticipantsResponse,
  type PhaseResponse,
  type ReadmitResponse,
  type RefreshLkResponse,
  type ResetCapabilityResponse,
  type SetPhaseResponse,
  type UndrawResponse
} from '../shared'
import { createDepsFromEnv, type Deps } from './deps'
import { matchAndNotify } from './registration-effects'
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
  // Debug-only reset levers (ADR-0029). Absent in production: the reset routes exist only when this
  // is exactly "true" (set in .dev.vars locally, toggled on the deployed instance during the
  // pre-event test window and removed before go-live). Unset ⇒ the capability does not exist.
  RESET_ENABLED?: string
}

// The per-request context variables. The dependency bundle (ADR-0030) is set once by the `/api/*`
// middleware in createApp; a named interface because the lint rule forbids inline object types.
interface AppVariables {
  deps: Deps
}

// Hono's env shape wraps the bindings under `Bindings`. Named so the generic is referenced
// rather than inlined (`Hono<AppEnv>` not `Hono<{ Bindings: Env }>`) — see the no-inline-object
// lint rule, which forbids the inline form in type position.
interface AppEnv {
  Bindings: Env
  Variables: AppVariables
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
const parseGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
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
  (trap: (c: Context<AppEnv>) => Response): MiddlewareHandler<AppEnv> =>
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

// Debug-reset gate (ADR-0029): the reset routes exist only when RESET_ENABLED is exactly "true".
// Absent/anything-else ⇒ 403, so the capability simply does not exist in production. This is the
// server-side authority; the admin's Debug surface only mirrors the flag for affordance. Ordered
// before parsing/validation so a disabled environment refuses before reading the body.
const resetGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.RESET_ENABLED !== 'true') return c.json({ error: 'Reset ist in dieser Umgebung deaktiviert.' }, 403)
  await next()
}

// The app is built from a factory so its dependencies are injectable (ADR-0030). Production passes the
// default `createDepsFromEnv` (D1 + crypto + nuLiga); a test passes `() => createDeps(fakeAdapters)` to
// drive any route over the in-memory adapters at the HTTP seam. `makeDeps` is a function of env because
// `env.DB` exists only per request in Workers — never at module load.
//
// Routes are chained off `new Hono()` so `typeof app` carries the route schema for the typed `hc`
// client (a separate `app.get(...)` statement would not be reflected).
export const createApp = (makeDeps: (env: Env) => Deps = createDepsFromEnv) =>
  new Hono<AppEnv>()
    // Mirror the legacy JSON error envelope so every API route fails the same shape;
    // without this Hono would emit a plain-text 500 for the participants route.
    .onError((err, c) => c.json({ error: 'Serverfehler. Bitte später erneut versuchen.', detail: String(err) }, 500))
    // The single place a request acquires its dependencies (ADR-0030): build the bundle once per
    // request and hang it on the context. Scoped to `/api/*` — the catch-all asset route needs nothing.
    .use('/api/*', async (c, next) => {
      c.set('deps', makeDeps(c.env))
      await next()
    })
    // GET /api/participants — the public list. Behaviour-preserving: PUBLIC_LIST_ENABLED
    // remains the orthogonal kill-switch; "true" = visible, anything else = off.
    .get('/api/participants', async c => {
      if (c.env.PUBLIC_LIST_ENABLED !== 'true') {
        return c.json({ enabled: false, participants: [] } satisfies ParticipantsResponse, 200, {
          'cache-control': 'no-store'
        })
      }

      const participants = await c.var.deps.registrations.listConfirmed()
      return c.json(participantsResponseSchema.parse({ enabled: true, participants }), 200, {
        'cache-control': 'no-store'
      })
    })
    // GET /api/phase — the current operator-controlled phase (ADR-0006). Public and outside
    // Access: every surface (the public list, later the draw/live views) reads it at runtime.
    // PUBLIC_LIST_ENABLED stays an orthogonal kill-switch — the phase does not gate the list.
    .get('/api/phase', async c => {
      const phase = await c.var.deps.appState.getPhase()
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
        const { registrations, registrationDomain, seedingLk } = c.var.deps
        const ip = c.req.header('cf-connecting-ip') ?? ''
        if (ip) {
          const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
          if ((await registrations.countRecentByIp(ip, since)) >= RATE_LIMIT)
            return c.json({ error: 'Zu viele Anmeldungen in kurzer Zeit. Bitte versuch es später erneut.' }, 429)
        }

        const { competition, firstName, lastName, club, email, phone, note } = c.req.valid('json')
        const result = await registrationDomain.register({
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
        c.executionCtx.waitUntil(matchAndNotify(c.env, seedingLk, result.registration))

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
        const { cancelled } = await c.var.deps.registrationDomain.cancel(c.req.valid('json'))

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
      const registrations = await c.var.deps.registrations.listAll()
      return c.json(adminListResponseSchema.parse({ registrations }), 200, { 'cache-control': 'no-store' })
    })
    // POST /api/admin/confirm — apply the operator's field edits and confirm the row. The domain
    // enforces canConfirm (NotConfirmable → 400 with the reason). When a player id was linked, the
    // edge best-effort fetches its current LK from nuLiga (legacy parity; reported as lkFetched).
    .post('/api/admin/confirm', parseGuard, v(confirmRequestSchema), async c => {
      const { id, competition, club, playerId, noId } = c.req.valid('json')
      const result = await c.var.deps.registrationDomain.confirm(id, { competition, club, playerId, noId })
      if (!result.ok) {
        if (result.error === 'NotFound') return c.json({ error: 'Anmeldung nicht gefunden.' }, 404)
        return c.json({ error: result.reason }, 400)
      }

      // The LK is derived (ADR-0020): when a player id was linked, seedingLk fetches its current
      // nuLiga rating and stores it, returning the fetched value (null on a miss/outage) for the
      // operator toast. The no-id path already stored the default in the domain. The swallow +
      // never-clobber rules live inside the orchestration — a sibling of matchOnRegister.
      const lkFetched = await c.var.deps.seedingLk.resolveLkOnConfirm(result.registration)

      return c.json({ ok: true, lkFetched } satisfies ConfirmResponse)
    })
    // POST /api/admin/cancel — operator cancel by id (ADR-0018): records a drop-out the desk was
    // told about, moving the row to the single terminal 'cancelled' state. Distinct from the
    // public self-service /api/cancel (by person) — it sends no member notification, since the
    // operator is the actor. NotFound → 404, mirroring the former hide.
    .post('/api/admin/cancel', parseGuard, v(cancelRegistrationRequestSchema), async c => {
      const result = await c.var.deps.registrationDomain.cancelById(c.req.valid('json').id)
      if (!result.ok) return c.json({ error: 'Anmeldung nicht gefunden.' }, 404)
      return c.json({ ok: true } satisfies CancelRegistrationResponse)
    })
    // POST /api/admin/delete — hard-delete a row (no domain rule; a pure Store op).
    .post('/api/admin/delete', parseGuard, v(deleteRequestSchema), async c => {
      const deleted = await c.var.deps.registrations.remove(c.req.valid('json').id)
      return c.json({ ok: true, deleted } satisfies DeleteResponse)
    })
    // POST /api/admin/refresh-lk — refresh seeding LK across the roster via seedingLk.syncAll.
    .post('/api/admin/refresh-lk', async c => {
      return c.json({ ok: true, updated: await c.var.deps.seedingLk.syncAll() } satisfies RefreshLkResponse)
    })
    // POST /api/admin/phase — the operator sets the phase (ADR-0006). Zod validates the value;
    // the set is the only transition gate the foundation realises — advancing past 'signup'
    // makes the weekly cron a no-op (it reads this value). Returns the persisted phase.
    .post('/api/admin/phase', parseGuard, v(setPhaseRequestSchema), async c => {
      const { phase } = c.req.valid('json')
      await c.var.deps.appState.setPhase(phase)
      return c.json({ ok: true, phase } satisfies SetPhaseResponse)
    })
    // GET /api/admin/draws — every drawn competition (main bracket). The competitions surface (UI: „Konkurrenzen")
    // combines this with the admin list it already holds to derive each field's lifecycle (ADR-0027).
    .get('/api/admin/draws', async c => {
      const draws = await c.var.deps.draws.listDraws()
      return c.json(drawsResponseSchema.parse({ draws }), 200, { 'cache-control': 'no-store' })
    })
    // POST /api/admin/draw — the „Jetzt auslosen" action (ADR-0025). The draw service guards the
    // preconditions (phase = tournament, not yet drawn, supported size), computes the bracket with crypto
    // randomness, and writes the matches + draw record atomically. A failed guard maps to 400/409 with
    // the operator-facing reason; the gate values (AlreadyDrawn → 409) match the HTTP semantics.
    .post('/api/admin/draw', parseGuard, v(drawRequestSchema), async c => {
      const phase = await c.var.deps.appState.getPhase()
      const { competition, challengerMinLk } = c.req.valid('json')
      const result = await c.var.deps.drawService.draw({
        competition,
        phase,
        challengerMinLk,
        now: new Date().toISOString()
      })
      if (!result.ok) {
        // AlreadyDrawn is a conflict (409); every other guard — including a too-strong Challenger field
        // (ADR-0024) — is a precondition the operator must fix first (400). The reason carries the count
        // and threshold (the toast the shell shows today); the too-strong entries ride along in the body
        // for a surface that wants to list the offenders by id.
        const status = result.error === 'AlreadyDrawn' ? 409 : 400
        return c.json({ error: result.reason, ...(result.tooStrong ? { tooStrong: result.tooStrong } : {}) }, status)
      }
      return c.json({ ok: true, draw: result.draw } satisfies DrawResponse)
    })
    // ── Debug-only reset (ADR-0029) ─────────────────────────────────────────────────────────
    // Three flag-gated levers that reverse the forward transitions the model treats as final (the
    // draw — ADR-0026/0027 — and confirm). Under `/api/admin/*` like every operator route (ADR-0008's
    // born-public invariant has no debug exception), behind Cloudflare Access, AND behind RESET_ENABLED
    // (resetGuard). Not an operator feature — the flag retires it for the live event.
    //
    // GET /api/admin/reset — report the flag so the admin's Debug surface knows to render itself. Not
    // flag-gated (it answers `enabled: false` when off); behind Access like every admin read.
    .get('/api/admin/reset', async c =>
      c.json({ enabled: c.env.RESET_ENABLED === 'true' } satisfies ResetCapabilityResponse, 200, {
        'cache-control': 'no-store'
      })
    )
    // POST /api/admin/reset/undraw — tear down one competition's draw (record + matches), returning it
    // to „not drawn". Idempotent: an undrawn field reports undrawn: 0, not an error.
    .post('/api/admin/reset/undraw', resetGuard, parseGuard, v(undrawRequestSchema), async c => {
      const { undrawn } = await c.var.deps.resetService.undraw(c.req.valid('json').competition)
      return c.json({ ok: true, undrawn } satisfies UndrawResponse)
    })
    // POST /api/admin/reset/readmit — move every confirmed entry back to new. Guarded: refused (409)
    // while any draw still references confirmed entries (undraw / back-to-signup first). No body.
    .post('/api/admin/reset/readmit', resetGuard, async c => {
      const result = await c.var.deps.resetService.readmit()
      if (!result.ok) return c.json({ error: result.reason }, 409)
      return c.json({ ok: true, readmitted: result.readmitted } satisfies ReadmitResponse)
    })
    // POST /api/admin/reset/back-to-signup — cascade an undraw of all competitions, then set the phase
    // to signup. Leaves registration status untouched (confirmed is valid during signup). No body.
    .post('/api/admin/reset/back-to-signup', resetGuard, async c => {
      const { undrawn } = await c.var.deps.resetService.backToSignup()
      return c.json({ ok: true, phase: 'signup', undrawn } satisfies BackToSignupResponse)
    })
// The production app: the default `makeDeps` wires the D1 + crypto + nuLiga adapters from env.
export const app = createApp()

// The typed client (`hc`) derives its route types from this. The catch-all that
// delegates legacy routes is registered in index.ts (the worker entry the client
// never imports), so it stays out of this type.
export type AppType = typeof app
