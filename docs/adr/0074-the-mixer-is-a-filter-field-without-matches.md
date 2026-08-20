# ADR-0074: The mixer is a filter field without matches

- Status: accepted
- Date: 2026-08-20
- Relates to: ADR-0063 / ADR-0064 / ADR-0073 (the Mixer block is a configuration reservation, operator-placed,
  count-sized, and names its courts in public), ADR-0062 (competition cancellation after signup), ADR-0072
  (the weekend surfaces are scanned, not read), ADR-0041 (the publish gate), ADR-0048 (the one `/api/phase`
  signal)

## Context

The Schedule & results page carries a competition filter whose options are derived **entirely from the
feed**: a field is offered iff the feed carries a match for it. That is how a cancelled field leaves the
filter without anybody telling it (ADR-0062), and it is the reason the list is honest — it can only ever
offer what the page can actually show.

The Social mixer is invisible to that rule and always will be. The engine models **no mixer match**
(ADR-0063); the one thing it knows is _when and where_ the mixer occupies courts, and that is stated on the
page as the mixer's **band** at the head of its day — not as rows. So a woman who signed up for the mixer,
and only for the mixer, meets a filter offering „Alle · Damen · Herren · Herren Challenger" and no way to say
„show me my thing". Her appointment is on the page, but the one control that exists for „narrow this to my
field" does not know her field exists.

## Decision

**The Social mixer is offered in the competition filter as a field of its own, although it carries no
match — and selecting it narrows the schedule to nothing.** Three parts:

1. **The caller supplies the option, not the feed.** `scheduleView` takes `socialMixer?: boolean` and, when
   true, appends the mixer to the offered fields behind the ones the feed carries (where it already sits in
   display order). Absent means „do not offer it", so a caller that knows nothing about the mixer gets the
   filter as it was.
2. **Its availability rides the phase read, and fails open.** The page already reads `/api/phase` once on
   load for the mixer's band — cancellation, placement, courts (ADR-0073, ADR-0048). The chip is offered from
   the first render and withdrawn only when that read reports the field cancelled (ADR-0062), the same
   fail-open asymmetry the band has: briefly offering a chip for a cancelled field is a smaller harm than
   withholding the one control that finds an appointment somebody has to be at.
3. **Selecting it empties the board and leaves the appointment standing.** No mixer match exists, so the row
   filter matches nothing, no court column survives, no day section is rendered — and the band therefore
   falls back into its own home below the board, which carries its own day heading for exactly this class of
   state. That is the whole answer: the mixer's court-time is an appointment, and „your appointment, nothing
   else" is what the chip promises. The Live board, by the same unchanged rule every field uses, fades all
   six courts back — no mixer match can be on court.

The „nothing at all below two" rule still counts only the **drawn** fields: a single-field event plus the
mixer does not grow a filter it did not have, and the mixer's line stands on the page either way.

## Considered and rejected

- **A „Zum Damen Doppel" anchor link instead of a chip.** Honest about the mixer not being a row, and it
  scrolls rather than filters. Rejected because it answers a different question: the reader who taps a field
  wants the other fields _gone_, and on the Finaltag the band sits among several columns of matches that are
  not hers.
- **Leaving the mixer out of the filter.** The status quo, and defensible — the band is unconditional and
  never hidden by the publish gate, so nobody is missing information. Rejected on who the page is for: the
  mixer is a full field of this event with its own signup and its own participants, and being the one field
  the filter cannot name reads as being the sideshow ADR-0063 says it is not.
- **Synthesising a mixer „match" on the wire so the existing rule picks it up.** It would make the chip fall
  out for free and it is exactly the modelling mistake ADR-0063 spent its length refusing: a mixer match the
  engine believes in is a match the validator, the bracket and the results surface then have to have an
  opinion about.
- **A day filter („nur Sonntag") instead of a field filter.** What the chip effectively shows today, since
  the block is Sunday by default. Rejected because the block is **operator-placed** (ADR-0064): moved to
  Saturday, a „nur Sonntag" chip would be pointing at the wrong day while claiming to be the mixer's.
- **Highlighting the mixer's reserved courts on the Live board while the chip is active.** A new display
  device on a board whose single question is „what is on right now"; the courts are already named in the
  band.

## Consequences

- **The filter's option list has two sources.** It was purely feed-derived; it is now feed-derived plus one
  caller-supplied field, and the two carry different failure modes (fail-closed vs. fail-open). That is the
  hard-to-reverse part of this decision and the reason it is written down: a future „just derive the options
  from the feed" tidy-up would silently delete the mixer from the filter.
- **A selected field can legitimately render an empty board.** Every other selection guarantees at least one
  row, so „empty schedule" used to mean „nothing published" or „nothing matched by accident". `board-empty`
  stays suppressed while matches exist, so the state reads as „this field has no rows", not as an error.
- **The chip follows the publish gate even though the band does not.** The controls row is hidden until the
  page has matches (ADR-0041), so before publication the mixer's line stands alone and unfiltered — which is
  the state it was designed for. A lone chip that filters nothing would be a control with no counterpart.
- **The label is the shared one.** The chip reads „Damen Doppel", from `competitions[].label`, like every
  other chip and like the band's own heading. The porch's fuller „Damen Doppel-Mixer" stays the porch's
  override (`porch-damen.astro`) until the format naming is settled; this ADR does not touch it.
