# ADR-0051: The Damen social mixer sits beside the championship — equality is equal offer, not equal outcome

- Status: accepted
- Date: 2026-07-07
- Builds on: the `CONTEXT.md` „Social mixer" entry (scope was left provisional there; this ADR settles it)
- Relates to: ADR-0034 (≥4 draw floor), ADR-0040 (Finaltag / court windows), ADR-0043 (capacity / field cut)

## Context

The Damen side has exactly **one** field today — the competitive championship (`womens`, „Winsener
Meisterin") — while the Herren have **two** (Championship + Challenger). The signal from a handful of
conversations (5, self-admittedly non-representative, all Damen 50) is that many women want
_Kennenlernen_ and shared play, not a title chase. An earlier design thread leaned toward **replacing**
the Damen championship with a social doubles mixer.

That replace move produces a gendered asymmetry: **a Herren club championship with a women's social
event around it** — „ein bisschen Damenkaffeeklatsch". The goal is an event where the women's offering
carries **equal standing**, without either pretending the format demand is symmetric (it isn't) or
letting the organiser decide top-down that „women don't compete".

## Decision

**The mixer sits _beside_ the Damen championship, not in place of it. Both are offered as equals.**

1. **Beside, not replace — four fields, asymmetric by type on purpose.** Herren = Championship +
   Challenger (both competitive); Damen = Championship + **Social mixer** (competitive + social).
   Deliberately **no** Damen Challenger and **no** Herren social: the demand signal is for a women's
   _social_ format, not a second women's competitive field; the pool cannot support more splitting (the
   ≥4 floor, ADR-0034, would starve the extras); and a manufactured Herren social would sit empty. The
   organiser does not assign a format by gender — women are offered **both** and self-select.

2. **Equality = equal _offer_ + equal _billing_, not guaranteed equal _outcome_.** Both Damen fields are
   advertised as first-class. If the championship still does not clear the ≥4 floor after an honest,
   seeded, equally-billed invitation, it does not run — and that is defensible, because it was offered as
   an equal and the women chose. Forcing the championship to run (or demoting it) would just be the
   organiser's fiat with the sign flipped.

3. **The earlier „lead with the mixer, keep the championship a quiet un-fed opt-in" is overturned** — it
   was a _demotion_ of the championship, incompatible with equal standing. Retained from it: **seed a
   visible core _before_ advertising — for _both_ Damen fields**, never advertise into empty fields
   (empty-field deterrence hits the socially-motivated audience hardest).

4. **Presentation carries the equality, not the field count.** The homepage leads with the event
   („Ein Wochenende für alle, jede Spielstärke, jeder Anspruch") and shows the four fields as
   **equal-weight cards with Damen ordered first** (reversing the old Herren-first story order — that
   order _was_ the „Anhängsel"). „Presentation follows field type" stays: the scarcity meter („X Plätze
   frei") only for competitive fields, **momentum** framing („wer schon dabei ist") for the mixer — honest
   per-field presentation, not a ranking.

5. **The mixer runs Sunday midday, on reserved side courts, inside the Finaltag.** „Full facility" ≠
   „every court in use": Saturday is over its day-budget from the two 16-draws (no court slack), Saturday
   evening has slack but is empty (abgeschoben, kills the Kennenlernen charm), and Sunday is the only slot
   that is **both full/festive _and_ has court slack** — ~18 of 36 day-slots used, festivity from finals
   and Siegerehrung, not from every court. Because a 4-draw Damen championship also plays its
   semis/final on Sunday, a Sunday mixer is **not** „beside the men's final" — it sits alongside the
   **Damen** final too, so the women are present in both modes on the biggest day: integration, not
   sideshow. `freizeitReservedSlots` is the reservation that guarantees the mixer its courts inside the
   busy day.

6. **Build now as a concrete-format hypothesis, soft-launched for feedback.** Rather than an inert
   „In Planung" teaser, open the field with a **concrete** proposal (rotating doubles, register alone,
   no result) and send the live site to individual women — starting with the warm Damen-50 core — for
   feedback. A concrete proposal elicits sharper reactions than an open question, and real registrations
   seed the visible core. The **field is open to all women** (ages ≥15, like the event); only the first
   _feedback round_ targets the Damen-50 core. Public **format specifics** stay soft until the feedback
   confirms them; „allein anmelden" is safe to state.

## Considered and rejected

- **Replace the championship with the mixer.** Produces the gendered asymmetry this ADR exists to avoid,
  and bets the whole Damen side on 5 non-representative conversations.
- **Struktur 2 — mirror the men (Damen Challenger) + an open/mixed mixer.** Fights the evidence (the
  signal is a women's social format, not a second competitive field), and splits an already-small pool.
- **Struktur 3 — add a Herren social for symmetry.** Manufactured symmetry; likely an empty field.
- **Equal _outcome_ (guarantee both Damen fields run).** Reintroduces organiser fiat; you cannot conjure
  a title chase the women don't want.
- **Saturday daytime** for the mixer — over the day-budget (~38 > 36 slots from the two 16-draws).
- **Saturday evening under floodlights** — court slack but empty facility; reads as abgeschoben and kills
  the Kennenlernen charm.
- **Format-neutral public copy** — weaker feedback and no seeded core than a concrete proposal soft-launched
  to a small, invited audience.

## Consequences

- **Asymmetric _participation_ is an accepted outcome**, not a failure: the men's championship may run
  while the Damen championship does not clear the ≥4 floor. The equality is in the offer and the billing.
- **The format stays provisional** (5 conversations) and is validated by the concrete-proposal feedback,
  not by more open-ended asking. If feedback breaks it big (fixed pairs, real scoring, a rotation engine),
  that is a `/to-prd` escape hatch, not this build.
- **Implementation follow-ups** (for `/implement`): rename slug `womens-challenger` → `womens-social`
  (id/slug/label/blurb; free — never registered); add it to `COMPETITION_SLUGS`; the „unseeded"
  competition trait (no LK, `confirm` without a seeding basis) — modeling detailed in `CONTEXT.md` →
  Social mixer, its own ADR deferred to when it is built; the momentum-framing homepage reframe with
  Damen ordered first; set `freizeitReservedSlots` 10 → **6** (3 side courts × a midday block).
