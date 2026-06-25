# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Event site for the **Winsener Meisterschaften 2026** — the joint city championship of TV Winsen/Luhe
and TSV Winsen (22./23. August 2026). Unlike the sibling `matchday` site, this one has its own
**online registration** and a **live public participant list**, served by a single Cloudflare Worker
(static Astro assets + API + Cloudflare D1). Editorial source: the Ausschreibung in the club vault.

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

## Architecture

- `src/pages/` — file-based routing (Astro convention)
- `src/layouts/default.astro` — base HTML layout with SEO props (`title`, `description`, `og*`, `bodyClass`)
- `src/components/` — reusable Astro components
- `src/styles/global.css` — Tailwind entry point (`@import 'tailwindcss'`)
- `src/assets/` — images/SVGs processed by Astro
- Path alias: `@/*` maps to `./src/*`
- `src/data/tournament.ts` — single content model (dates, competitions, venue, facts)
- `worker/index.ts` — Cloudflare Worker: serves `dist/` (Workers Assets) + handles `/api/anmeldung`,
  `/api/teilnehmer`, `/admin`, `/api/admin/*`, `/export`. Own `worker/tsconfig.json` (Workers types);
  excluded from the root tsconfig so `astro check` keeps DOM libs. `worker/schema.sql` = D1 schema.
- `wrangler.toml` — Worker + Assets + D1 binding + `PUBLIC_LIST_ENABLED` flag. `database_id` and the
  `ADMIN_TOKEN` secret are filled in at deploy time.
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
