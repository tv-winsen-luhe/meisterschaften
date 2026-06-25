# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Event site for the **Winsener Meisterschaften 2026** — the joint city championship of TV Winsen/Luhe
and TSV Winsen (22./23. August 2026). Unlike the sibling `matchday` site, this one has its own
**online registration** and a **live public participant list**, served by a single Cloudflare Worker
(static Astro assets + API + Cloudflare D1).

## Commands

- `pnpm dev` — start Astro dev server (site only, no API)
- `pnpm cf-dev` — build + `wrangler dev` (site + API + local D1)
- `pnpm cf-deploy` — build + `wrangler deploy` (not `pnpm deploy` — that's pnpm's built-in workspace command)
- `pnpm build` — type-check then build (`astro check && astro build`)
- `pnpm check` — type-check only
- `pnpm lint` — ESLint
- `pnpm format` — Prettier write
- `pnpm format:check` — Prettier check
- `pnpm preview` — preview production build

## Tech Stack

- **Astro 7** static site generator (zero client JS by default, Vite 8)
- **Tailwind CSS 4** via Vite plugin (configured in `astro.config.ts`)
- **TypeScript** strict mode (extends `astro/tsconfigs/strict`)
- **pnpm** package manager, **Node 24**

## Package management (pnpm 11)

- pnpm-specific settings live in `pnpm-workspace.yaml`, **not** `.npmrc` — pnpm 11 ignores npm-style
  keys (`save-exact`, `engine-strict`) there. `.npmrc` holds **only** registry config; the scoped
  `@types:registry` pin matters (it stops Dependabot resolving `@types/*` from stale GitHub Packages).
- pnpm is pinned via the `packageManager` field; CI reads it (`pnpm/action-setup` is unpinned).
- `pnpm-workspace.yaml` carries: `overrides`, `saveExact`, `engineStrict`, plus two pnpm 11 guards:
  - `minimumReleaseAge: 1440` — rejects any dependency published less than 1 day ago; a too-fresh
    lockfile entry makes `pnpm install --frozen-lockfile` **fail in CI**. Dependabot's `cooldown`
    (3 days, `.github/dependabot.yml`) must stay >= this so it never opens PRs the guard would reject.
  - `allowBuilds` — pnpm 11 errors on un-approved dependency build scripts; any dep needing one
    (esbuild, sharp, workerd, simple-git-hooks) must be listed here.
- Non-interactive installs need `CI=true` (e.g. `CI=true pnpm install`), else pnpm prompts for the
  modules-dir purge / build approval and aborts with no TTY.

## Architecture

- `src/pages/` — file-based routing (Astro convention)
- `src/layouts/default.astro` — base HTML layout with SEO props (`title`, `description`, `og*`, `bodyClass`)
- `src/components/` — reusable Astro components
- `src/styles/global.css` — Tailwind entry point (`@import 'tailwindcss'`)
- `src/assets/` — images/SVGs processed by Astro
- Path alias: `@/*` maps to `./src/*`
- `src/data/tournament.ts` — single content model (dates, competitions, venue, facts)
- `worker/` — Cloudflare Worker (own `worker/tsconfig.json`, Workers types; excluded from the root
  tsconfig so `astro check` keeps DOM libs). Mid-migration onto the type-safe stack (ADR-0009):
  - `worker/app.ts` — Hono app + exported `AppType` for the typed `hc` client. Client-safe: explicit
    `import type` for Cloudflare types (no ambient `/// <reference>`) so the client can import `AppType`
    across the tsconfig boundary. Currently owns `GET /api/participants`.
  - `worker/index.ts` — worker entry: mounts the Hono app, delegates the not-yet-migrated routes
    (`/api/register`, `/api/cancel`, `/admin`, `/api/admin/*`, `/export`) via a Hono catch-all, and
    runs the weekly LK cron. Still serves `dist/` via Workers Assets.
  - `worker/db/schema.ts` — Drizzle schema mirroring `registrations` 1:1; `worker/migrations/` are
    drizzle-kit-generated and applied by `wrangler d1 migrations apply` (`migrations_dir`).
  - `worker/store/registrations.ts` — deep Store hiding Drizzle/SQL; D1 + in-memory adapters.
- `shared/` — Zod contract + inferred types, the `Konkurrenz` slug, `CHALLENGER_MIN_LK`/`DEFAULT_LK`;
  imported by both worker and client (crosses the `worker/tsconfig.json` boundary).
- `wrangler.toml` — Worker + Assets + D1 binding + `PUBLIC_LIST_ENABLED` flag. Holds the `database_id`;
  `account_id` is supplied via the `CLOUDFLARE_ACCOUNT_ID` env var (repo variable in CI). Secrets
  (`ADMIN_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) are set with `wrangler secret put`.
- **Operator auth:** `/admin` and `/api/admin/*` are gated in production by Cloudflare Zero Trust
  Access at the edge (email-OTP; team portal `tv-winsen.cloudflareaccess.com`). `/api/participants`
  and the cron stay outside Access. `ADMIN_TOKEN` (the `x-admin-token` check in `worker/index.ts`)
  is only a fallback for `wrangler dev`, where Access does not apply. See ADR-0008.
- The site is **same-origin** with the API → the registration form and participant list use relative
  `/api/...` paths (no CORS).

## Code Style

Enforced by Prettier (config in `prettier.config.ts`):

- No semicolons
- Single quotes
- 120 char print width
- No trailing commas
- Arrow parens: avoid (`x => x`, not `(x) => x`)
- Tailwind class sorting enabled via `prettier-plugin-tailwindcss`

## Git Hooks

`simple-git-hooks` installs two hooks (re-run via `pnpm exec simple-git-hooks` after changing the config):

- **pre-commit** — `lint-staged`: Prettier formats `*.{astro,ts,tsx,js,jsx,mjs,cjs,css,md,json,yaml,yml}`,
  ESLint with `--fix --max-warnings=0` on `*.astro` files
- **commit-msg** — `commitlint` enforces [Conventional Commits](https://www.conventionalcommits.org)
  (`@commitlint/config-conventional`). The same check runs in CI on PRs (`.github/workflows/commitlint.yml`),
  which is the binding gate — the local hook is bypassable via `--no-verify`.

## Locale

Site language is German — HTML `lang="de"`, default `og:locale="de_DE"`.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in `tv-winsen-luhe/meisterschaften` via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.
