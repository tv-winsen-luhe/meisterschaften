# Public repo for free branch protection

ADR-0012 gated deploy and auto-merge with CI job dependencies because branch
protection and rulesets are unavailable on a **private** free-plan repo, and
listed the two ways out — make the repo public, or pay for GitHub Team — as
"rejected for now; revisit if either becomes acceptable." This is that revisit:
we **made the repo public** to get rulesets for free.

The source is proprietary (all-rights-reserved, see `LICENSE`); public means
world-_readable_, not world-_usable_. Nothing in our security model depended on
the repo being private: `/admin` is gated by Cloudflare Access at the edge
(ADR-0008), all secrets live in GitHub Actions / `wrangler secret put` (never in
the repo), and the only repo-resident identifier — the D1 `database_id` — is
useless without account auth.

## What this changes

- **History was squashed** to a single `chore: initial commit` before going
  public — a clean-slate starting point, not a security measure (the history
  held no secrets). The full pre-squash history is archived locally as a git
  bundle + `pre-squash` tag, never pushed.
- **`main` is protected by a ruleset**: require a pull request, require the
  status checks `checks` (from `ci.yml`) and `commitlint` (PR-title lint) to
  pass, require linear history, block force-pushes and deletions, no admin
  bypass.
- **The PR title is the commit subject.** Merges are squash-only with
  `squash_merge_commit_title = PR_TITLE`, so what lands on `main` is the PR
  title, not the individual PR commits. `commitlint.yml` therefore lints the
  **PR title** (against `@commitlint/config-conventional`), not the per-commit
  messages it used to — those get discarded by the squash. The local
  `commit-msg` hook stays as bypassable hygiene.
- **Dependabot auto-merge moved to `gh pr merge --auto`.** It no longer runs the
  checks inline (branch protection does that now) and no longer checks out or
  executes PR code, which closes the `pull_request_target`-with-write-token hole
  the self-checking version carried.

## What stays

ADR-0012's `deploy: needs: checks` gate stands as belt-and-suspenders: the push
to `main` is the deploy trigger, and re-running checks before deploy costs
little and catches a bad `main` however it arose.

## Considered alternatives

- **Stay private with the ADR-0012 workarounds** — keeps the source closed but
  leaves merges advisory (a maintainer can merge their own red PR) and keeps the
  riskier self-checking dependabot workflow.
- **Pay for GitHub Team** (~€4/user/month) — gets rulesets while staying
  private, but is a recurring cost for a single-maintainer club project.
