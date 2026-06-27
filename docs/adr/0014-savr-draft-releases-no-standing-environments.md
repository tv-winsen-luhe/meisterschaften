# SAVR draft releases; no standing environments

> **Partly superseded by ADR-0015.** This ADR frames releases as a pure
> documentation narrative that is _not_ a deploy trigger. That second half no
> longer holds: **publishing a release now triggers the production deploy**
> (ADR-0015), and the per-milestone publish cadence below loosens to "publish
> whenever you want to ship." The SAVR draft mechanics, semver-as-milestone, and
> the no-standing-environment decision are unchanged.

Now that the repo is public with conventional-commit PR titles landing on `main`
(ADR-0013), that commit stream is a ready-made input for a release tool. We
adopt [SAVR](https://github.com/21stdigital/savr-action) to maintain a GitHub
Release narrative, and — separately — decide **not** to run a standing staging
environment.

The driver for releases here is **documentation, not operations**: a single
Cloudflare Worker is deployed continuously on every push to `main` (ADR-0012),
there is no published package, no API version contract, and no external consumer
of a version number. A release is therefore a human-readable "what shipped and
when" — a milestone narrative for the now-public repo — and nothing more.

## What this changes

- **`release.yml` runs SAVR on every push to `main`.** SAVR keeps a _single_
  draft GitHub Release up to date: it computes the next semantic version and
  release notes from the conventional commits since the last tag (= the
  squash-merged PR titles `commitlint` already gates). It only drafts — it does
  **not** tag, deploy, or write a `CHANGELOG.md`. The narrative lives in GitHub
  Releases, the surface a public-repo visitor checks; we deliberately did not add
  a committed changelog file (a bot-owned file + release PRs for an offline-clone
  audience a one-maintainer club project doesn't have).
- **Publishing is manual and per-milestone.** The draft accrues `fix`/`feat`
  notes across many merges; we hit publish only when a coherent milestone has
  shipped — mapped to the epics (`v0.1.0` online registration → `v0.2.0`
  draw → `v0.3.0` live → `v0.4.0` post-event). Per-merge publishing would
  make the Releases page noise, not narrative.
- **Semver is a milestone label, not a compatibility signal.** A website has no
  consumers, so `major` carries no external meaning. We let `fix`/`feat` drive
  patch/minor automatically and **avoid `feat!` / `BREAKING CHANGE`** so SAVR
  never auto-bumps major — `v1.0.0` is cut **by hand** to mark "ready for the
  championship weekend." The climb to 1.0 _is_ the project's story.
- **SAVR owns the version from the first draft — no hand-seeded tag.** SAVR's
  `initial-version` input is set to `0.1.0`, overriding its `1.0.0` default, so
  the narrative starts at `0.1.0` (the shipped online-registration system)
  without us ever creating a tag by hand. The first real tag is cut the moment we
  publish the first draft; until then SAVR drafts forward from `0.1.0`. (We
  briefly seeded a manual `v0.1.0` release+tag, then removed it in favour of
  letting SAVR drive the version end to end — fewer moving parts and the version
  is never authored in two places.)

## No standing environment

`wrangler.toml` already disables every secondary hostname (`workers_dev = false`,
`preview_urls = false`) because the admin is gated **only** at the edge by
Cloudflare Access (ADR-0008): the worker has no auth of its own, so any second
hostname — a `*.workers.dev` URL, a per-version preview, **or** a `[env.staging]`
worker — is an un-gated, open admin API. A standing staging environment is
therefore not free: it would need its own Access application _and_ a second D1 to
migrate and keep in sync — recurring burden for a single maintainer.

For "prove it before it ships," `pnpm cf-dev` (`wrangler dev` + local D1) already
runs the whole stack locally. So **no standing environment.** The one legitimate
future trigger — not wanting the draw algorithm or live-results entry to debut in
production during the one weekend that matters — is a _rehearsal_ need, best met
by an **ephemeral, Access-gated staging worker** spun up while hardening the Live
epic and then removed, not by permanent infrastructure. Revisit then, not now.

## Considered alternatives

- **A committed `CHANGELOG.md` (release-please-style).** Versions the narrative
  with the code and reads offline, but owns a repo file and opens a release PR to
  merge each time — more machinery for an audience we don't have. Rejected.
- **Fully automated releases (publish on every push).** Removes the one manual
  step but turns the Releases page into one entry per `fix:`. The manual
  per-milestone publish is the whole point. Rejected.
- **A permanent staging worker.** Buys an internet-reachable pre-prod but doubles
  the stateful surface and adds a second Access application, cutting against the
  one-gated-hostname model just hardened in ADR-0013. Held in reserve as
  ephemeral-only.
