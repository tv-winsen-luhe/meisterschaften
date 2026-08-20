# ADR-0073: The mixer block names its courts in public

- Status: accepted
- Date: 2026-08-20
- Supersedes: ADR-0064 §6 (the public line losing its court numbers) and the consequence that
  „`/api/phase` carries the operator's two numbers; the courts are resolved per surface from a head-count
  that is not public and that no public line names anyway". Everything else in ADR-0064 stands — the block
  is still operator-placed, count-sized, top-down filled, and still not an entity.
- Builds on: ADR-0064 (courts derived from the confirmed head-count), ADR-0063 (the block warns, is ungated,
  is not a match), ADR-0048 (one signal, every surface reads it), ADR-0062 (a cancelled competition leaves
  every surface)
- Relates to: ADR-0051 §5 (the mixer's „integration, not sideshow" claim — re-examined here and **upheld**,
  by the opposite presentation), ADR-0072 (the weekend surfaces are scanned, not read), ADR-0028 (English
  everywhere except user-facing copy)

## Context

ADR-0064 §6 removed the court numbers from the mixer's public line, leaving
„Sonntag, 23.08. · 12:00–15:00 Uhr", on two stated reasons: „„Nebenplätze" reads as second-class for a field
whose whole claim is „integration, not sideshow" (ADR-0051 §5), and a court number is answered on site in ten
seconds."

Reviewing `/spielplan` against a running build, the organiser asked for the opposite — the block moved off the
top of the page and **into Sunday, on courts 5 and 6**. That request is not a rejection of ADR-0051 §5; it is
a stronger reading of it than §6 managed. §6 protected the field from the word „Nebenplätze" by making it the
one thing on the weekend surface with **no place in the schedule at all**: a tile parked above the board,
outside `[data-board]`, untouched by the page's loading, error and unpublished states, sitting above the two
days rather than in one of them. A field whose claim is integration was the only field not on the grid. Naming
its courts is what lets it be a line **inside Sunday** like everything else.

The second reason survives contact with the surface less well than it reads. „Answered on site in ten seconds"
is true of every fact on this page — ADR-0072 settled that the reader who decides the trade-offs is „on site,
on a phone, choosing which court to walk to", and answered it by putting more on the page, not less. A player
who reads „12:00–15:00" and nothing else has to find someone to ask; the ten seconds are real but they are
spent, and they are spent by a participant in the one field that was told it was integrated.

Two facts constrain how the courts may be said:

1. **The court set is not „5 and 6"; it is a function.** `socialMixerCourts` is `floor(confirmed / 4)` clamped
   to 1–3, filled top-down: `[6]` at 4–7 confirmed entries, `[5, 6]` at 8–11, `[4, 5, 6]` at 12+
   (`shared/social-mixer.ts:57`). „Platz 5 und 6" is this year's expected head-count written down as if it
   were a property of the block. Hard-coding it prints two courts for a one-court reservation.
2. **The head-count is not public.** The mixer is unseeded and absent from the draw's tab list
   (`CONTEXT.md`, Social mixer), so its confirmed count appears on no public surface. Deriving the courts
   client-side would mean publishing that number.

## Decision

**The mixer's public line names its courts, derived and delivered as the resolved list.**

1. **The public line becomes day, time and courts** — „Sonntag, 23.08. · 12:00–15:00 Uhr · Platz 5 und 6"
   — on `/spielplan` and the front-door card. The admin's fuller sentence
   (`socialMixerWhenAndWhere`) and the public line now differ only in framing, not in facts.

2. **`/api/phase` carries `socialMixerCourts: number[]`, the resolved list — never the head-count.** The
   server runs `socialMixerCourts(confirmed)` and ships `[5, 6]`. This is the narrower disclosure: the courts
   are the fact a reader needs, the count is a fact nobody decided to publish, and one is not recoverable
   from the other (`[5, 6]` means 8–11 entries, not a number). The derivation also stays on the side where
   `socialMixerCourts` already lives, so no surface re-implements the clamp. The wire keeps
   `socialMixerPlacement` beside it: the placement is the operator's state, the court list is derived from
   state the wire does not carry, so neither replaces the other.

3. **The block is stated once, inside its day.** It becomes a **day-level band at the head of Sunday's
   section**, not a column entry repeated on each reserved court. The page groups day → court, and a
   three-hour appointment with no per-court content would otherwise appear two or three times and read as
   two or three events. This is where §6's protection actually lands: the band is as wide as the day, which
   is the opposite of a side-court footnote.

4. **The built HTML keeps shipping today's default and the fetch stays fail-open** — ADR-0064 §6's posture,
   unchanged. The page is correct without JS, and a failed `/api/phase` leaves the appointment standing with
   its default courts rather than blanking the line.

## Considered and rejected

- **Keeping ADR-0064 §6 and integrating without court numbers.** The recommendation put to the organiser,
  and it would have been the cheaper change — no wire field, no ADR. Rejected because the organiser is the
  reader who knows what the participants ask on the day, and because §6's own reasoning turns out to argue
  the other way once the block is in the day rather than above it.
- **Hard-coding „Platz 5 und 6".** Correct at 8–11 confirmed entries and wrong on either side of that. It
  would also re-assert as a constant exactly what ADR-0064 §1 established as a function, one ADR after
  establishing it.
- **Publishing the confirmed count and deriving client-side.** Saves a function call on the server and
  publishes a signup number for a field that appears on no public list. The court list is strictly less
  disclosure for strictly more use.
- **Repeating the band on each reserved court's column.** The most faithful reading of „auf den Plätzen 5 und
  6", and it prints one appointment two or three times. A reader scanning Sunday's columns would meet the
  same three hours twice with nothing to distinguish them.
- **Naming the courts as „Nebenplätze" or „Plätze 5 und 6 (Nebenplätze)".** The exact wording ADR-0051 §5 and
  ADR-0064 §6 were right to refuse. The courts are named by number, which is what a reader walks to; the
  ranking of courts is a venue fact for the auto-suggest (ADR-0068 §2), not public copy.
- **Making the court list operator state alongside the day and start slot.** Would let the operator override
  the derivation. Rejected as a capability nobody asked for: the head-count rule is the format, and ADR-0064
  already named „whether the head-count rule survives a changed format" as a 2027 revisit rather than a
  setting.

## Consequences

- **`CONTEXT.md`'s Mixer block entry changes its closing clause**, done in this change: „publicly as **day,
  time and courts**", the courts carried as the resolved list, and the band stated once inside its day. The
  „without court numbers" clause is gone.
- **ADR-0064 §6's remaining half stands.** The public line still rides the one signal both static pages
  already fetch once on load (ADR-0048) rather than earning an endpoint or a poll; §6 gains a field, it does
  not gain a mechanism.
- **The tile above the board is deleted, not moved.** With the band inside Sunday, the section above
  `[data-board]` has no content — which also removes the one public mixer surface that sat outside the
  board's loading, error and unpublished states.
- **The admin dialog's derivation line is unchanged** („9 bestätigte Anmeldungen → 2 Plätze (5 und 6)"). It
  states the head-count because the operator owns it; the public line states only the result.
- **A cancelled mixer still resolves to no block at all** (ADR-0062, ADR-0064): no band, no line, no field on
  the wire worth reading.
- **The 2027 revisit inherits one more open value**: whether a second reservation has appeared, now that the
  public surface names courts and a second band would have to be told apart from this one.
