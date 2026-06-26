# ADR-0008: Stay on Astro + Cloudflare; polling for live; Astro islands for operator UI; Access for auth

- Status: accepted
- Date: 2026-06-25

## Context

The phase work (ADR-0001…0007) added an automatic live draw, live scheduling, a near-real-time public
board, operator-controlled phase state, and a results archive. We asked whether the current stack
(Astro 7 static site + a single Cloudflare Worker serving `dist/` assets + `/api/*` + D1) is adequate,
prompted by the Astro 7 release.

Finding: every new requirement is dynamic/runtime and lives in the Worker + D1 + client-side fetch,
not in Astro's rendering — so the framework version is largely orthogonal to capability. Data volume
is tiny (~50 players, a few hundred match rows). There is no capability gap. Astro 7 itself is pure
upside (Rust compiler, Vite 8/Rolldown faster builds; `Astro.cache` + Cloudflare CDN cache provider
available later). The real decisions are about live-update delivery, the construction of the new
interactive surfaces, and operator auth.

## Decision

1. **Keep the stack.** Astro 7 static site + single Cloudflare Worker + D1. No framework switch, no new
   datastore.
2. **Live updates via polling, not push.** Public live components re-fetch `/api/…` on a timer
   (Live-Board ~10–20s; Auslosungs-Show ~1–2s while running). No SSE, no WebSockets, no Durable
   Objects — the data is read-heavy, write-rare, and latency-tolerant. The draw TV is driven directly
   from the operator's own device (HDMI/cast), so there is no second device to synchronise; this
   assumption is what makes polling sufficient for the reveal.
3. **The entire admin is a single React app**, mounted in an Astro route via `client:only="react"`
   (no SSR — the admin is fully dynamic and gated, so there is nothing to pre-render; just a static
   shell that hydrates). It replaces the legacy worker-HTML `adminPage()` string. All operator
   functionality lives here as React components sharing one API client and state: registrations CRUD +
   LK refresh, the scheduling grid (`dnd-kit`), draw trigger & show control, the Auslosungs-Show
   animation (`motion`), results entry, phase toggle + freeze, export, and the post-event purge.
   **React is the single client framework.** The public marketing/list pages stay
   zero-JS-by-default — React is confined to the gated admin area.
4. **Auth via Cloudflare Access (Zero Trust free plan).** Access gates the operator surfaces (`/admin`,
   `/api/admin/*`, and the new draw/schedule endpoints) at the edge with email-OTP/Google login — no
   app-level auth code, no shared secret to leak, and it hides the otherwise-public static admin shell.
   The public `/api/participants` and the cron LK sync stay outside Access. The existing `ADMIN_TOKEN`
   is retained only as a local-`wrangler dev` fallback, since Access does not apply to local dev.

## Consequences

- Moving the admin into Astro makes its shell a static asset (publicly fetchable); Access resolves
  that by gating the route itself, so the exposure is moot.
- `/export?token=…` (token in URL) goes away — export sits behind Access like the rest of the operator
  surface, removing the token-in-logs/history leak.
- A one-time Zero Trust dashboard setup is required, plus a documented dev bypass for `wrangler dev`.
- Rewriting the existing ~400-line worker-HTML admin (registrations list, update/delete, LK refresh)
  as React is deliberate churn on working code — accepted, because one coherent admin beats a
  patchwork as the admin grows for the draw/schedule/results/phase work.
- React (~40 kB) ships only on the gated admin route, never on the public pages — so its bundle weight
  is irrelevant to the zero-JS-by-default public site. Framework choice settled (Q18): React was
  chosen over Svelte/Preact for ecosystem (`dnd-kit`, `motion`) and maintainability by future
  volunteers; the bundle downside is moot on a single-operator gated surface.
- **Possible later DX consolidation, not adopted now:** Astro 7's `src/fetch.ts` + Hono pipeline could
  fold `worker/index.ts` into Astro's request pipeline. Out of scope for this decision; the separate
  Worker stays.

