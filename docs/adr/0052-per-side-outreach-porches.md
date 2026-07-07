# ADR-0052: Per-side outreach porches, justified by the WhatsApp preview

- Status: accepted
- Date: 2026-07-07
- Extends: ADR-0042 (the homepage is a phase-projected front door), ADR-0008 (static Astro +
  client-side polling), ADR-0051 (the four fields, "zwei je Seite"), ADR-0017 (noindex, shareable
  by link)

## Context

Signup outreach happens in **WhatsApp** — the Damen fields get shared into women's group chats and
direct messages, the Herren fields into theirs. The front door (`index.astro`, ADR-0042) is
deliberately **neutral**: "ein Wochenende für alle" (ADR-0050), all four fields presented "als
Gleiche" (ADR-0051). A pitch aimed at one audience is, by definition, not neutral — and the format
that most needs explaining to newcomers, the Damen social mixer ("komm allein, Partnerinnen
wechseln, keine LK"), gets a single card on a page that has to serve everyone at once.

The instinct was "a dedicated `/damen` and `/herren` page converts better." That runs straight into
ADR-0042, which **rejected** three full per-phase compositions in favour of one front door — and,
implicitly, rejected per-competition pages. So the real question is not "should the pitch be
targeted" (yes) but "does a targeted pitch require a new **route**, given we serve a fixed,
known, members-only audience with no SEO need (ADR-0017)?"

The deciding fact is the channel. WhatsApp renders a **link-preview card** (OG title, description,
image) _before anyone clicks_, and OG tags are **per-URL** on a static site (ADR-0008). A query
param on the front door (`/?feld=womens`) serves the **homepage's** generic preview; only a real
route can carry its own preview card into the group chat. That preview — not SEO, not the page body
— is what an anchor cannot do.

## Decision

Ship two **outreach porches**: `/damen` and `/herren`. A porch is a **thin, signup-era landing
page**, not a full composition and not a phase-projected surface.

1. **The route earns its keep at the preview layer.** Each porch sets its own `ogTitle` /
   `ogDescription` (Tier 1), so the WhatsApp card _is_ the targeted pitch. It reuses the shared
   `/og.jpg` — a bespoke per-side OG image is deferred (a new canvas + screenshot output for a
   marginal lift). This preview, and the campaign-focused entry, are the whole reason a route beats
   an anchor.

2. **Thin porch, not a full page.** A porch is: a targeted lead, the side's **two** field cards as
   equals (Damen: Hauptfeld + Doppel; Herren: Hauptfeld + Challenger — ADR-0051), a fuller
   explainer for the format that side must sell, one signup CTA, and a „→ Das ganze Wochenende"
   hand-off to `/`. Everything evergreen (Event, Modus, Ablauf, FAQ) stays on the front door and is
   linked, never restated.

3. **Reuse over duplication.** Porches compose the _same_ components over the _same_ `tournament`
   data as the front door; the only bespoke content per route is the **targeted lead copy** — which
   is the point, not duplication. The full-page alternative was rejected precisely because it would
   re-author the evergreen tail in "-flavoured" wording that drifts (the drift ADR-0042/0051 closed).

4. **Signup-only, with a post-signup redirect.** A porch's whole job is "land from WhatsApp → sign
   up." A WhatsApp link is permanent, so a porch reads `GET /api/phase` **once on load** (the
   ADR-0042 client-side pattern) and, when phase ≠ `signup`, **redirects to `/`** — which already
   handles `tournament` / `post-event` correctly. A porch never learns to be a results page; the
   phase-projection logic is not spread onto a third surface.

5. **Reachable only by the shared link.** Porches carry **stripped chrome** (logo + signup CTA +
   the `/` hand-off — no section-anchor nav, since there are no sections to anchor to) and are
   **not linked from the site** or its header. They are campaign entry points, not a navigation
   tier. `noindex` is inherited site-wide (ADR-0017); no SEO work, nothing to switch off. German
   route slugs (`/damen`, `/herren`) per ADR-0028, alongside `/abmelden`, `/datenschutz`,
   `/impressum`.

## Considered and rejected

- **A query param / anchor on the front door** (`/?feld=womens`, `/#competitions`). Delivers a
  targeted _entry_ but serves the **homepage's** generic OG card into WhatsApp — the persuasive
  moment is lost before the click. Rejected: it cannot do the one thing that justifies the work.
- **Full standalone `/damen` / `/herren` pages** reproducing the evergreen tail with per-side
  framing. Re-opens the content duplication ADR-0042 and ADR-0051 spent effort closing, for
  material a hand-off link already covers. Rejected.
- **Phase-projected porches** that live through the whole event (mirroring ADR-0042). Spreads the
  phase logic across a third surface for an audience that runs no _outreach_ after Meldeschluss.
  Rejected in favour of the signup-only redirect.
- **Bespoke per-side OG images** (Tier 2). A real content + build task (new `og-*.astro` canvases,
  new screenshot outputs) for a marginal lift over targeted card _text_. Deferred, not rejected —
  easy to add if the text-only cards underperform.

## Consequences

- ADR-0042 stands: the **front door** remains the one phase-projected surface and the sole home of
  the evergreen tail. The porches are a **new surface kind** — signup-era, single-audience, link-only
  — that re-points into signup, never duplicating live/results content.
- A no-JS visitor who taps a porch link after Meldeschluss sees the signup lead (the redirect is the
  same client-side phase read the homepage uses). Bounded and harmless: signup is server-side
  phase-gated, so only the optics mislead.
- Adding a future side or field to the outreach set is a new thin porch, not a new composition.
