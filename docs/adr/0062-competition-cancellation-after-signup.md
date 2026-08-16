# ADR-0062: A competition with too few entries is cancelled after signup, not shown short

- Status: accepted
- Date: 2026-08-16
- Amends: ADR-0034 (the ≥4 draw floor and its „ab 4" public notice — now explicitly signup-only)
- Relates to: ADR-0006 / ADR-0027 (operator-controlled state), ADR-0043 (field cut), ADR-0048 (one
  wire decision read by every projection), ADR-0007 (post-event archive), ADR-0021 (small N),
  ADR-0051 / ADR-0058 (the unseeded Social mixer)

## Context

Four competitions are offered; none is guaranteed to fill. ADR-0034 set the structural floor — a field
needs **≥4 confirmed** to be drawn — and gave the below-floor state a public presentation: an „ab 4"
notice („N / 4 — noch X bis zur Auslosung") on the draw surface, with the participant board dropping its
seed markers. That presentation was designed **during signup**, where it is a recruiting call: it tells a
member exactly what is missing and invites them to close the gap.

Once the signup window shuts (phase leaves `signup`), the identical state means something else. Nobody can
answer the call — registrations _and_ self-service withdrawals are refused server-side (ADR-0059). A field
standing at „3 / 4 — noch 1 bis zur Auslosung" through the whole tournament weekend is not information, it
is a promise the event cannot keep, sitting beside fields that are actually being played. The Social mixer
makes the gap plainer still: it is never drawn (ADR-0058), so the 4-floor does not apply to it at all, yet
a rotating-partner doubles afternoon with three entries is just as dead.

## Decision

**After the signup phase, a competition with too few entries is _cancelled_ by the operator and removed
from every public surface — one flag, enforced server-side, read by all projections.**

The load-bearing parts:

1. **The operator cancels; the count only advises.** Cancellation is an explicit per-competition act
   (`cancelledCompetitions`, a slug set on the `app_state` singleton row), not a state derived from the
   confirmed count at the phase transition. A derived rule would re-show a field the moment the operator
   confirms a late entry — _after_ everyone in it has been telephoned. The count drives affordance
   instead: the „Anmeldung schließen" confirm dialog **lists** the competitions under their threshold and
   links to the action, and never fires it.

2. **The threshold is the existing floor, plus one number for the mixer.** 4 confirmed for the drawn
   fields — the draw floor already _is_ „this field cannot happen"; inventing a second number would let
   the two disagree. The unseeded mixer, having no draw, gets its own explicit minimum (6).

3. **The registrations are not touched.** `cancelled` on a registration means „this person is no longer
   participating". Here the person's intent is unchanged and the _competition_ is gone. The rows stay as
   they are — they are the honest record of how many actually wanted it, which is exactly the number
   next year's planning needs. One fact in one place: the competition is cancelled, therefore nobody
   plays in it.

4. **Removal is a wire decision, not a rendering one.** The public API projections (participants, draw,
   schedule, live board) omit a cancelled competition; the Astro surfaces render what they are served.
   This mirrors ADR-0048's stance for strength redaction — one signal every public surface _reads_ rather
   than re-derives — and is held by a cross-projection test invariant. Client-side hiding is how a surface
   gets forgotten.

5. **Removal is total, except for one derived line.** Cards, participant list, draw, schedule, live board,
   and the post-event archive all drop the field; the archive records what _happened_ (ADR-0007), and a
   cancelled competition produced no match, no result, no champion. Against silent disappearance for
   someone who did register, exactly one factual line survives in the FAQ — **derived from the flag**, so
   it cannot be forgotten the way hand-written copy can.

6. **The admin never hides.** The operator surface keeps the competition and its registrations, visibly
   marked „abgesagt". It is the record, not the stage.

## Considered and rejected

- **Derive cancellation from the confirmed count at the phase transition.** No operator step, nothing to
  forget — but it makes the website's truth flip on a number the operator is still editing, and it flips
  it back on _after_ the phone calls. It also has no answer for the mixer, whose floor is a judgment.
- **Keep the „ab 4" notice through the tournament.** Zero work, maximum honesty about the raw number —
  and reads as an open invitation on a page where nothing can be answered.
- **Mass-cancel the registrations in the field.** Superficially tidy, and it would make every existing
  „active entry" query do the right thing for free. Rejected: it overloads a member-level status with a
  competition-level fact, destroys the entry count that justifies the decision, and would have to be
  undone row-by-row if the cancellation is reversed.
- **A `competition_state` table.** The relationally clean home for per-competition operator state, and
  where this belongs if such state ever grows past one flag. Today it is at most four slugs set once per
  event — a table with a row lifecycle is ceremony for that (ADR-0021).
- **A system-sent cancellation mail to the affected members.** There is no bulk-mail channel in the
  project (Telegram is an operator notification at the transport edge, not a member channel), and at the
  handful of people involved the personal call is the better product. The notification is **deliberately
  offline** — the website's job is to stop advertising a field that is not happening.

## Consequences

- **`app_state` now carries a per-competition fact.** It has been strictly global so far (`phase`,
  `schedule_published`). Storing a slug set there mixes levels on purpose; the moment a second
  per-competition operator flag appears, that is the signal to lift both into their own table.
- **Cancelling an already-drawn competition is blocked**, with the reason shown. A drawn field owns a
  `draws` row, materialized `matches`, and possibly schedule placements; hiding that behind a flag leaves
  exactly the phantom load the court-budget exclusion exists to prevent. The path is draw reset
  (ADR-0029), then cancel — two steps, both honest.
- **Cancellation is reversible** as a plain toggle: it materializes nothing, so there is nothing to
  reconcile on the way back. The confirm sits on the cancel, because the expensive half of the act is
  social, not technical.
- **The draw guard gains a second refusal reason** at the same seam as the ≥4 check, and the admin's
  court-load gauge excludes a cancelled field — otherwise the operator plans against load that will never
  arrive.
- **Losing a whole side degrades rather than special-cases.** If both Damen fields are cancelled the site
  reads as a Herren-only event, because it is one. The single concession: a competition filter left with
  one option does not render.
- **`cancelled` now names a state on two aggregates** — a registration and a competition. Kept
  deliberately: the word means the same thing in both („does not take place"), and coining a synonym to
  avoid the echo would make the glossary worse, not sharper. The glossary disambiguates by naming the
  aggregate.
