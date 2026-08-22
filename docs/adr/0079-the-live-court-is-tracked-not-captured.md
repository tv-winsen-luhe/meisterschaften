# ADR-0079: The live court is tracked, not captured — and the status is a control, not a ratchet

- Status: accepted
- Date: 2026-08-22
- Builds on: ADR-0032 (the Live phase records reality; the `running` transition captures the actual court)
- Relates to: ADR-0038 (the schedule grid drags, with a tap fallback), ADR-0069 (the planned time is a
  reservation, not an announcement), ADR-0077 (the operator reads the plan, the public reads the
  announcement — and the divergence is shown, not resolved), ADR-0033 (block the impossible, warn the
  unwise), ADR-0022 (form constraints are hints, the contract stays server-side), ADR-0078 (a suspension is
  reality, not a message)

## Context

A match on the day it actually happened: **Brettschneider vs. Kraatz, planned on court 4.** It started, moved
to court 5 because 5 came free, stopped for rain, and resumed on court 4. The organiser went to the Spielplan
surface and dragged the card — and nothing anywhere changed.

Nothing was broken. `matches` carries two courts on purpose (ADR-0032): `court` is the **reservation** the
operator planned against, `liveCourt` is the **actual** court, and every public surface renders
`liveCourt ?? court`. But `liveCourt` was written in exactly one place — the `planned → running` transition —
and the admin offered its dropdown only while a match was still `planned` (`result-match-row.tsx`). So from the
moment a match started there was **no lever anywhere in the UI** for „sie sind jetzt auf Platz 5", and the one
the organiser reached for was pointed at the column reality had already overridden. The grid was not lying by
accident; it was showing a reservation that no longer described anything, with nothing next to it that did.

The same edge produced a second complaint from the other side: a match set to „läuft" by mistake could not be
set back. The Store has always supported it (`setMatchStatus` clears `liveCourt` on `planned`) and the endpoint
has always accepted it — only the UI never offered the button.

The organiser's own reading was that the two-court model might be the mistake. It is worth answering directly,
because the pain is real and the diagnosis is not: two fields were never the problem. **One of them was
write-once and invisible on the surface the operator was looking at.**

## Decision

**The actual court is tracked for the whole life of a match, the grid shows it, and the status is an ordinary
control with no privileged direction.** Six rules.

1. **`liveCourt` is editable throughout `running`, not captured at the transition.** The court control stays
   on the row after the match starts; changing it writes the actual court immediately. This is the one-line
   correction that makes the field mean what its name says — _the court it is on_, not _the court it started
   on_ — and there was never a reason for a fact that visibly moves to be written once.

2. **The two courts stay two.** A reservation and a runtime fact are different things, and ADR-0069 already
   conceded exactly this about the _time_: the planned start is „a reservation the operator makes, never an
   announcement". The court is the same distinction in a different unit. Collapsing them would put the
   placement validator's occupancy rules — a planning instrument — in the way of recording where two people
   are actually standing, and would make ADR-0077 rule 3's `Platz 3 (geplant 5)` unrepresentable one day after
   it was written to make a mis-started match noticeable.

3. **The Spielplan grid card shows the actual court when it diverges, and does not move.** The card stays
   parked on its reservation — that is what the cell's position _means_, and a card that relocated would make
   the grid's occupancy read as a claim about reality — but it reads „→ Platz 5" so the surface stops being
   silent about the thing it is not showing. The grid's job here is to stop lying, not to become the lever.

4. **The status control is freely settable, and „undo" is not a concept.** The row's „Läuft" button becomes a
   control over **geplant · läuft**, settable in any direction, which dissolves the mis-clicked-„läuft"
   complaint without inventing a reversal vocabulary. There is no undo stack, no confirm, and no history: the
   status is a small enum with a picker on it, and the operator states what is true.

