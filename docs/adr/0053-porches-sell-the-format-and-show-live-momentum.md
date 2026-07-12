# ADR-0053: Porches sell the format and show live momentum

- Status: superseded by ADR-0054 (Damen side) / abandoned (Herren widening, never shipped)
- Date: 2026-07-07
- Revises: ADR-0052 (per-side outreach porches) — its core rationale stands; three of its scope
  decisions are widened here
- Builds on: the discovery interviews (`vault/documents/interviews/`) and the Matchday participant
  survey (n=21), which are the evidence for the widening
- Relates to: ADR-0042 (front door is the one phase-projected surface), ADR-0051 (the four fields,
  „zwei je Seite"), ADR-0017 (noindex, shareable by link), ADR-0043 („Plätze frei" / capacity)

## Context

ADR-0052 shipped the `/damen` and `/herren` porches deliberately **thin**: a targeted lead, the
side's two field cards, one CTA, a hand-off to `/`. In use, thin proved too thin. A cold WhatsApp
visitor could not tell _what the event is_ from the hero, and two business-card-sized cards cannot
explain two formats — least of all the two that most need explaining (the Challenger's LK-protection
and the Damen social mixer). ADR-0052 §2 already licensed „a fuller explainer for the format that
side must sell"; the porch never delivered it.

The **discovery interviews** say precisely where each audience stands, and it is not where we
guessed:

- **Herren (both fields).** The barrier is **not** self-doubt — every Hauptfeld interviewee is sure
  they belong. It is **scar tissue from dead past Meisterschaften**: „traurige Veranstaltung",
  „einsame Veranstaltung", „Anlage ist leer", „Spirit kam gar nicht rüber", „desperate". What flips
  them is **seeing a full, lively field**: „viel lebendiger durch die Anzahl der Teilnehmer", „würde
  mich total motivieren", „hätte ich Bock, wenn ich das nur sehe". The Hauptfeld is **12 of 16
  already signed up** — the most persuasive asset the interviews name (a populated field) exists in
  the live data _right now_, as proof rather than promise.
- **Herren Challenger.** The LK-protection is a _wanted_ selling point, not an apology: „Schutz find
  ich gut, dass ich die Chance hätte weit zu kommen", „viel besser, wenn das Niveau eng beieinander
  [ist]". The title „reads valuable" („klingt wertig") — no B-prize feeling. The pitch is Augenhöhe
  plus a real title, not „don't worry, it's the easy field".
- **Damen.** The barrier is **Selbstbild** — „die meisten Damen halten sich selbst für ‚nicht gut
  genug'" (Martina Robens); many self-sort out. The design answer she names: **LK-frei
  kommunizieren, niedrigschwellig, die Orga teilt die Felder ein**. Social ≫ Wettkampf.
- **Damen social mixer.** Its real job is concrete, not generic „Geselligkeit": the Damen <50 have
  **no teams**, barely know each other, and are **running out of Spielpartnerinnen** (Judika Klages).
  The rotating-partner doubles is the **Kennenlern-Maschine** that fixes exactly that — „lern die
  anderen Damen kennen, finde neue Spielpartnerinnen".

The **Matchday survey** adds one channel fact: vereinseigene Kanäle (landing page, social) drew **0
mentions**; demand came via **tennis.de + personal network / WhatsApp**. That validates ADR-0052's
premise — the porch's job is to convert a link handed into a group chat.

## Decision

The porch stays a **signup-era, single-audience, link-only** surface (ADR-0052's core holds), but it
**sells the format and shows live momentum** instead of being thin. Concretely:

1. **The hero orients a cold visitor.** It names the event (Winsener Meisterschaften 2026) and
   carries a compact orientation strip (date · venue · fee · who) — the four facts a WhatsApp
   visitor needs to not bounce. This is orientation, **not** the front door's Event section, which
   still stays on `/`.

2. **A live momentum band, treated asymmetrically per side.** The persuasion the interviews prove is
   _seeing a populated field_, so the porch reads `/api/participants` (reusing the front door's
   `ParticipantList` over the same data — ADR-0052 §3):
   - **Herren:** show the live count and the near-full scarcity („12 von 16 — sichere dir einen der
     letzten Plätze") and the real names. Proof, not promise.
   - **Damen:** **never a lonely count** — a bare „1 angemeldet" would reinforce the exact
     „bin ich die Einzige / nicht gut genug" barrier. Invitation framing („sei unter den ersten")
     below a small floor (**≥3 confirmed** before presence/names show); positive presence only.

3. **A fuller, barrier-led format explainer per field**, in **per-side content partials**
   (`explainer-herren.astro`, `explainer-damen.astro`), composed by `[side].astro`. Rich editorial
   prose lives as markup — as the front door keeps its section copy — not crammed into `sides.ts`
   strings. Each explainer _opens by naming that side's barrier_ (Herren: dead-event scar →
   „diesmal voll"; Challenger: Augenhöhe + wertiger Titel; Damen Haupt: „nicht gut genug" → LK-frei,
   die Orga teilt ein; Damen social: komm allein, keine Partnerin nötig, Kennenlernen), then
   explains how it works and who it's for.

4. **The compact cards stay** as the at-a-glance chooser + Anmelden, rendered from the one
   `CompetitionCard` over `tournament` data (unchanged). Explain in the section, summarise in the
   card.

## What still holds from ADR-0052

- **The route earns its keep at the preview layer** — per-URL `ogTitle`/`ogDescription`; that, not
  the page body, is why a route beats an anchor. Unchanged.
- **Link-only, `noindex`, no site nav to it.** Unchanged.
- **Signup-only with the phase redirect** — reads `GET /api/phase` on load and redirects to `/` once
  phase ≠ `signup`; a porch never becomes a results surface. The added `/api/participants` read is
  live momentum _within_ signup, not a step toward phase projection.
- **No evergreen-tail duplication.** Event, Modus, Ablauf, FAQ stay on `/` and are linked via the
  „→ Das ganze Wochenende" hand-off. The fuller explainers are _targeted, per-side_ content with no
  front-door equivalent — so nothing that must-not-drift drifts. This is the „A, not full page"
  choice: we widened the porch within ADR-0052 §2's license, we did **not** re-adopt the rejected
  full-standalone-page that restates the tail in „-flavoured" wording.

## Considered and rejected

- **Keep the porch thin, iterate copy only.** Rejected: the hero still would not orient a cold
  visitor and two cards still cannot explain two formats — the diagnosis ADR-0052 §2 already
  admitted.
- **Full standalone pages restating the evergreen tail per side.** Still rejected, for ADR-0052's
  reason — it re-opens the content drift ADR-0042/0051 closed. Escalate to this only if the fuller
  explainer proves _still_ too thin.
- **Static momentum copy instead of a live read.** Rejected: „12 von 16" is only persuasive because
  it is true _now_; a hardcoded number rots and a promise is weaker than proof.

## Consequences

- The porch is no longer „thin" — it is a **fuller, format-selling, momentum-showing** signup-era
  surface. It reads `/api/participants` in addition to `/api/phase`; both are public, signup-era
  reads, so no new gating.
- The asymmetric momentum band is a **presentation rule the porch owns**, not a data one: the same
  `/api/participants` payload renders as scarcity for Herren and as invitation for Damen. A future
  side declares which treatment it wants.
- Bespoke prose now lives in per-side partials — adding a side is a new partial plus a `sides.ts`
  entry, not a new composition.
