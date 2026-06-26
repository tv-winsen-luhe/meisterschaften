# ADR-0022: Form constraints are hints; the Zod contract stays server-side

- Status: accepted
- Date: 2026-06-26

## Context

The signup modal (`src/components/signup-modal.astro`) validates on the client with plain HTML5
attributes (`required`, `maxlength`, `type="email"`) checked via `form.checkValidity()`; the
authoritative validation is the Zod `registerRequestSchema` in `shared/` that the worker runs on
`POST /api/register`. The two are hand-kept copies of the same rules and can drift: the HTML5
constraints don't trim (so `"Max   "` passes the client, then fails `trim().min(1)` server-side),
`type="email"` is looser than the schema's `EMAIL_RE`, and three duplicated value sets (the
competition slugs, the club names, the field max-lengths) had no shared source — including a live
hazard where `signupCompetitions` was gated by a hand-set `selectable` boolean that merely _happened_
to track `COMPETITION_SLUGS`.

An architecture review proposed closing the drift by importing `registerRequestSchema` into the
modal's processed `<script>` and calling `safeParse` before fetch — one contract, both sides. That
buys full client/server parity (trim, the strict email rule, identical messages, pre-flight feedback)
but drags Zod into the **public** client bundle, against ADR-0008's zero-JS-by-default posture for the
public site.

## Decision

The Zod contract stays **server-side only**. Client form constraints remain deliberately **loose
front-line hints**, and the schema is the **sole validation authority**; an input that passes the
HTML5 hints but fails the schema is rejected server-side and its German message (the schema's first
issue) is shown in the form's error banner, exactly as today.

Drift is closed not by sharing the _schema_ but by single-sourcing the _values_ that can diverge,
all at **build time** via the Astro frontmatter (SSR-stripped, zero client cost):

- **Competition slugs** — `signupCompetitions` is derived from `COMPETITION_SLUGS` membership and the
  `selectable` boolean is removed. The form can no longer offer a Konkurrenz the contract rejects;
  "open a field for registration" becomes a single edit to the contract. This also makes the code
  conform to the glossary, which already defines registerable as "in `COMPETITION_SLUGS`."
- **Club names** — the radios render from `CLUBS`, with logos keyed through a
  `satisfies Record<Club, ImageMetadata>` map (exhaustive at compile time).
- **Field max-lengths** — a shared `FIELD_MAX` record beside the schema feeds both the schema's
  `.max(...)` calls (messages unchanged) and the form's `maxlength` attributes.

The remaining HTML5 attributes (`required`, `type="email"`) stay as static hints: which fields are
required is structurally stable, and `type="email"` is an inherent HTML5-vs-regex gap, not a
divergence single-sourcing can close.

## Considered Options

- **Ship Zod to the client and `safeParse` (rejected).** Full parity and field-level pre-flight
  feedback, but adds Zod to the public bundle against ADR-0008. The UX gain is marginal for a short
  form whose server already returns a precise message, and the maintainability win is obtainable
  without it.
- **A CI contract test that asserts the markup matches the schema (rejected).** Detects drift after
  it is written and must parse/render `.astro`; single-sourcing the values _prevents_ the divergence
  instead, so illegal states can't be authored.

## Consequences

- Zero client JS added; ADR-0008 holds.
- Value drift (slugs, clubs, max-lengths) is structurally prevented, not merely caught.
- The behavioural gaps HTML5 cannot express (trim, strict email) remain a server-only check: such
  inputs cost a round-trip and surface in the single error banner rather than inline per-field. This
  is the accepted price of keeping the public bundle Zod-free. If field-level pre-flight parity is
  ever wanted, the rejected client-`safeParse` option returns as a deliberate, measured bundle cost —
  not the default.
