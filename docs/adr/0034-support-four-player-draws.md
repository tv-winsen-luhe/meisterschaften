# ADR-0034: Support 4-player draws with an extended 2-seed table (deviation from DTB §30.5a)

- Status: accepted
- Date: 2026-06-28
- Refines: ADR-0021 (small-N is a design constraint), ADR-0025 (draw materializes the matches aggregate)

## Context

DTB Turnierordnung 2026 §30.5a tabulates seeds by field size starting at **8 → 2 seeds**; it has no row
for a 4-field. Our smallest competition (Damen, `capacity` 8) can realistically draw just 4–7 confirmed
entrants — and a field whose `drawSize` rounded to 4 was `unsupported-size`: it could not be drawn **at
all**, an operational dead end (a 4-woman field simply could not be cast). Making the public homepage
draw preview dynamic (size from the confirmed field, not the static capacity — see CONTEXT: Draw size)
sharpened the gap: with no 4-field support, the preview either floors at 8 (over-promising a field that
will draw smaller) or has nothing honest to show.

## Decision

Add a seed table for size 4 — `SEED_GROUPS[4] = Nr.1 → line 0, Nr.2 → line 3` — the same two fixed,
single-seed groups the 8-field uses, extended one size down. Because `drawBlocker` keys off
`isSupportedDrawSize` (which is `SEED_GROUPS[size] !== undefined`), this one table entry **auto-unblocks**
the size-4 draw; no separate gate change. A 4-draw is two semifinals + final, two fixed seeds (no lot —
Nr.1/2 only), byes assigned to the seeds first (§31), and **no consolation bracket** — at size 4 the
first round _is_ the semifinal, so the third-place match already pairs its two losers (ADR-0004). The
homepage preview floors its displayed bracket at draw size 4 accordingly.

This is a **deliberate deviation** from §30.5a, whose Hauptfeld table starts at 8. It is a faithful
extension of the §30.5b 2-seed pattern, not an approximation of a rule that exists — DTB simply does not
cover Hauptfeld sizes below 8 (it routes very small fields to Round Robin, §30.5c, which this KO-only
project does not run). Recorded here so the invented `SEED_GROUPS[4]` row reads as intentional, never a
mis-transcription of the official table.

## Consequences

- **Size 2 stays unsupported.** Two entrants are a bare final — one match, no seeding lot — not a draw.
  The smallest field we cast is 4; 2–3 confirmed round up to a 4-draw (with byes).
- The blocker reason copy widens from „nur 8er- und 16er-Felder" to include 4er-Felder.
- Test expectations flip: a field rounding to size 4 (3–4 confirmed) is now drawable, not
  `unsupported-size` (`draw.test.ts`, `draw.integration.test.ts`). Size 32 (17+ confirmed) remains the
  unsupported case the small-N guard rejects.
