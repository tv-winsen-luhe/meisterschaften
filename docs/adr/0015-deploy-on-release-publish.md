# Deploy on release publish, not on push to `main`

ADR-0012 made **push to `main`** the deploy trigger (continuous deployment,
gated by `deploy: needs: checks`), and ADR-0014 set up SAVR releases as a pure
**documentation narrative**, explicitly _not_ a deploy trigger. This inverts that
second half: **deploy now fires when a release is published**, and a push to
`main` no longer deploys.

## Driver

We want control over the **go-live moment**. With continuous deployment, every
merge to `main` instantly changes the live site — which is wrong for this site
specifically: it runs a four-phase event (ADR-0006) and a live tournament
weekend, and half-finished work for a later phase (e.g. the Auslosung) must not
surface in production during the Anmeldung phase. Publishing a release is the
deliberate "ship it now" act; merging to `main` is just "this is reviewed and
queued." Production reflects the **last published release**, not the tip of
`main`.

## What this changes

- **`ci.yml` gains `on: release: [published]`.** The `deploy` job's condition
  moves from `push` + `ref == main` to **`github.event_name == 'release' &&
!github.event.release.prerelease`**. On a release event the checkout resolves
  the **tagged commit**, so exactly the released state is built, migrated, and
  deployed. Prereleases never deploy.
- **`needs: checks` stays** as the pre-deploy belt-and-suspenders, now running on
  the released tag commit. The tagged commit already passed checks as a PR (branch
  protection, ADR-0013), so this is cheap insurance, not the primary gate.
- **Push to `main` no longer deploys** — it only runs `checks` (keeping `main`
  continuously verified) and updates the SAVR draft (ADR-0014).
- **Releases are now both the narrative and the deploy trigger.** ADR-0014's
  per-milestone publish cadence loosens to **"publish whenever you want
  production updated"** — which may be a single `fix`. `fix`/`feat` still drive
  patch/minor; `v1.0.0` is still cut by hand for the event-ready state.
- **Migrate-then-deploy moves to release time.** A migration merged to `main`
  sits unapplied until the next release; until then the old worker runs against
  the old schema — consistent. This is an improvement on ADR-0012's concern that
  a destructive migration auto-applied on push with no human approval: the
  **publish is now that approval point**.

## Break-glass

No CI escape hatch (no `workflow_dispatch`). If production must change without
cutting a release — e.g. an emergency fix mid-tournament — the existing local
`pnpm cf-deploy` (build + migrate + `wrangler deploy`) deploys the current state
directly. Adding an on-demand CI deploy is deferred until a real need appears
(YAGNI); publishing a release is already a one-click action.

## Supersedes / amends

- **ADR-0012** — the `deploy: needs: checks` gate stands, but its **trigger
  moves** from push-to-`main` to release-publish.
- **ADR-0014** — releases are no longer "not a deploy trigger"; publishing one is
  the deploy. The SAVR draft, semver-as-milestone, and no-standing-environment
  decisions are unaffected.

## Considered alternatives

- **Keep continuous deploy on push to `main` (ADR-0012).** Simplest, but gives no
  control over when the live site changes — unacceptable given the phase model
  and the live weekend.
- **A `workflow_dispatch` manual-deploy button.** A phone-friendly "deploy now"
  without a release. Deferred — local `pnpm cf-deploy` already covers break-glass
  and a second deploy path dilutes the "release = deploy" clarity.
