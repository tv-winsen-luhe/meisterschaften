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
single-seed groups the 8-field uses, extended one size down, **and raise the draw floor to four**:
`drawBlocker` now requires ≥4 confirmed (was ≥2). Four is the smallest field that forms a real knockout —
a 2–3 field would round to a 4-draw with a **bye semifinal** (a player walks straight to the final,
breaking the two-matches-each guarantee), which is not a real bracket. So a 4-draw is **always full**:
two contested semifinals + final, two fixed seeds (no lot — Nr.1 → line 0, Nr.2 → line 3), and **no
consolation bracket** — at size 4 the first round _is_ the semifinal, so the third-place match already
pairs its two losers (ADR-0004). Fields of 2–3 are `too-few`, played off another way (round robin, or the
field is not formed) — not through this KO engine. The homepage preview still floors its _displayed_
bracket at draw size 4 — a render affordance for a still-forming field, deliberately distinct from the
≥4 castability gate.

This is a **deliberate deviation** from §30.5a, whose Hauptfeld table starts at 8. It is a faithful
extension of the §30.5b 2-seed pattern, not an approximation of a rule that exists — DTB simply does not
cover Hauptfeld sizes below 8 (it routes very small fields to Round Robin, §30.5c, which this KO-only
project does not run). Recorded here so the invented `SEED_GROUPS[4]` row reads as intentional, never a
mis-transcription of the official table.

## Consequences

- **The draw floor rises from 2 to 4.** 2–3 confirmed are `too-few`, not drawn — so a size-4 draw never
  carries byes (byes first appear from size 8 up). This keeps the size-4 topology clean: two contested
  semifinals, every entrant a real match.
- Blocker copy: „Mindestens **vier** bestätigte Anmeldungen nötig" (was zwei), and the size copy widens
  to „4er-, 8er- und 16er-Felder".
- Test expectations flip: a full 4-field (4 confirmed) is now drawable; **3 confirmed is now `too-few`**
  (was `unsupported-size`); 17+ (size 32) remains the `unsupported-size` case the small-N guard rejects.
- A future third-place / consolation slice (ADR-0004) inherits a clean precondition: with the ≥4 floor
  there is never a bye semifinal, so both semifinal losers always exist.
