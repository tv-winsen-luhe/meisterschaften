# ADR-0035: The public schedule feed degrades per-slot — an unresolvable feeder is „offen", never a whole-feed 500

- Status: accepted
- Date: 2026-06-28
- Extends: ADR-0032 (the Live phase records reality and degrades to what it knows)
- Refines: ADR-0005 (the Live phase carries the public schedule)

## Context

The public schedule feed (`GET /api/schedule`, ADR-0005) resolves each match's two slots for display
through the shared `viewSlot` (`shared/schedule.ts`): a slot is a **player**, a round-1 **bye**
(„Freilos"), or an undecided **feeder** („Sieger M{n}", the winner of an earlier match — ADR-0025).
When a placed later-round match has an empty slot whose feeding match cannot be resolved, `viewSlot`
fell back to `{ kind: 'feeder', matchNumber: 0 }`.

That fallback was treated as an unreachable inconsistency — the bracket is materialized whole at draw
time (ADR-0025), so every feeder _should_ resolve. But it becomes reachable on a data inconsistency
(e.g. a registration row hard-deleted under a frozen draw), and the blast radius was wrong: the wire
contract requires `matchNumber: z.number().int().positive()`, so `scheduleResponseSchema.parse(...)`
threw on the **whole response**. One inconsistent slot returned a 500 and blanked the public
`spielplan.astro` for **every** competition (and the #91 live board, which reads the same feed) — even
though the feed's own missing-player path already chose to degrade a vanished player row "rather than
throwing." But that path degraded to a „Freilos" line — which carries the same later-round lie (a real
contestant rendered as having had a bye), so the feed was inconsistent on **two** axes: throw-vs-degrade,
and how honestly it degrades.

## Decision

**The public schedule feed degrades per-slot and keeps serving — one inconsistent match never fails the
whole feed.** This extends ADR-0032's principle (the Live phase shows what it reliably knows and degrades
the rest) from match status to the feed's slot resolution.

- **A vanished referent renders as „offen" (undecided), not „Freilos".** This covers both ways a slot can
  lose its referent under a frozen draw: a feeder whose match cannot be resolved, and a named player whose
  registration row is gone. A bye is a round-1 concept; showing „Freilos" in a later round would read as a
  free pass into the next round — an active lie. „offen" reads as "to be determined," the honest state of a
  slot we cannot fill. „Freilos" stays reserved for a genuine round-1 bye, where there really is no
  opponent.
- **The fix lives at the shared source, `viewSlot`** — not in the public `toSlot` alone — so both readers
  of `SlotView` benefit at once: the public feed stops 500-ing and the admin grid stops rendering the
  bogus „Sieger M0".
- **It is modelled as a fourth slot kind, `{ kind: 'unknown' }`, and the wire contract stays strict.**
  The slot is already a discriminated union (`player` | `bye` | `feeder`); a fourth honest variant is the
  natural shape. The rejected alternative — loosening `matchNumber` to admit a `0` sentinel — would weaken
  a true invariant (a real feeder number is always positive) and push the sentinel onto every client.

The match's own `number` keeps its defensive `?? 0`: a placed match is always present in its own bracket's
numbering, so that `0` is unreachable, and per-match feed isolation would be machinery for a state that
cannot occur (ADR-0021: small N).

## Consequences

- `SlotView` (`shared/schedule.ts`) and `scheduleSlotSchema` (`shared/admin.ts`) gain an `unknown`
  variant; `viewSlot` returns it instead of `matchNumber: 0`; `toSlot` both passes it through _and_ maps
  its own missing-player branch onto it (so the two vanished-referent paths agree); the admin grid
  (`schedule-surface.tsx`) and `spielplan.astro` render it „offen".
- The inconsistency is no longer surfaced loudly. That is deliberate — the audience is spectators, who
  cannot act on it; a later-round slot showing „offen" on the admin grid is the operator's tell, and the
  underlying repair is re-running the draw, not reading a 500.
- If a feed-wide integrity signal for the operator is ever wanted, it belongs in the admin surface, not in
  the public response's success/failure.

## Amendment (2026-06-28, issue #105)

The operator signal above is now realized. A grid-„offen" is _always_ an inconsistency (a healthy undecided
slot reads „Sieger M{n}"), so the admin schedule grid styles „offen" as a **warning** (amber) with a
„bitte Auslosung erneut durchführen" tooltip — the maintainer-facing tell ADR-0035 left to "if ever wanted."
A server-side `console.warn` in `schedule()` was the issue's suggested "cheapest path" but is **rejected**:
the Worker has no log consumer (`wrangler.toml` carries no `[observability]`/logpush), so a log would be cost
without a reader. The public `spielplan.astro` stays calm „offen" as decided above.