## Amendment (2026-06-25): the app-level `ADMIN_TOKEN` is removed — auth is edge-only

The original decision kept `ADMIN_TOKEN` "only as a local-`wrangler dev` fallback." Once Access was live
in production (an Access application gates `/admin` and `/api/admin/*`; verified by a 302 to
`tv-winsen.cloudflareaccess.com` on both the page and the API), the token's prod role was redundant. We
remove it entirely rather than carry a second secret. The worker now has **no app-level auth**: it trusts
that it is only reachable through the Access-gated host.

Two consequences become load-bearing safeguards, because nothing in the worker backstops a mistake:

1. **`workers_dev = false`.** Access binds to the custom-domain hostname; the `*.workers.dev` URL is a
   _different_ hostname outside the Access application. With the token gone, an enabled `workers.dev` route
   would be an unauthenticated admin API. Disabling it leaves the worker no un-gated hostname.
2. **Every operator endpoint must live under `/api/admin/*`** — the Access destination. A route outside it
   is born public. This was previously a style convention; with no app-level auth it is now a security
   rule. (The token-only `/export` route, which sat outside `/api/admin/*`, is deleted rather than brought
   under Access — the operator does not need the CSV.)

Local `wrangler dev` has neither Access nor a token: the admin is simply open on `localhost` (single
developer, localhost-bound). The React admin drops its token-login gate entirely; in production the
operator is already authenticated by Access before the SPA loads, and an expired 24h Access session
(which returns a 302 to the login, not a 401) is handled by forcing a full page reload so the browser
re-runs the Access flow.

Not adopted: verifying the `Cf-Access-Jwt-Assertion` in the worker (app-level defense-in-depth that would
also cover a re-enabled `workers.dev`). Overkill for a single-operator surface; revisit if operator count
or route surface grows. "Default-deny" Access scoping (gate the whole host, bypass the public paths) was
likewise rejected as more config and more lock-out risk than the explicit `/api/admin` include warrants.

## Amendment (2026-06-26): TanStack Start / Next.js evaluated by name — decision unchanged

The original "keep the stack" decision weighed Astro against an _abstract_ "switch framework", prompted by
the Astro 7 release. We revisited it with two **named** alternatives — TanStack Start and Next.js — driven
by a wish for (A) better admin DX and (B) unified full-stack TypeScript. Conclusion: stay on Astro.

- **B is already met.** The typed `hc` chain (Drizzle → Store → Zod → Hono → `hc`, ADR-0009) _is_ end-to-end
  type-safe full-stack. A unified framework's server functions would only **colocate** the server call with
  the client call — saving the "define a Hono route + Zod validator per operation" ceremony — not add type
  safety we lack.
- **A is library-solvable in place.** The admin's hand-rolled `load()`/`mutate()`/refetch-after-mutation and
  `useState`-held server data is the exact problem TanStack **Query** solves; surface-switching via `useState`
  instead of routes is what TanStack **Router** solves. Both are **libraries that drop into the existing
  React island** — no framework switch, zero impact on the public zero-JS site.
- **Migration cost is real and one-directional.** Next.js (App Router) and TanStack Start are SSR-React
  metaframeworks: both ship a React runtime to **every public page**, regressing the public marketing/list
  pages off zero-JS-by-default — Astro's whole point here — for **no capability gain** (the original finding
  stands: every dynamic requirement lives in the Worker + D1 + client fetch, so the framework is orthogonal
  to capability). Add a full rewrite of public site + admin + worker integration on a single-event volunteer
  project, against a younger Cloudflare-Workers deploy story (Next via `@opennextjs/cloudflare`; TanStack
  Start fresh) versus Astro's first-class CF support.
- **No current DX pain.** With no concrete paper-cut today, even the in-place libraries (Query/Router) are
  **not adopted now** — adding them speculatively would be the same YAGNI violation in miniature. They are
  the sanctioned escape hatch _if and when_ the admin DX actually hurts.
