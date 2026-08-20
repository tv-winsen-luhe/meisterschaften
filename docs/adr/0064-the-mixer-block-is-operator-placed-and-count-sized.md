# ADR-0064: The mixer block is operator-placed and count-sized

- Status: accepted; §6 superseded by ADR-0073 (the public line regains its court numbers, delivered as the
  resolved list on `/api/phase` — the block moved into Sunday, and a field on the grid names where it is).
  Everything else here still stands.
- Date: 2026-08-16
- Supersedes: ADR-0063 §1 (the block as a build-time constant) and §5 (its fixed concrete values)
- Builds on: ADR-0063 (the block warns, is ungated, is not a match — all still standing), ADR-0006
  (single-row app-state), ADR-0048 (one signal, every surface reads it), ADR-0062 (a cancelled
  competition leaves every surface)
- Relates to: ADR-0033 (block the impossible, warn the unwise), ADR-0040 (interval occupancy, per-court
  windows), ADR-0021 (small-N constants), ADR-0028 (English everywhere except user-facing copy)

## Context

ADR-0063 settled the mixer's court-time as a build-time constant and wrote down its own revisit trigger:
a `reservations` table would be „the right one if reservations were ever operator-editable". Both halves
of that trigger arrived within the day, from the operator:

1. **The block's width is not a constant, it is a function of the head-count.** Four players per court
   and the rest rotate out — nine registrants need two courts, twelve need three. `SOCIAL_MIXER_BLOCK`
   asserted three courts flat, so at today's nine confirmed entries the gauge reserves six slots and the
   grid shades a court the mixer will not use. The rotation script has had the rule all along
   (`Math.floor(n / 4)`, `scripts/social-mixer-rotation.mjs`); the app never learned it.
2. **The block has to move.** It is an appointment on a weekend that will slip, and the operator wanted
   it movable on the day rather than by a redeploy.

## Decision

**The block is resolved, not declared: `resolveSocialMixerBlock({ day, startSlot, confirmed, cancelled })`
is the one function, its two stored inputs are operator state, and its court set is derived.**

1. **Courts follow the head-count.** `clamp(floor(confirmed / 4), 1, 3)`, filled **from the top down** —
   three courts are [4, 5, 6], two are [5, 6], one is [6]. Top-down because the first court freed is
   court 4, and Sunday's finals run on courts 1–3, so the release lands where the finals can use it. The
   cap of three stands from ADR-0063 §5: at the field's cap of 16 four players rotate out rather than a
   fourth court being taken from the championship. The count is **confirmed entries**, read live and
   never frozen — while signup is open the block is a planning figure that should track reality, and a
   freeze would only have to be corrected by hand at the first Nachrücker. The same `floor(n / 4)` now
   exists twice on purpose: the rotation script stays plain Node with no build step, and a test compares
   the two rather than a shared module being forced across that boundary.

2. **Day and start slot are operator state**, two integer columns on the single `app_state` row
   (`social_mixer_day`, `social_mixer_slot`) defaulting to today's values (Sunday, slot 6 = 12:00). Two
   bounded numbers are not a case for JSON: the defaults mean no data migration and no
   „unparseable degrades to…" path, unlike `cancelled_competitions`. Set through
   `POST /api/admin/social-mixer-block` and a dialog in the schedule controls — **not** drag-and-drop:
   the block is not a card on the grid, and two selects are cheaper than a drag affordance for an object
   that exists exactly once.

3. **The duration stays fixed at three hours** and is not operator-editable. It is a property of the
   format (~9 rounds of 18 minutes plus a briefing), not of the time of day, and making it a third input
   would invite it to disagree with the printed rotation tables.

4. **The start is bounded by daylight, not by the derived courts**: the block must finish by 20:00, so
   start slots 0–16 (09:00–17:00) on either day, validated in the dialog _and_ server-side. Court 4 is
   dark (ADR-0040) while 5 and 6 are floodlit, so a per-court window would make the legal start times
   depend on the head-count — and a twelfth registration could then invalidate a time the operator had
   already chosen. One flat bound removes that coupling entirely, at the cost of an evening mixer nobody
   wants.

5. **A cancelled mixer resolves to `null`**, and `null` means „no block" on every surface: no shading, no
   `social-mixer-block` violation, `reserved = 0`, no public line. This closes a gap ADR-0062 left half
   open — the gauge already zeroed the reservation, but `overlapsSocialMixerBlock` knew nothing of
   cancellation and kept warning for a mixer that had been called off. The special case in
   `overview-surface.tsx` (`planRows.some(isUnseededCompetition)`) disappears into the resolver rather
   than surviving beside it.

