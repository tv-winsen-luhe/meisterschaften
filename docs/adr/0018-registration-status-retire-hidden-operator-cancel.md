# ADR-0018: Registration status model — retire `hidden`, operator cancel converges on `cancelled`

- Status: accepted
- Date: 2026-06-26

## Context

A Registration carried four statuses: `new` → `confirmed` → `cancelled` / `hidden` (`shared/admin.ts`).
The two terminal states overlap. `hidden` was the **operator-initiated** exclusion — drop a row from the
public list and the draw but keep it (and its `ip` abuse signal); `cancelled` was the **member-initiated**
self-service withdrawal (`/api/cancel`, keyed by person). Two states that both mean "not participating,
keep the record", split only by _who_ pressed the button.

That split has no operational value for this event. When a confirmed player drops out, they tell the
tournament desk (WhatsApp, not the self-service form); the operator's mental model is that the entry is
simply **cancelled**. But the admin had no way to set `cancelled` — it could only `confirm`, `hide`, or
hard-delete. So the operator was pushed toward `hidden` to express a cancellation, and `hidden` accreted a
meaning it should not own.

The decision surfaced while redesigning the admin (ADR-0019): grilling the per-status actions exposed the
mismatch between the operator's model (a drop-out is `cancelled`) and the code (no operator cancel exists;
`hidden` is the only operator exclusion).

## Decision

1. **Drop `hidden`.** The status set is `new`, `confirmed`, `cancelled`. The "Versteckt" filter and the
   Verstecken/Einblenden actions leave the admin.

2. **Add an operator cancel, by id.** Repurpose the existing `hide` plumbing rather than build new:
   `/api/admin/hide` → `/api/admin/cancel`, the domain `hide(id)` transition → operator `cancel(id)` setting
   status `cancelled`. It is **distinct from the public self-service `/api/cancel`**, which is keyed by
   person and sends the member a cancellation notification (Telegram). The operator cancel is keyed by a
   single registration id and sends **no** member notification (the operator is the actor). Both paths
   converge on the one `cancelled` state.

3. **`cancelled` is terminal in the admin.** The only admin action on a cancelled row is hard-delete.
   Reviving a cancelled entry remains the **member's** act — re-registering revives the row (`register` →
   `revive`, the one-active-entry invariant). The operator cancel is guarded by a confirmation dialog
   (`alert-dialog`), so a misclick is prevented up front and no admin un-cancel is needed.

4. **Migrate existing data.** A migration converts any existing `hidden` rows to `cancelled`. Before the
   event the table is effectively empty, so this is a safety net, not a real backfill.

## Consequences

- The model is honest: one "not participating, keep the record" state, reached by either actor, rather than
  two overlapping ones. The admin loses a status filter and a pair of actions — a net simplification, in
  keeping with CLAUDE.md's "prefer the simple solution".
- The admin redesign (ADR-0019) is therefore **not** purely presentational. The domain change is small —
  the `hide` machinery is _retargeted_, not rebuilt — but it touches the `shared/` status enum, the domain
  transition, the endpoint + its Zod schema, and the admin UI.
- No draw or public-list logic changes: both already key off `confirmed` alone, so dropping `hidden` and
  adding an operator `cancelled` are invisible to them.
- `cancelled` now has two provenances (member, operator) behind one value. The row does not record which —
  acceptable, because nothing downstream needs to distinguish them; if that ever changes, provenance is a
  new field, not a new status.
