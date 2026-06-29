#!/bin/sh
# Re-run `pnpm install` whenever the resolved dependency set has changed, so the
# working tree never runs against stale node_modules after a pull, branch switch
# or rebase.
#
# It compares a stored content-hash of pnpm-lock.yaml — the lockfile is the source
# of truth, so this also catches transitive and `overrides` bumps that never touch
# package.json (which a package.json-deps check would miss). Being hash-based makes
# it hook-agnostic: the same script is correct from post-merge, post-checkout and
# post-rewrite, with no per-hook argument parsing.
#
# State lives under node_modules/ (git-ignored, and gone on a clean clone — so the
# first install after cloning always runs). See ADR-0039.
set -e

lock="pnpm-lock.yaml"
state="node_modules/.deps-lock-hash"

# No lockfile or no git (shouldn't happen inside a hook) → do nothing rather than fail.
current=$(git hash-object "$lock" 2>/dev/null) || exit 0

if [ -f "$state" ] && [ "$(cat "$state")" = "$current" ]; then
  exit 0
fi

echo "[deps] $lock changed — running pnpm install…"
pnpm install

# Re-hash AFTER a successful install: pnpm may rewrite the lockfile (e.g. dedupe),
# and recording the post-install state makes the next hook a no-op. Skipping this on
# failure means a broken install is retried on the next hook rather than recorded.
git hash-object "$lock" > "$state"
