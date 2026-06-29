# ADR-0039: Git hooks lint at CI's posture and resync deps from the lockfile

- Status: accepted
- Date: 2026-06-29
- Relates to: ADR-0013 (branch protection makes CI the authoritative merge gate)

## Context

Two gaps in the `simple-git-hooks` setup:

1. **TS/TSX was never linted locally.** `lint-staged` ran `prettier --write` on TS/TSX but `eslint`
   only on `*.astro`. So every TS/TSX rule in `eslint.config.ts` — `max-lines`, `func-style`,
   `no-restricted-syntax` (no inline object types), the react-hooks rules — was enforced _only_ by
   CI's `pnpm lint` (`eslint .`). A violation surfaced after a push-and-CI round-trip instead of at
   the commit that introduced it.

2. **Deps drifted silently.** Nothing re-ran `pnpm install` when `pnpm-lock.yaml` changed under the
   working tree (a pull, a branch switch, a rebase), so `node_modules` could quietly diverge from the
   lockfile until something broke confusingly.

## Decision

**Make the hooks give fast local feedback that mirrors CI without exceeding it, and keep the working
tree installable.**

- **Pre-commit lints TS/TSX at CI's exact posture.** `'*.{ts,tsx}': ['eslint --fix', 'prettier --write']`
  — `eslint` with **no** `--max-warnings=0`. Errors block the commit; `react-hooks/exhaustive-deps`,
  which `eslint.config.ts` deliberately sets to `warn`, stays advisory. The local gate is a _subset_
  of CI's strictness, never a superset: nothing CI would merge gets blocked on your machine. `*.astro`
  keeps `--max-warnings=0` (no advisory-`warn` rule applies to Astro files), so the asymmetry is
  intentional, not an oversight.

- **ESLint and Prettier share one glob per file type, ESLint first.** `lint-staged` runs _separate_
  globs concurrently, so two globs that both edit the same file race. Bundling the two commands under
  one glob runs them sequentially. This also closed a pre-existing race: `*.astro` previously matched
  both the broad prettier glob _and_ the `*.astro` eslint glob.

- **post-merge / post-checkout / post-rewrite resync deps from the lockfile.** Each runs
  `scripts/install-if-deps-changed.sh`, which re-installs when the content-hash of `pnpm-lock.yaml`
  changed since the last install. The trigger is the **lockfile, not package.json**: with
  `saveExact`, direct-dep edits move the lockfile anyway, and watching the lockfile additionally
  catches transitive and `overrides` bumps (which `pnpm-workspace.yaml` pins for supply-chain
  reasons — ADR-relevant security state) that never touch package.json. Being hash-based, one script
  is correct from all three hooks with no per-hook argument parsing.

## Considered options

- **`package-changed` for the install trigger (rejected).** The obvious off-the-shelf tool, but its
  source hashes only package.json's `dependencies`/`devDependencies`, and its `--lockfile` flag
  hard-codes npm's `package-lock.json` — it cannot read `pnpm-lock.yaml`. It would therefore miss
  exactly the transitive/`overrides`-only changes we care about. A ~12-line content-hash script
  watches the real source of truth, is hook-agnostic, and adds no runtime dependency, so
  `package-changed` was removed.

- **`git-pull-run` (rejected).** Watches the real lockfile, but only on `post-merge` (git pull); it
  would leave branch switches and rebases uncovered.

## Consequences

- A TS/TSX lint error is caught (and auto-fixed where fixable) at commit time instead of after a CI
  failure. Pre-commit stays strictly aligned with CI, so it never becomes a second, stricter gate.
- `node_modules` stays in sync after pull/switch/rebase without thinking about it. The hash state
  lives at `node_modules/.deps-lock-hash` — git-ignored, and gone on a clean clone, so the first
  post-clone `pnpm install` (which itself installs the hooks via `prepare`) still runs.
- `simple-git-hooks` allows one command per hook and lists `post-checkout`/`post-merge`/`post-rewrite`
  in its `VALID_GIT_HOOKS`; pointing each at the one script satisfies both facts.
- **Not a glossary concept.** Hook, lint, and install policy is implementation, not language the club
  speaks, so `CONTEXT.md` gains no entry.
