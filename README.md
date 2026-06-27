# Winsener Meisterschaften 2026

![Winsener Meisterschaften 2026 — city championship on 22/23 August](public/og.jpg)

> Website for the **city championship of TV Winsen/Luhe and TSV Winsen** on **22/23 August 2026** —
> with online registration and a public, live-growing participant list.

[![CI/CD](https://github.com/tv-winsen-luhe/meisterschaften/actions/workflows/ci.yml/badge.svg)](https://github.com/tv-winsen-luhe/meisterschaften/actions/workflows/ci.yml)
&nbsp;**Live:** <https://meisterschaften.tennisverein-winsen.de/>

---

- [Quickstart](#quickstart)
- [Overview](#overview)
- [Commands](#commands)
- [Deploy & CI](#deploy--ci)
- [Admin access](#admin-access)
- [Releases](#releases)
- [License](#license)

## Quickstart

```bash
pnpm install
pnpm cf-dev        # Build + wrangler dev (site + API + local D1) → http://localhost:8787
```

On the first `wrangler dev`, migrate the local D1 once:

```bash
wrangler d1 migrations apply winsener-meisterschaften --local
```

Frontend-only work without the API is faster with `pnpm dev` (Astro dev server → http://localhost:4321).

## Overview

**A single Cloudflare Worker** serves the static Astro site (Workers Assets) **and** the API —
same-origin, no CORS. All tournament data lives in **Cloudflare D1**; the app is the sole
[Source of Truth](docs/adr/0001-site-owns-tournament-data.md), with no external tournament tool.

```
meisterschaften.tennisverein-winsen.de  →  one Worker
  ├─ static Astro site (dist/ as assets)
  ├─ GET  /api/participants   public, confirmed list (name, club, competition, LK)
  ├─ GET  /api/phase          current phase (signup · draw · live · post-event)
  ├─ POST /api/register       store registration (status='new')
  ├─ POST /api/cancel         self-cancellation (email + last name → status='cancelled')
  ├─ GET  /admin              Access-protected React admin (client:only)
  ├─ /api/admin/*             admin API: list · confirm · cancel · delete · refresh-lk · phase
  └─ D1   table "registrations" + phase state
```

- **Phases** — the event runs through four operator-controlled phases (`signup` → `draw` → `live` →
  `post-event`); every public surface follows them. ([ADR-0006](docs/adr/0006-operator-controlled-phase-state.md))
- **Competitions** — Herren, Herren Challenger (protected upward, from LK 20) and Damen. "Damen
  Freizeit" is planned but not yet open for registration.
- **Confirm gate** — registrations only appear publicly after confirmation by the tournament
  organizers.
- **Cancellation** — members withdraw their own registration via `/abmelden` (matched on email + last
  name); it drops out of the public list immediately.
- **LK** — synced weekly from nuLiga (cron, only in `signup`) and matched against the roster at
  registration; it serves seeding only, default `25.0`. ([ADR-0010](docs/adr/0010-seeding-lk-module.md))
- **Kill switch** `PUBLIC_LIST_ENABLED` (in `wrangler.toml`) toggles the public list on/off.

End-to-end type-safe: **Drizzle** (D1 schema + migrations) → store module → **Zod** contract in
`shared/` → **Hono** + `@hono/zod-validator` in the Worker → type-safe **Hono `hc`** client
([ADR-0009](docs/adr/0009-end-to-end-type-safety-drizzle-zod-hono.md)). Stack: Astro 7 (zero client JS
by default), Tailwind CSS 4, TypeScript (strict), pnpm, Node 24.

## Commands

| Command          | Effect                                                       |
| ---------------- | ------------------------------------------------------------ |
| `pnpm dev`       | Astro dev server (no API) → http://localhost:4321            |
| `pnpm cf-dev`    | Build + `wrangler dev` (site + API + local D1) → :8787       |
| `pnpm build`     | `astro check` + build                                        |
| `pnpm lint`      | ESLint                                                       |
| `pnpm test`      | Vitest                                                       |
| `pnpm format`    | Prettier (write)                                             |
| `pnpm cf-deploy` | Build + D1 migrations + `wrangler deploy` (emergency deploy) |

## Deploy & CI

Deployment happens **not** on push to `main`, but only on **publishing a GitHub release**
(`release: published`) — the publish is the deliberate go-live.
([ADR-0015](docs/adr/0015-deploy-on-release-publish.md))

- `.github/workflows/ci.yml` runs on every PR and push to `main`: the `checks` job runs
  `format:check → lint → build → test`. On a (non-pre-)release the `deploy` job hangs off it
  (`needs: checks`, on the tagged commit) — D1 migrations + `wrangler deploy`. A broken state is
  never deployed.
- `main` is branch-protected: PRs required, required checks, Conventional Commit check on the
  **PR title** (= squash commit subject). ([ADR-0013](docs/adr/0013-public-repo-for-branch-protection.md))

**One-time setup** (account "TV Winsen / Luhe"):

```bash
wrangler login
export CLOUDFLARE_ACCOUNT_ID=<account-id>                          # not stored in wrangler.toml
wrangler d1 create winsener-meisterschaften                        # database_id → wrangler.toml
wrangler d1 migrations apply winsener-meisterschaften --remote
pnpm cf-deploy
```

Then point the custom domain at the Worker in the Cloudflare dashboard. For CI, store in the repo:
`CLOUDFLARE_API_TOKEN` (secret, "Edit Cloudflare Workers" + D1: Edit) via `gh secret set …` and
`CLOUDFLARE_ACCOUNT_ID` (repo _variable_) via `gh variable set …`. `wrangler.toml` only holds the
`database_id`; Wrangler reads the `account_id` from `CLOUDFLARE_ACCOUNT_ID`. The Worker secrets
(`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) persist across deploys.

## Admin access

The operator surfaces (`/admin`, `/api/admin/*`) are secured in production **at the edge by Cloudflare
Zero Trust Access** (login via email OTP through `tv-winsen.cloudflareaccess.com`); the Worker has
**no** auth of its own. Unauthenticated requests never even reach it. The public API and the cron stay
outside Access. Locally (`wrangler dev`) Access does not apply — the admin is open on `localhost`.
([ADR-0008](docs/adr/0008-keep-astro-cloudflare-polling-access.md))

Manage access: Cloudflare dashboard → **Zero Trust → Access → Applications → "Winsener
Meisterschaften – Admin"**.

> **Two load-bearing rules** keep the edge-only auth safe: `workers_dev = false` (no unprotected
> second hostname) and **every operator route must live under `/api/admin/*`** — a route outside it
> would be public from birth.

## Releases

`.github/workflows/release.yml` lets [SAVR](https://github.com/21stdigital/savr-action) keep a
**single draft release** up to date on every push to `main` (next version + notes from the
Conventional Commit PR titles). Publishing is done **by hand** — and that publish triggers the deploy.
The version is a milestone label: `fix`/`feat` drive patch/minor, `v1.0.0` is cut by hand for the
tournament-ready state (no `feat!`).
([ADR-0014](docs/adr/0014-savr-draft-releases-no-standing-environments.md))

## License

© 2026 Tennisverein Winsen (Luhe) von 1913 e.V. — all rights reserved. See [`LICENSE`](./LICENSE).