5. **Setting `geplant` still clears the actual court**, unchanged. An un-started match is on no court, and a
   `liveCourt` surviving a return to `geplant` would send the public board to a court where nothing is
   happening.

6. **`beendet` stays outside the control and stays one-way.** Reaching it needs a score, and reaching it _from_
   `done` has to decide what happens to a winner already advanced into the parent match and possibly seeded
   into the third-place playoff (`resultPatches`). „Korrigieren" edits the result; nothing un-finishes a match.
   This is a **named gap**, not an oversight — if a wrongly-finished match turns up at a real tournament, this
   is the rule to reopen, and reopening it means designing the cascade, not adding a button.

## Considered and rejected

- **Collapse to a single `court`.** The organiser's own suggestion, and the simplest mental model by a wide
  margin: moving the card _is_ moving the match. It loses three things, and the third is the one that decides
  it — the placement validator would start hard-blocking a _runtime_ fact against a _reservation_ („court 5 is
  taken at 14:00", when court 5 is where they demonstrably are); ADR-0077's divergence display becomes
  unrepresentable; and the plan you built is gone from the record the moment reality touches it. See rule 2.
- **Make the grid drag the lever: dragging a `läuft` card writes the actual court.** The most faithful reading
  of the complaint as it was phrased, and the most dangerous. One gesture on one card would mean two different
  columns depending on a status badge, and it walks into the same validator collision as collapsing the
  fields. See rule 3 — the grid gets the _information_, not the write.
- **An explicit „Zurücksetzen" / undo action on a running match.** What the second complaint literally asked
  for. A freely-settable control is strictly smaller and strictly more capable: undo answers „take back the
  last thing", which is not what the operator needs at 15:40 when a match is in the wrong state for reasons
  nobody remembers.
- **Enforcing the transitions server-side.** ADR-0022 keeps the contract on the server, but that rule is about
  _data integrity_, and there is none at stake here: `/api/admin/match/status` is a pure state write over a
  closed enum with no invariant to protect. Every ordering is representable in the database already, and a
  transition table would be code defending a rule nobody stated.
- **Marking a match „unterbrochen" while its court is suspended.** Worked through at length and rejected in
  ADR-0078 Amendment 2: the suspension is a property of the **court**, and rule 3 of ADR-0078 — a waiting
  match _is_ `running` — is what makes the Zwischenstand's home unambiguous.
- **Timestamping the actual start when the status moves.** Rejected once already in ADR-0069, for the reason
  that has not changed: it adds work at the busiest desk of the weekend to improve a number the spectator has
  stopped reading. Making the court editable adds a control the operator uses only when reality moved; a
  timestamp would be paid on every single match.

## Consequences

- **`CONTEXT.md`'s Match status entry is now wrong and is corrected with this decision.** It says the actual
  court is „captured" at the `running` transition. The word becomes **tracked**, and the glossary gains the
  fact that the planned court is a reservation the actual court may leave and return to.
- **ADR-0032 gains a `Revised by` pointer.** Its §Context states that the desk „reliably knows only two events
  per match" — it started, it finished. That is the sentence this decision contradicts: the desk also knows
  _where_, continuously, and the model now lets it say so. The ADR keeps its text (ADRs are the record of what
  was decided when), following the ADR-0040 → ADR-0069 pattern.
- **The divergence is now a durable state, not a transient.** `Platz 3 (geplant 5)` used to be a fact fixed at
  the start; it can now change three times in an afternoon, and every surface joining the two courts re-reads
  it on each poll. Nothing caches a court.
- **The grid stops being purely a planning surface.** A card that shows „→ Platz 5" is displaying live truth on
  a canvas whose geometry means reservations. That mixture is deliberate and it is the first of its kind here;
  the reason it is safe is rule 3's boundary — the grid _shows_ the actual court and never _writes_ it.
- **A published plan and a played tournament diverge visibly and permanently.** After the weekend the record
  holds both, which is what makes „was M7 played where we said?" answerable at all.
