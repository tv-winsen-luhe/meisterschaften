# ADR-0028: English everywhere except user-facing copy; German survives only as glossary aliases

- Status: accepted
- Date: 2026-06-27
- Sharpens: the CLAUDE.md "Code is always English" rule; revises how the German ubiquitous language
  from `CONTEXT.md` (ADR scope: all of `docs/`) may appear

## Context

The project speaks two languages on purpose. The real world it models is German — the club, the DTB
Turnierordnung, nuLiga, and every word a member reads — so the domain was captured as a German
ubiquitous language in `CONTEXT.md`, each term mapped to an English code identifier (Konkurrenz →
`competition`, Auslosung → `draw`, Setzung → `seeding`, …). CLAUDE.md then said code is English but
"the German domain terms … name concepts and appear in UI copy."

That phrasing left a seam, and German leaked through it. Identifiers stayed clean (a grep finds **zero**
German identifiers — `competition` 148×, `draw` 137×, …), but **comments** filled with German domain
nouns ("the per-Konkurrenz draw", "the Hauptrunde runs it once"), one comment was pure German prose
(`shared/constants.ts`), **docs** prose used the German freely, and four **ADR filenames** embedded
German slugs. A contributor reading the code therefore had to context-switch language sentence by
sentence, and "is this German allowed here?" had no crisp answer.

## Decision

**Everything that is not user-facing is English — identifiers, comments, wire/DB values, and docs
prose. German survives in exactly two places.**

1. **User-facing content** — UI copy, toast/error strings, `aria-label`s, and the German URL route
   slugs (`/abmelden`, `/datenschutz`, `/impressum`). These are read by members, in their language.
2. **Glossary aliases** — in `CONTEXT.md`, the German term appears only as a parenthetical
   `(de: Konkurrenz)` after the English headword. The glossary stays the one bridge from the German the
   club actually speaks to the code; nowhere else carries that bridge.

Concretely:

- **Comments use the English identifier**, never the German domain noun: `competition` not Konkurrenz,
  `draw` not Auslosung, `main`/`consolation` not Hauptrunde/Nebenrunde, `seeding` not Setzung, `bye` not
  Freilos, `schedule` not Spielplan, `court` not Platz.
- **`CONTEXT.md` is keyed by English headwords**, German demoted to a `(de: …)` alias; its prose is
  English.
- **ADR and agent-doc prose is English**; the four German-bearing ADR filenames are renamed (cross-refs
  are by number, so nothing breaks) and their bodies anglicized.

## Considered options

- **Keep German domain terms in comments and docs** (the status quo, the ubiquitous-language reading).
  Rejected: it kept code bilingual sentence-by-sentence with no clear boundary, which is the cost we are
  paying down. The bridge to the real-world German is worth keeping, but one canonical place
  (`CONTEXT.md` aliases) is enough to keep it.
- **Anglicize the user-facing strings and URLs too.** Rejected: members read those; German there is
  correct, not debt.

## Consequences

- The ubiquitous language is now **English in code, German at the edges**. The glossary aliases are
  load-bearing: they are the only remaining link from a German term a maintainer hears ("Nebenrunde")
  to the identifier they will grep for (`consolation`). Keep them current.
- Existing comments, `CONTEXT.md`, and ADR prose were swept to match in the change that introduced this
  ADR. New code follows the rule; new domain terms are coined in English with a `(de: …)` alias added to
  `CONTEXT.md`.
- No identifier, wire value, or DB value changed — they already complied. This is a documentation and
  comment change, plus four file renames.
