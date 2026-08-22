# ADR-0063: The social mixer's court block is a configuration reservation, not an entity

- Status: accepted; §1 and §5 superseded by ADR-0064 (the block became operator-placed and count-sized —
  its own „operator-editable" revisit trigger, met the same day). Everything else here still stands.
- Date: 2026-08-16
- Builds on: ADR-0051 (the mixer runs Sunday midday on reserved side courts), ADR-0033 (block the
  impossible, warn the unwise), ADR-0040 (interval occupancy, per-court evening windows)
- Relates to: ADR-0041 (schedule publish gate), ADR-0032 (live truth is never gated), ADR-0048 (one
  signal, every surface reads it), ADR-0058 (the unseeded trait)

## Context

ADR-0051 §5 reserved „Sunday midday on ~3 side courts" for the Social mixer and left the reservation as a
bare number — `socialMixerReservedSlots = 6` in `src/data/tournament.ts`, read by exactly one surface (the
admin's court-load gauge). Nothing else in the system knew the block existed. Two gaps followed from that,
and both were live going into the event weekend:

1. **The reservation did not reserve anything.** The schedule validator saw six ordinary free courts on
   Sunday midday; the auto-suggest would fill them. `CONTEXT.md` recorded the hole honestly — a player
   holding both a championship entry and the mixer had to be **hand-placed** outside the block, because
   „the validator cannot flag that clash".
2. **Nobody knew when the mixer started.** No time was ever fixed. The public copy the nine registrants
   read says only „im Lauf des Nachmittags" (`tournament.ts`), ADR-0051 says „midday", and the two had
   drifted apart. The mixer had no representation on any surface after signup: it is never drawn, so it
   materializes no `matches` rows, and every schedule surface renders matches.

The mixer needs a **time and a place that the system respects and shows**. The question is what kind of
thing that block _is_.

## Decision

**The block is configuration — a constant in `shared/social-mixer.ts` — not a row and not a match.**

1. **One constant, `SOCIAL_MIXER_BLOCK`** (day, courts, start/end clock minutes) lives in its own module
   `shared/social-mixer.ts` — beside `SCHEDULE`, not inside it, so the dependency runs one way
   (`schedule.ts` reads the block, never the reverse) and the mixer stays its own concept rather than a
   clause of the grid. Every surface reads that one constant:
   the validator, the admin grid's shading, the public `/spielplan` section, the front-door card, and the
   court-load gauge — whose `socialMixerReservedSlots` is now **derived** from the block rather than
   asserted next to it, so the gauge can no longer disagree with the reservation it is measuring.

2. **It warns, it does not block.** Placing a match into the block raises the soft `social-mixer-block`
   violation, overridable in the same dialog as `short-rest` and `finals-day`. This is a deliberate reading
   of ADR-0033: a reserved court is not _physically impossible_ the way an occupied court or a dark court
   at 21:00 is — it is an **organiser agreement**, exactly the „unwise" category. Hard-blocking it would
   also mean the operator could not overrule their own reservation on the day, when the schedule slips.
   The auto-suggest needs no change to respect it: `firstValidPlacement` already prefers warning-free
   cells, so it routes around the block on its own and only spills into it if Sunday is otherwise full.

3. **The public block is not gated by `schedule_published`.** ADR-0041 gates the _plan_ — the placements
   the operator is still building. A fixed appointment is neither the plan nor live truth; it is a
   published fact from the moment it is decided. Gating it would have hidden the mixer's start time from
   its participants until the unrelated championship schedule was finished.

4. **It is rendered statically.** `/spielplan` is a static Astro page (ADR-0008) and `shared/` is
   build-time reachable, so the block is server-rendered from the constant with **no wire field, no
   projection change, and no poll** — nothing about a fixed time needs polling. The ADR-0048 „one signal,
   every surface reads it" discipline is satisfied more cheaply than by extending `scheduleResponseSchema`.

5. **The concrete values** (settled here because they had never been settled anywhere): **Sunday
   (day 1), courts 4–6, 12:00–15:00.** Three hours, because the format needs them — roughly nine 18-minute
   rotation rounds plus a briefing. Courts 5 and 6 are the floodlit overflow valve for a packed _Saturday_
   (ADR-0040); reserving them on Sunday midday costs the finals nothing, which run on courts 1–3. Ending
   at 15:00 puts the mixer's participants at the Siegerehrung — the „integration, not sideshow" claim of
   ADR-0051 §5, actually delivered rather than asserted. Note the block bites wider than it looks: a
   90-minute match means **start times from 10:30 to 14:30** are warned on those courts.

## Considered and rejected

- **A synthetic `matches` row for the mixer.** Cheapest to write and the worst to live with: a row that is
  not a match leaks into the draw resolution, result entry, the live board, the public feed and the
  post-event archive, each needing its own special case. The mixer's whole design (ADR-0051, ADR-0058) is
  that the tournament engine does not model it; a fake match smuggles it in through the back door.
- **A `reservations` table.** The clean modelling answer, and the right one if reservations were ever
  operator-editable, plural, or per-edition data. Today there is exactly **one** block, for **one**
  weekend, whose values are known at build time — a migration, a store, a route and two clients to express
  a constant. Revisit when a second reservation appears; that is the trigger, and it is written down here
  so the next reader knows this was weighed rather than missed.
- **Hard-blocking the reserved courts.** Miscategorises an agreement as a physical impossibility, and takes
  away the operator's override on the one day they might need it.
- **Gating the public block behind `schedule_published`.** Would have withheld the start time from the
  participants for the sake of a flag that exists to hide an unfinished championship plan.
- **A wire field on `/api/schedule`.** Unnecessary once the page is recognised as static and the constant
  as build-time reachable.

## Consequences

- **`CONTEXT.md` → Social mixer needed correcting**, not extending: „the tournament engine never touches
  it" was no longer exactly true, and the standing note that a „both" player's championship match must be
  hand-placed because the validator is blind to the mixer is now obsolete — it sees the block. The mixer is
  still never drawn, seeded, scored or bracketed; what changed is that its **court-time is now visible to
  the validator** as a reservation.
- **The 2026 format is frozen** (ADR-0051 amendment), so the rotation itself stays offline: a printed
  Americano table per plausible head-count, generated by `scripts/`, carried by a Spielleiterin. Nothing
  about the rotation, the pairings, or any score enters the system. There is deliberately **no scoring** —
  the public copy promised „kein Ergebnis" to an audience that self-selected away from competition, and
  introducing a ranking on the day would break that promise.
- **Participant notification stays manual.** The project has no outbound mail channel at all (only a
  Telegram hook to the operator, `worker/notify.ts`); for nine registrants, a personal message from the
  operator is the proportionate answer, with `/spielplan` as the durable reference it links to. Building a
  mail subsystem for n=9 four days before the event was rejected on sight.
- **The block's values are event-specific and will need revisiting for 2027**, when both the format and the
  Damen championship question (ADR-0051 amendment) reopen.

## Amendment (2026-08-22): the rotation gains a printed page, not a route — and the field's names never enter the repo

The evening before the mixer, the ask arrived to turn the rotation into „eine HTML-Seite / Route" carrying
the actual field: who plays with whom, when. That is a direct request for the thing the Consequences above
declined, so the answer is recorded rather than assumed either way.

**The rotation stays offline; `--html` is a print target, not a surface.** `scripts/social-mixer-rotation.mjs`
gained `--html`, which emits the same sheets as one print-ready A4 page per head-count, and `--names`, which
puts the real field in the cells. Nothing is served, nothing is deployed, no route exists. The alternative —
an admin route reading the confirmed count out of D1 — would have been _more_ correct in one respect (it
could never print a stale count) and was rejected on three: it needs a release-publish deploy (ADR-0015) the
evening before, for a page that is dead after Sunday 15:00; it makes the rotation a thing the system knows,
which is precisely what this ADR and ADR-0051 §6 keep it from being; and a page behind Cloudflare Access is
worse than paper at the one moment it is needed — beside a court, on a fence, with nine people around it.

**The field's names arrive as an argument and are never committed.** This repository is public (ADR-0013).
`--names="…"` is therefore the only channel, the generated page is written to stdout so the caller redirects
it somewhere outside the working tree, and no default name list exists in the file. Reading the names from D1
directly was the tempting alternative and is the wrong one twice over: the script is plain Node with no build
step and deliberately needs neither network nor `wrangler` on the day, and a script that writes participant
data into the working tree is one `git add .` from publishing it.

**Names are used only on the sheet whose head-count matches exactly.** The „a sheet per plausible N" design
exists because the count is final only when everyone has turned up, and that is unchanged: at nine confirmed
the sheets printed are 8, 9 and 10, and only the nine-sheet carries names. Which _eight_ of nine turned up is
not knowable the evening before, so the 8- and 10-sheets keep numbers and a blank number-to-name legend.

**The pause is the timekeeper, and the role rotates.** At nine players two courts take eight, so exactly one
woman sits each round and the round count is nine — every player pauses exactly once, and no partnership
repeats. The sheet therefore names the pause column „Pause · nimmt die Zeit": whoever sits calls the change
at the printed time. It is a rotating role by construction, not a job for one person, and at a head-count
divisible by four nobody sits at all — there the sheet says the Spielleiterin keeps time, because a rule that
silently has no holder is how a block runs fifteen minutes long.
