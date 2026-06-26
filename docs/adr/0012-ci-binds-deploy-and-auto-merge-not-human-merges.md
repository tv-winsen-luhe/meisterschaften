# CI binds deploy and auto-merge, not human merges

> **Partly superseded by ADR-0013.** The repo is now **public**, so `main` has a
> real branch-protection ruleset. The two workarounds below for the _absence_ of
> branch protection are replaced: human merges are no longer advisory (required
> checks block them), and dependabot auto-merge uses `gh pr merge --auto` instead
> of self-running the checks. The **`deploy: needs: checks`** gate described here
> still stands. The rest of this ADR is kept as the historical record.

The repo is a **private repo on a free-plan organization**, where GitHub offers
neither classic branch protection nor rulesets (both APIs return
`403: Upgrade to GitHub Pro or make this repository public`). So required status
checks — the usual way to make a CI gate _block a merge_ — are unavailable.

We still want the philosophy from `CLAUDE.md` ("the CI check on PRs is the binding
gate, the local hook is bypassable"). Without merge-blocking we get there by gating
the two things that actually matter, instead of the merge button:

- A single **`ci.yml`** runs `format:check + lint + build + test` in a `checks` job on
  every PR and every push to `main`. The **`deploy` job declares `needs: checks`**, so a
  broken `main` is never deployed — regardless of how the bad commit got merged.
  Production is protected by job dependency, not by branch protection.
- **Dependabot auto-merge** (`dependabot-auto-merge.yml`) merges _immediately_ with
  `gh pr merge` (not `--auto`, which would itself require branch protection), so it
  cannot wait for the PR `checks` run. It therefore runs the **full check set inline**
  before merging — previously it ran only `pnpm build`. The highest-volume merge path
  is genuinely gated with no dependency on branch protection.
- **Human PR merges stay advisory**: `checks` reports red/green but cannot block the
  merge on this plan. For a one-maintainer project the residual gap (deliberately
  merging one's own red PR) is a discipline question, and deploy still won't ship it.

The `deploy` job **applies D1 migrations before `wrangler deploy`** (`wrangler d1 migrations
apply … --remote`, mirrored in the `cf-deploy` script). Migrate-then-deploy is the safe order:
the new worker must never run against an un-migrated DB, where a renamed or removed value would
read back wrong (the app-state Store silently degrades an unrecognised phase to its default). Both
steps are idempotent, so a no-op re-run is harmless. The trade-off: a migration now auto-applies to
production on push to `main`, gated only by `needs: checks` and not by a separate human approval —
so a destructive migration is as dangerous as any other un-reviewed merge. For value-changing
migrations the brief pre-deploy window (new DB, old worker still live) is accepted as negligible;
prefer expand/contract migrations when a window would matter.

This is the zero-cost option. The two ways to get true merge-blocking — making the
repo **public** (free, but the source becomes world-readable) or paying for **GitHub
Team** (~€4/user/month) — were rejected for now; revisit if either becomes acceptable.

The old standalone `deploy.yml` (which re-ran lint/format/build inline and had no test
step) is replaced by `ci.yml`.
