# Handoff — Damen Social mixer (RESOLVED → ready for `/implement`)

**Date:** 2026-07-07 · **Repo:** `tv-winsen/meisterschaften` (branch `main`) · **Event:** Winsener
Meisterschaften, 22./23.08.2026

## Status: the open question is closed

The earlier pause (2026-07-04) waited on field research to settle **replace vs. beside**. A
`/grill-with-docs` session on 2026-07-07 resolved it **without** waiting for more interviews, by
reframing the whole thing around **equal standing**. The reasoning is now recorded in **ADR-0051**;
the vocabulary is in **`CONTEXT.md` → Social mixer / Competition**. This doc is the **implementation
checklist**.

## Decision in one line

The Damen social mixer sits **beside** the competitive Damen championship (not replacing it); the two
are offered as **equals** — equality is **equal offer + billing, not equal outcome** (ADR-0051).

## Decisions (all settled — see ADR-0051 for the why)

1. **Beside, not replace.** Four fields; Damen = Championship + Social mixer. Asymmetric by type on
   purpose — **no** Damen Challenger, **no** Herren social.
2. **Equal offer, not equal outcome.** Both Damen fields advertised first-class; if the championship
   misses the ≥4 floor (ADR-0034), it just doesn't run. The old „lead with mixer / quiet championship"
   is **overturned**.
3. **Homepage:** event-level framing + four equal-weight cards, **Damen ordered first** (reverse the
   Herren-first order). „Presentation follows field type" kept: „X Plätze frei" only for competitive
   fields, **momentum** („wer schon dabei ist") for the mixer.
4. **Day:** mixer **Sunday midday**, reserved side courts, inside the Finaltag (full facility **and**
   court slack). Not Saturday daytime (over budget), not Saturday evening (empty/abgeschoben).
5. **Field scope:** **all women** (≥15). First **feedback round** to the Damen-50 core (warm start),
   field not closed to them.
6. **Size:** target ~12, cap ~16 (a court cap, not scarcity drama). `freizeitReservedSlots` **10 → 6**.
7. **Format (provisional, validated by the concrete proposal):** rotating doubles, register alone, no
   result. Rotation micro-mechanics stay offline (Spielleiterin).

## Build checklist for `/implement`

Likely a single session — the change set is modest.

- [ ] **Rename** `womens-challenger` → `womens-social` (id/slug/label/blurb in `src/data/tournament.ts`).
      Free: `status: 'planned'`, never registered, no migration.
- [ ] **Open the field:** add `'womens-social'` to `COMPETITION_SLUGS` (`shared/competition.ts`). This is
      what makes it registerable (and puts it in `signupCompetitions`, derived).
- [ ] **„Unseeded" competition trait** — an entry carries **no LK** and `confirm` / `canConfirm` needs
      **no seeding basis** (seedability is a property of the competition, not of every registration).
      One-active-entry stays scoped to **seeded** competitions (a woman may hold a seeded entry **and**
      the mixer). Modeling: `CONTEXT.md` → Social mixer. **Write its own modeling ADR (ADR-0052) here**,
      when the trait is actually built (deferred from ADR-0051 on purpose).
- [ ] **Homepage reframe:** four equal-weight cards, **Damen first**; momentum framing for the mixer
      (never „X frei"); the concrete mixer copy below replaces the „In Planung" teaser + the format-neutral
      interest CTA.
- [ ] **`freizeitReservedSlots` 10 → 6** (`src/data/tournament.ts`); the overview gauge picks it up.
- [ ] Drop the „Damen Freizeit" / „Challenger"-adjacent framing for this field everywhere (it is a
      **Social mixer**, not a Challenger).

## Concrete mixer copy (proposal — tunable)

User label: **„Damen-Doppel zum Kennenlernen"**. Card / detail one-liner:

> „Du meldest dich **allein** an. Wir spielen Doppel, die Partnerinnen wechseln reihum — so spielst du im
> Lauf des Nachmittags mit und gegen viele verschiedene. Kein Turnierbaum, kein Ergebnis, kein Titel —
> ein geselliger Sonntag zum Kennenlernen."

Keep public **format specifics** soft until feedback confirms them; „allein anmelden" is safe.

## After implementing

- **`/code-review`** on the diff.
- Then the operator sends the live site to the **Damen-50 core** for feedback (validates format + seeds
  the visible core). Only after a core is visible in the list: advertise the Damen side.
- Escape hatch: if feedback breaks the format big (fixed pairs, real scoring, a rotation engine),
  `/to-prd` → `/to-issues` instead of extending this build.

## Pointers

- **ADR-0051** (this decision), **ADR-0034** (≥4 floor), **ADR-0040** (Finaltag / court windows),
  **ADR-0043** (capacity / field cut).
- `CONTEXT.md` → Social mixer, Competition, Court budget, Active entry.
