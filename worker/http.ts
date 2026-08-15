import type { Context, MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ZodType } from 'zod'
import type { AppEnv } from './app'

// The route tree's HTTP primitives — validation, parsing, and the gates that run before a handler.
// They carry no domain knowledge and no route wiring, so they live beside `app.ts` rather than in
// it, keeping that file the single Hono chain ADR-0037 asks it to be. The `AppEnv` import is
// type-only and therefore erased at build time: no runtime cycle back into `app.ts`.

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
export const v = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, 400)
  })

// Parse-guard: a malformed (unparseable) body answers with the same { error } envelope the
// legacy try/catch did — so zValidator never throws an HTTPException into onError (which would
// surface as a 500). It reads first; v() then re-reads the body from Hono's cache.
export const parseGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
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
export const honeypot =
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
export const resetGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.RESET_ENABLED !== 'true') return c.json({ error: 'Reset ist in dieser Umgebung deaktiviert.' }, 403)
  await next()
}

// The signup window is server-enforced (ADR-0059): leaving the `signup` phase closes registration
// and self-service withdrawal for real, not just visually. The public site hides its signup
// affordances client-side (ADR-0042), but a stale page, a no-JS visitor or a direct POST all land
// here — so this is the authority and that is only optics. The message differs per route (signing
// up vs withdrawing), so it is a parameter.
export const signupOnly =
  (message: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if ((await c.var.deps.appState.getPhase()) !== 'signup') return c.json({ error: message }, 409)
    await next()
  }