6. **The public line loses its court numbers and rides `/api/phase`.** It becomes
   „Sonntag, 23.08. · 12:00–15:00 Uhr" on `/spielplan` and the front-door card — no place suffix at all
   („Nebenplätze" reads as second-class for a field whose whole claim is „integration, not sideshow",
   ADR-0051 §5, and a court number is answered on site in ten seconds). What remains public is the _time_,
   which is now movable state, so it rides the one signal both static pages already fetch once on load
   (ADR-0048) rather than earning an endpoint or a poll. The built HTML carries the default, so the page
   is correct without JS, and a failed fetch leaves the appointment standing — the same fail-open posture
   as the cancellation patch. The admin keeps the full sentence, courts included.

## Considered and rejected

- **A `reservations` table.** Still rejected, and now for a narrower reason than in ADR-0063: there is
  still exactly **one** block, and it now has exactly **two** stored numbers. A table earns its keep when
  a second reservation exists — that trigger is unchanged and still unmet.
- **Freezing the head-count at signup close.** Would make the block correct at one instant and stale at
  every other, and hand the operator a manual correction each time a Nachrücker moves up.
- **`ceil(confirmed / 4)`.** Would reserve court capacity for players who are not there — eleven players
  on three courts leaves a court short of a full doubles.
- **Filling courts from 4 upward** (what the rotation script printed). Frees court 6 first, which the
  finals cannot use, and keeps the dark court 4 in the block the longest.
- **Per-court evening windows for the block.** Correct in the small and wrong in the large: it makes the
  legal start times a function of the head-count, so a late registration can retroactively invalidate the
  operator's chosen time.
- **Drag-and-drop on the grid.** A drag affordance, a drop target and a collision story for a singleton
  that moves once, if ever.
- **Hard-blocking a move that lands on placed matches.** The soft `social-mixer-block` violation already
  names exactly those matches after the move (ADR-0033, ADR-0063 §2); a second, harder conflict path
  would be a new rule for an old problem. The dialog states the count up front („3 Ansetzungen liegen
  dann im Block") so the warning is not a surprise afterwards.
- **Keeping the court numbers public and patching them client-side.** Buys the participants nothing and
  makes a derived, drifting number a public promise.

## Consequences

- **`overlapsSocialMixerBlock` and `socialMixerReservedSlots` take the resolved block as a parameter**;
  the old `SOCIAL_MIXER_BLOCK` constant is gone, replaced by `SOCIAL_MIXER_DEFAULT_PLACEMENT` — a default
  the resolver starts from, not a value anyone reads directly. `validatePlacement` receives the block as
  an optional third argument — the worker passes nothing, because it only enforces the **hard** rules
  (`worker/app.ts`), so the server needs no block and no app-state read on the placement path.
- **The module dependency reverses.** ADR-0063 §1 had `schedule.ts` read the block; now
  `social-mixer.ts` reads `schedule.ts` (the grid constants and `slotStartMinutes`, newly exported) and
  `schedule.ts` holds only a type import back. The reservation is expressed in the grid's own coordinates
  — a day and a 30-minute start slot — and the overlap check stays in `schedule.ts` where the grid
  geometry lives, so there is no runtime cycle.
- **The wire field is `socialMixerPlacement`, not the resolved block.** `/api/phase` carries the
  operator's two numbers; the courts are resolved per surface from a head-count that is not public and
  that no public line names anyway. _(Superseded by ADR-0073 §2: the wire gains `socialMixerCourts`, the
  resolved list — the head-count stays unpublished, the courts do not.)_
- **The admin dialog states the derivation** („9 bestätigte Anmeldungen → 2 Plätze (5 und 6)"). Without
  it a shading that moves on its own reads as a bug.
- **`scripts/social-mixer-rotation.mjs` relabels its columns** to the top-down court set and gains a
  `--start=HH:MM` argument, because a moved block otherwise puts the wrong times on the sheet in the
  Spielleiterin's hand. The drift guard runs the script at **vitest config time** (workerd has no
  `child_process`) and hands its output to the test as a binding — the same trick `readCrons` already
  used for `wrangler.toml`.
- **The 2027 revisit inherits two more open values** on top of ADR-0063's: whether the head-count rule
  survives a changed format, and whether a second reservation has appeared (the table trigger).
