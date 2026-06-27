# CLAUDE.md

## Code Style

General principles (apply everywhere, override defaults):

- **English everywhere except user-facing copy** — file names, variables, functions, types,
  **comments**, commit messages, **data/wire/DB values** (the `competition` slugs `mens`/`womens`/…,
  the phase values `signup`/`tournament`/`post-event`), **and docs prose** are all English. Comments use
  the English identifier, never the German domain noun (`competition` not Konkurrenz, `draw` not
  Auslosung, `main`/`consolation` not Hauptrunde/Nebenrunde). German survives in exactly two places:
  **user-facing content** (UI copy, toast/error strings, `aria-label`s, and the German URL route slugs
  `/abmelden`, `/datenschutz`, `/impressum`) and **glossary aliases** — in `CONTEXT.md` the German term
  appears only as a parenthetical `(de: Konkurrenz)` after the English headword, the one bridge from the
  German the club speaks to the code. _(See ADR-0028.)_
- **Follow best practices, but always prefer the simple solution** — reach for the smallest change
  that does the job correctly. Don't add abstraction, indirection, or configurability before it's needed.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in `tv-winsen-luhe/meisterschaften` via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.
