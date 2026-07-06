# ADR-0050: The championship is TV Winsen's; TSV participation is a footnote, not a co-billing

- Status: accepted
- Date: 2026-07-06
- Revises the framing in: the `CONTEXT.md` „Championships" entry (previously „the joint club
  championship of TV Winsen/Luhe and TSV Winsen")

## Context

The site launched as a **partnership**: TV Winsen and TSV Winsen billed as equal co-organisers.
The hero read „TV & TSV Winsen, ein Wochenende", the OG image and page title carried both names,
and an „Das Event" section built on the headline „Zwei Vereine, eine Anlage." celebrated the two
clubs playing together.

The reality is one-sided. **TV Winsen organises the event and carries the time and cost.** TSV
Winsen plays on the courts under a usage contract (for 80 members) and pays less per head than TV
Winsen members — it uses the event without filling the partnership with life. Presenting the two
clubs as equal co-hosts overstates TSV's contribution and understates TV Winsen's.

## Decision

The event is **TV Winsen's club championship.** TSV members **may still enter** — the usage
contract stands — but they are a **footnote, not a co-billing.**

1. **Presentation only — the data model is untouched.** `club` still records both clubs
   (`shared/club.ts`), signup still asks which club you play for, and the privacy policy still lists
   both. Nothing about who _may register_ changes. What changes is the _framing_. The decision is
   deliberately reversible in copy: if the TSV relationship shifts, it is copy back, no migration.

2. **TV Winsen is the sole billed organiser** in the top-level billing: hero, OG image, page title,
   meta description. The „& TSV" is dropped from all of them.

3. **The „two clubs, one venue" partnership motif is retired.** The „Das Event" section's headline
   („Zwei Vereine, eine Anlage.") and its „beide Vereine gemeinsam" note are reworked around TV
   Winsen's weekend, without TSV in the lead.

4. **TSV eligibility lives in a single factual footnote** — the „Wer darf mitmachen?" FAQ — in a
   neutral tone: TV Winsen is the subject, TSV a plain additional clause, no „gemeinsam" / „beide
   Vereine" warmth. Neutral, not cold: overt pettiness reads worse in public than calm clarity, and
   the contract is real.

5. **Logos are unaffected.** Per-entry club logos in the participant list stay — they identify a
   _person's_ club, not a co-organiser. The signup modal's two logos stay too — they are the
   mandatory club **choice**, functional, not a partnership badge. „Gemeinsame Siegerehrung" also
   stays: its „gemeinsam" means _all competitions in one ceremony_, not the two clubs.

## Considered and rejected

- **Keep the equal partnership.** Honest to neither the effort imbalance nor TV Winsen's ownership.
  Rejected — it is the status quo this ADR exists to change.
- **Drop TSV participation entirely.** Overreach: the usage contract stands and barring members
  would be both unfriendly and contractually awkward. Rejected — the aim is to right-size the
  _billing_, not to exclude people.
- **A cold, minimal, near-apologetic TSV mention.** Reads as petty in public. Rejected in favour of
  the neutral footnote.

## Consequences

- The change is **outward-facing and TSV will notice** — that is accepted; it is a deliberate
  relationship stance, not an oversight.
- `facts.organizer` / `facts.eligibility` in `tournament.ts` are updated for consistency even though
  they are currently rendered nowhere, so the data source never contradicts the new line.
- Reversible in copy alone; no schema or contract change.
