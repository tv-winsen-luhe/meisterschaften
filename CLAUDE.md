# CLAUDE.md

## Code Style

General principles (apply everywhere, override defaults):

- **Code is always English** — file names, variables, functions, types, comments, commit messages,
  **and data/wire/DB values** (the `competition` slugs `mens`/`womens`/…, the phase values
  `signup`/`draw`/`live`/`post-event`). Only user-facing content is German (see Locale). The German
  domain terms in `CONTEXT.md` (Konkurrenz, Auslosung, Setzung, …) are the ubiquitous language — they
  name concepts and appear in UI copy, but they are never used as identifiers or stored values.
- **Follow best practices, but always prefer the simple solution** — reach for the smallest change
  that does the job correctly. Don't add abstraction, indirection, or configurability before it's needed.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in `tv-winsen-luhe/meisterschaften` via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.
