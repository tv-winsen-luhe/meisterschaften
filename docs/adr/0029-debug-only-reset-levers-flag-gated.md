# ADR-0029: Reset is a debug-only set of levers, flag-gated, not an operator feature

- Status: accepted
- Date: 2026-06-27
- Relates to: ADR-0026 (draw finality), ADR-0027 (per-competition draw, unique index blocks re-draw),
  ADR-0008 (admin gated only at the edge under `/api/admin/*`)

## Context

During the pre-event build (the event is August 2026) we need to rehearse the full forward flow
repeatedly — confirm players, draw a competition, enter results, advance the phase — and then wind it
back to try again. The code deliberately makes the forward artifacts final: ADR-0026 makes the draw
final with no correction loop, and ADR-0027's `(competition, bracket)` unique index makes a re-draw
impossible. There is no "undraw", no bulk un-confirm, and no enforced way back to `signup`. So winding
back today means hand-editing D1. We want a reset capability **without** re-opening those finality
decisions for the live event.

## Decision

**Add reset as a debug-only capability — three levers that reverse the forward transitions — gated by
an env flag and absent in production, not an operator feature.**

- **Three levers, mirroring the forward transitions, torn down in dependency order** (registrations →
  draw → results; a draw references confirmed registrations by `regId`, so you cannot go back past a
  state whose artifacts still depend on it):
  1. **Undraw** (per competition) — reverses "Jetzt auslosen": deletes the `matches` rows and the
     `draws` row, returning the competition to _not drawn_ and freeing the unique index. Results are
     just columns on `matches`, so undraw is also the only "reset results" there is — no fourth lever.
  2. **Re-admit** (global) — reverses `confirm`: sets every `confirmed` entry back to `new`. Leaves
     `new` and `cancelled` untouched (reviving `cancelled` is the member's act alone — ADR-0018 — and a
     debug reset must not impersonate it). **Guards**: refuses while any draw exists.
  3. **Back to signup** (global) — reverses the phase transition: `setPhase('signup')`. **Cascades**:
     undraws all competitions first so the database is never left inconsistent (a draw in the `signup`
     phase is nonsensical). Deliberately does **not** touch registration status — `confirmed` entries
     are legitimate during `signup`. Re-admit stays the separate, explicit lever.
- **Flag-gated, default off.** A `RESET_ENABLED` env var. Set in `.dev.vars` locally (always on under
  `wrangler dev`); toggled on the deployed instance only during the pre-event test window and removed
  before go-live. When unset, the capability does not exist (endpoints return 403). This is the single
  switch that retires the tool for the live event.
- **Endpoints live under `/api/admin/reset/*`.** ADR-0008's invariant is load-bearing: a route outside
  `/api/admin/*` is born public. Debug routes are no exception — they sit behind Cloudflare Access like
  every other operator route, with the flag as a second gate.
- **A minimal, flag-gated debug section in the admin React shell** surfaces the three levers. The
  client learns the flag from a dedicated admin-only `GET /api/admin/reset` → `{ enabled }`, read
  best-effort alongside the list/draws/phase loads. (An earlier draft put `resetEnabled` on the public
  `GET /api/phase`; keeping it on an admin-only read instead leaves the public phase contract clean
  and the debug flag behind Access — the capability is its own concern, not phase data.) The server is
  the authority — every reset route enforces the flag regardless; the UI only hides itself when off.

## Consequences

- ADR-0026 and ADR-0027 stand **unchanged for the operator/live path**. Re-draw is still impossible
  through the normal surface; the only way to clear a draw is this debug lever, gated off in
  production. The tool is the documented exception, not a softening of finality.
- Not a glossary concept: reset is debug tooling, not language the club speaks, so `CONTEXT.md` gains
  no entry. The forward transitions it reverses are already modelled there.
- The cascade/guard split is intentional: only the top-level "Back to signup" tears down dependent
  artifacts automatically; the lower, surgical levers stay atomic and refuse rather than cascade, so a
  reset never destroys more than the lever names.
