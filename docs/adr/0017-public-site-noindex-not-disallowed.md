# ADR-0017: The public site is `noindex` (vereinsintern), kept out of search by meta — not robots `Disallow`

- Status: accepted
- Date: 2026-06-26

## Context

The Meisterschaften is a club-internal event (CONTEXT.md: _vereinsintern, members only_). It should
not show up in search engines. But the site is deliberately **public and shareable**: it has an open
registration, a public participant list (`PUBLIC_LIST_ENABLED`), and full OG/Twitter cards with an
`og.jpg` so members can share the link in WhatsApp/Telegram with a rich preview. So the requirement is
**public-but-unlisted** (reachable by link, absent from search) — not private/gated.

The repo previously did the opposite: `robots.txt` had `Allow: /` plus a `Sitemap:` line,
`@astrojs/sitemap` generated and advertised `sitemap-index.xml`, and the public layout carried no
`robots` meta — actively inviting indexing.

## Decision

1. **`<meta name="robots" content="noindex, follow">` in the public layout `default.astro`** — a blanket
   tag, not a per-page prop. All five public pages route through this layout; the two that don't
   (`admin.astro`, `og.astro`) already carry their own `noindex`. The whole public site _is_ the
   internal event, so there is no page that should be indexed — a prop would be configurability before
   it is needed.
2. **Crawling stays allowed; we do NOT use `robots.txt Disallow: /`.** `Disallow` blocks _crawling_, not
   _indexing_ — a URL discovered via a link can still be listed without a snippet, and worse, a blocked
   crawler never fetches the page and so **never sees the `noindex`**, leaving it indexed. The two
   mechanisms defeat each other. `robots.txt` is therefore kept permissive (`Allow: /`); the `noindex`
   meta is the actual exclusion mechanism.
3. **The sitemap is removed.** The `@astrojs/sitemap` integration and the `Sitemap:` line in
   `robots.txt` are dropped (and the dependency uninstalled). A noindex site advertising a sitemap is
   contradictory, and the generated `sitemap-index.xml` would otherwise stay reachable.

## Consequences

- Out of search results, link-sharing + OG previews intact. This is the documented Google recipe for
  "exclude from search": allow crawling + `noindex`, do not block in `robots.txt`.
- Two things are now non-obvious to a future contributor and would "fix" the site back into search if
  changed: the **absence** of a sitemap (looks like an oversight — it is deliberate) and the choice of
  `noindex` over `Disallow`. This ADR records both so neither is reverted by reflex.
- Reversible: lifting the event into public search later is deleting the meta tag (and, if wanted,
  restoring the sitemap). Recorded not because it is hard to undo, but because the _why_ is invisible in
  the code.
- Not adopted: gating the whole site behind Cloudflare Access. That would contradict the public
  participant list and the share-by-link design; Access stays scoped to the operator admin (ADR-0008).
