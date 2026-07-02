# ADR-0047: Provisional seeding is LK-derived on every surface; the pre-draw preview shows placement, not the LK

- Status: accepted
- Date: 2026-07-02

## Context

On prod the public „Der Draw" **pre-draw preview** for the Herren Challenger placed the first two entries
of the participant list — Kasigkeit and Lühr, the earliest to register — onto the two seed lines, even
though Steimmig (who registered last) has the strongest LK (21.5 vs Lühr's 24.7) and is the true Nr. 1.

Root cause: two _affordance_ surfaces derive a seed from **list/cut position** instead of from LK. A
Challenger field is admitted first-come-first-served, so its participant list is ordered by registration
date (ADR-0043) and its LK is redacted on the public wire (ADR-0044). The preview (`renderPreview`) takes
`players.slice(0, seedCount)` of that registration-ordered feed as the seeds, so it both placed the wrong
players **and** had no LK left on the wire to place the right ones. The admin Setzliste (`seeding-surface`)
had the mirror flaw: it ranks a Challenger field by registration order, so it suppressed seed badges
entirely (`seedCount = 0`) rather than mis-mark them — leaving the operator with no view of the true
seeding either.

The **draw engine itself was already correct**: `confirmedForDraw` reads the real LK and sorts by
`seedingValue`, and `drawBracket` verifies strongest-first, so the actual draw would have seeded Steimmig
Nr. 1. This is a preview/affordance defect, not a draw defect. It is the same conceptual slip CONTEXT
already warns against — "the cut decides _who is in_, the seeding decides _where_" (ADR-0043): cut order
(Challenger = registration) and seed rank (always LK) are different axes, and the surfaces conflated them.

## Decision

**1. Seed rank is derived from LK on every surface, via one shared helper (ADR-0011), independent of the
cut/participant-list order** — mirroring the draw. A surface that _orders_ a field by registration (a
Challenger field) must still compute its _seeds_ from LK, never from row position.

**2. The public pre-draw preview shows the LK-correct seed placement, redacting the LK.** Which players sit
on the seed lines is the same accepted structural/relative-rank signal ADR-0044 (Decision 2) already keeps
public on the _drawn_ bracket; this extends that stance from the reveal to the preview. To place correctly
without shipping the LK, the public participants wire carries a redaction-safe `seedRank` (1..seedCount for
the LK-top seeds, `null` otherwise — so it reveals no more than the drawn bracket, where only the seeds are
identifiable). The Challenger **LK value stays nulled** and the **seed number stays undisplayed** for a
protected field (`playerEl` already omits both). This refines ADR-0044 Consequence 4: a public projection
joining a Challenger registration must still null the **LK value**, but it _may_ carry the **seed rank** —
relative rank is the sanctioned structural signal; the absolute LK is what the protection removes.

**3. The operator Setzliste keeps registration (cut) order and badges the LK-derived seed in place.** The
gated admin may read the full LK (ADR-0044), so it shows both jobs at once: the first-come cut as row order
and the true seeding as a badge on each seed wherever it sits. Badges therefore read out of numeric order
for a Challenger field (Nr. 1 may sit at the bottom) — a deliberate, honest signal that seeding ≠
registration order, not a bug to "sort away".

## Consequences

- One shared `provisionalSeeding` helper is the single source; `renderPreview` and `seeding-surface` stop
  inferring seeds from position and read seed rank from it.
- The public participants wire gains `seedRank` for **all** fields (redundant with LK order for a
  championship field, load-bearing for a Challenger one); the Challenger LK stays `null`. The participant
  list ignores it (a Challenger field renders as a registration-ordered friendly list with no seed markers).
- The draw engine is untouched — this ADR changes only the preview and the operator affordance.
- Standing trap (ADR-0044 Consequence 4) restated: **any new public projection that joins a Challenger
  registration must null its LK value.** It may carry the seed rank; it must never carry the LK.
