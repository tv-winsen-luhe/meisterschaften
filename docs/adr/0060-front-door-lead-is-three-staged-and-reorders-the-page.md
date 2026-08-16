# ADR-0060: The front-door lead is three-staged inside `tournament`, and the page reorders around it

- Status: accepted
- Date: 2026-08-16
- Revises: ADR-0042 §2 (the homepage keys off the phase alone) and its rejection of
  "three full compositions per phase" / "reordering is composition"
- Builds on: ADR-0027 (three phases, the middle is derived), ADR-0041 (the schedule publish gate),
  ADR-0046 (the public bracket's two-phase reveal), ADR-0008 (static Astro, client-side reads)

## Context

ADR-0042 made the homepage a phase-projected front door: one read of `GET /api/phase` on load, the
signup affordances removed, the hero lead and header CTA swapped, `#draw` revealed. That shipped
(ADR-0042, Revision 2026-08-15) and it is correct as far as it goes — but two gaps showed up when we
looked at the page as a visitor would during the event weekend.

**First, `tournament` is one lead for three very different moments.** The single `tournament` lead
reads „Das Feld steht, die Auslosung läuft. … Zum Spielplan". Between the signup deadline (19.08.)
and the first draw, that sentence is simply false — nothing is being drawn yet. And its CTA points
at `/spielplan`, which until the publish gate opens (ADR-0041) shows only „noch nicht
veröffentlicht". The front door points at an empty room for the first stretch of the very phase it
was built for.

**Second, re-pointing is not enough when the order is wrong.** `#draw` sits behind Event,
Konkurrenzen and „Das Feld"; Modus, Ablauf, Drumherum and FAQ sit above nothing at all. During the
weekend the two sections a visitor came for are below three sections of signup-era marketing. The
hero CTA jumps past them, but the page itself still reads as a landing page with a tournament
bolted underneath.

ADR-0042 explicitly rejected reordering ("reordering is composition") and explicitly restricted the
homepage to the phase value alone. Both restrictions were right for what was being built then: the
`tournament`/`post-event` surfaces barely existed, so composing for them would have been composing
for nothing. That is no longer true — `/spielplan`, the public bracket and the reveal show all
exist and all carry real content. The restrictions have outlived their reason.

## Decision

**Inside `tournament`, the lead is three-staged, derived from two existing public reads; and from
`tournament` onward the page presents its sections in a results order rather than a marketing
order.**

1. **Three stages, derived — no fourth phase value.** ADR-0027 stands: `signup → tournament →
post-event` remains the operator's whole vocabulary. "After the deadline, before the draw" is not
   a missing phase — it is the Competition lifecycle's `not drawn` seen from the front door. The
   homepage derives its stage from two reads it already has contracts for:

   | Stage          | Condition                    | Leads with                   |
   | -------------- | ---------------------------- | ---------------------------- |
   | 1 — Feld steht | `tournament`, no bracket yet | „Das Feld" (`#participants`) |
   | 2 — Auslosung  | any bracket exists           | „Der Draw" (`#draw`)         |
   | 3 — Spielplan  | the schedule is published    | `/spielplan`                 |

   `drawn` = `GET /api/draw` returns a non-empty `brackets` array. `schedulePublished` = the
   `published` flag `GET /api/schedule` already carries. Precedence is published → drawn → neither.

2. **A running reveal already counts as stage 2.** `/api/draw` is non-empty from the first revealed
   step (ADR-0003/0046), so the lead points at the draw _while the show runs_ — the single highest-
   attention moment of the event. The alternative (wait for a fully revealed bracket) would mean
   reconstructing the reveal cursor's meaning on the front door, which is exactly the per-competition
   logic ADR-0042 §2 was right to keep off this page. "Is the brackets array empty" is not that
   logic; it is one bit.

3. **ADR-0042 §2 is narrowed, not abandoned.** The homepage still does not model the per-competition
   lifecycle, does not track which field is running, and does not render a bracket state machine. It
   reads **two booleans**. The rule becomes: _the front door reads the phase plus whether the two
   downstream surfaces have anything to show._

4. **The section order is a function of the phase, and there are exactly two orders.**
   `signup` keeps today's marketing order. `tournament` **and** `post-event` share one results order:

   ```
   signup:            Hero → Event → Konkurrenzen → Feld → Draw → Modus → Ablauf → Drumherum → FAQ → CTA
   tournament /       Hero → Draw → Feld → Event → Konkurrenzen → Modus → Ablauf → Drumherum → FAQ
   post-event
   ```

   Nothing is deleted — Konkurrenzen keeps explaining the fields once its „Anmelden" buttons are
   gone, and „Das Wochenende" stays as the static overview behind the real schedule. Only the
   _order_ changes, which is why this is not the "three full compositions" ADR-0042 rejected: it is
   **one** composition with two orderings.

5. **Mechanism: CSS order on one DOM, driven by the existing attribute toggle.** The section wrapper
   becomes a flex column and each section carries an `order` class that only applies under a wrapper
   class the phase read sets. No second markup tree, no JS node-moving, no SSR, no rebuild — ADR-0008
   is untouched and the swap stays as auditable as the one ADR-0042 introduced. The header nav
   reorders with it (same mechanism, already a flex container): a nav whose order contradicts the
   page is a map of a different page.

6. **The header CTA follows the lead's primary action.** It is „Wer ist dabei" / „Tableau" /
   „Spielplan" per stage, instead of a fixed „Spielplan" that lands on the unpublished notice in
   stages 1 and 2. One rule — the stage decides where the page points — applied in both hero and
   header.

7. **The rule lives in one pure function**, `frontDoorLead({ phase, drawn, schedulePublished })`,
   in its own module under `src/scripts/`, unit-tested across the full input cross-product and
   imported by the phase-projection script. It is deliberately **not** in `shared/phase.ts`:
   `shared/` is the wire contract between worker and client, and `drawn`/`schedulePublished` are not
   phase-contract values — they are two observations only this page combines. (The
   `homepagePresentation` helper ADR-0042's PRD described was never built; the logic has lived inline
   in `phase-projection.ts`. This is that seam, finally cut, one function wider than planned.)

8. **Failure degrades downward, never upward.** The two extra reads happen only when
   `phase === 'tournament'`; `signup` and `post-event` still cost one read. If either fails, the lead
   falls back to **stage 1**, not to the signup lead: understating what exists is safe, overstating
   it sends visitors to an empty page. As under ADR-0042/ADR-0059, all of this is optics — register
   and cancel enforce the closed window server-side.

## Considered and rejected

- **A fourth phase value** (`signup → drawing → tournament → post-event`), the shape the question
  arrived in. It reverses ADR-0027 for a boundary that has a crisp derived trigger (a bracket exists),
  which is precisely the test ADR-0027 and ADR-0041 both apply. It would cost a migration, a stepper
  step, a re-audit of every phase-reading surface and the cron gate — and it would add a flip the
  operator can forget, in exchange for a state the system can already see. Rejected.
- **Leaving the order alone and only strengthening the CTAs.** Cheapest, and it was ADR-0042's
  position. But the hero CTA already exists and the complaint is not that the draw is unreachable —
  it is that the page's own shape says "landing page" during the event. Rejected.
- **Hiding Event/Konkurrenzen during `tournament`** so the draw rises by itself. Simpler than
  ordering, but it destroys content that stays true (what the fields are, who plays in them) to
  achieve a layout effect. Rejected.
- **Embedding the schedule on the homepage.** Rejected on ADR-0042 §1's unchanged ground: the front
  door points, it does not become a second live surface. The „jetzt auf dem Platz" summary strip
  (issue #91) remains the intended future content of the stage-3 lead — a summary that links out, not
  a second rendering of the board.

## Consequences

- The homepage makes up to three reads on load in `tournament` (phase, draw, schedule), all
  `no-store`, all already served publicly. No new endpoint, no schema change.
- ADR-0042 keeps §1 (front door, not a live surface), §3's mechanism and §4's three content
  categories. Only §2's "phase alone" and the reordering rejection are superseded here.
- The stage-1 copy promises the reveal runs on this page („live, hier auf dieser Seite"). That is
  true because `#draw` is revealed from `tournament` onward — if the show ever moves to its own
  surface, that sentence must move with it.
- Two orders means one new failure mode to watch: a section added later gets a marketing-order slot
  by default and no results-order slot. The order classes live beside each section, so the omission
  is visible where it happens rather than in a central list.

## Amendment (2026-08-16): Konkurrenzen keeps its content but not its imperative

§4 said "Konkurrenzen keeps explaining the fields once its ‚Anmelden' buttons are gone". That is
half right, and the half it got wrong is the section's own headline: **„Wähl dein Feld."** Removing
the buttons leaves an imperative standing over four fields nobody can enter any more — and the note
under it („Dein Feld wählst du bei der Anmeldung selbst") repeats the instruction in prose. The
section is not deleted (the "hiding Konkurrenzen" rejection above still stands: a visitor reading
the draw needs this section to know what „Herren Challenger" means) — but its **framing follows the
phase like every other signup affordance does**.

1. **The trigger is the phase, not the draw.** „Wähl dein Feld" is false from the moment signup
   closes, not from the first bracket. The three stages of §1 steer _where the page points_; they do
   not decide whether a sentence is true. So the header swaps at `signup → tournament`, the same
   boundary that removes the „Anmelden" buttons and (per §4) flips the order.

2. **One descriptive core, two gated add-ons.** The field description itself is phase-independent
   and stays a single string — no second copy to drift. Only the time-bound sentences are gated,
   as separate paragraphs beside the `SectionHeader` (whose `note` is a string prop, not a slot):

   | Line                                                    | Visible in             |
   | ------------------------------------------------------- | ---------------------- |
   | „Vier Felder, zwei je Seite: …" (the description)       | all phases             |
   | „Dein Feld wählst du bei der Anmeldung selbst, …"       | `signup`               |
   | „Startgeld: 5 € pro Person, bar vor Ort beim Check-in." | `signup`, `tournament` |

   The headline becomes „Die vier / Felder." from `tournament` onward.

3. **`data-phase-lead` learns multiple values.** Matching becomes a split on whitespace
   (`data-phase-lead="signup tournament"`), because the binary cut _signup vs. the rest_ is exactly
   what §4's two orders need as well — a single-valued attribute would force every such element into
   two identical hidden copies. The matching itself is a pure function beside `project()` and is
   unit-tested; the DOM plumbing around it stays untested as before.

4. **Conversion blocks join the existing swap set.** The two `FieldFlip` blocks answer „traue ich
   mich?" — a question nobody has after the deadline — and the Damen cross-sell line („meld dich
   einfach für beide an") is a signup instruction that shipped **ungated**, i.e. visibly false on the
   tournament weekend. Both carry `data-signup-lead`, the attribute that already means "signup-only
   block". No new attribute. The cards, their chips and their blurbs stay: they describe the field.

5. **The cards end without a CTA, deliberately.** Linking each card to its bracket was rejected on
   ADR-0042 §1's unchanged ground — the front door points, and four card-level jumps into `#draw`
   would build a second navigation next to the results order.

6. **The evergreen Startgeld FAQ is not an inconsistency.** „Was kostet die Teilnahme?" keeps its
   answer in every phase while the identical sentence is gated out of the Konkurrenzen note. A FAQ
   **answers a question that was asked**; a note sentence **asserts unprompted**. A price that is
   looked up ages differently from one that jumps at you. Recorded here so the next reader does not
   "fix" it.

The ungated cross-sell line ships on its own as a bug fix; the rest is built with the order swap in
issue #267, since both rewrite the same section.
