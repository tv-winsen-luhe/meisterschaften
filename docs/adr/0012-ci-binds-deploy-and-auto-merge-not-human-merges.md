# CI binds deploy and auto-merge, not human merges

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

This is the zero-cost option. The two ways to get true merge-blocking — making the
repo **public** (free, but the source becomes world-readable) or paying for **GitHub
Team** (~€4/user/month) — were rejected for now; revisit if either becomes acceptable.

The old standalone `deploy.yml` (which re-ran lint/format/build inline and had no test
step) is replaced by `ci.yml`.
