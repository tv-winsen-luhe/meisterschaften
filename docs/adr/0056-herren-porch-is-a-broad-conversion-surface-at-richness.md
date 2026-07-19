# ADR-0056: The Herren porch is a broad conversion surface at richness; the field split is fairness, not a barrier to dissolve

- Status: accepted
- Date: 2026-07-19
- Supersedes: **ADR-0054 for the Herren porch's realization only** — the audience flips (warm,
  hand-picked → the broad Herren membership) and the page moves from **thin → rich**. ADR-0054's Damen
  decisions (already superseded by ADR-0055) and the ADR-0052 porch mechanics are untouched.
- Builds on: ADR-0052 (per-side outreach porch), **ADR-0055 (the Damen parallel — the broad-audience
  premise-flip, and the rule that content protections survive a role change)**, ADR-0042 (front door is
  the one phase-projected surface), ADR-0017 (noindex, members-only, link-only), ADR-0051 (four fields,
  two per side), ADR-0048 (strength redaction is a wire decision — enforced for the protected Challenger)
- Relates to: the official-announcement effort (wayfinder map #213) and its surface decision (#215, the
  segmented Rundmail), #216 (the Herren Rundmail hook), #239 (the field-framing decision this ADR
  records), #220 (the front-door Challenger flip, rejected on the porch)

## Context

ADR-0054 defined the Herren porch as a **thin conversion porch**: a validated concept sent privately to
a **warm, pre-briefed** audience — the **15 soft-committed** Hauptfeld players and a **named Challenger
candidate list** — so the page only had to **convert** the already-convinced. „The thin porch already
did the Herren job" (it drew 12 Hauptfeld + 4 Challenger in its ADR-0052 form), so ADR-0054 kept it thin
and **abandoned** the ADR-0053 Herren widening (live momentum band, long explainers), never shipped.

The official-announcement effort (map #213) changes the premise the thin porch rested on. The surface
decision (#215) sends the **whole Herren membership** onto `/herren` via the segmented Vereins-Rundmail —
the Rundmail segments by gender, so Herren members land on `/herren`, Damen on `/damen`. The audience is
no longer 15 warm, pre-briefed players who need nothing explained; it is the **broad** Herren membership,
many of whom meet the event and the two fields for the first time on this page.

This is the **Herren mirror of ADR-0055**, which did exactly this for Damen. ADR-0055 flipped the Damen
porch from validation probe to broad conversion surface and explicitly left „**ADR-0054's Herren
conversion-porch realization … untouched**." This ADR touches precisely that: the same broad-audience
premise-flip lands the whole Herren membership on a porch that was validated only for the pre-briefed
few, and the **thin** realization no longer matches the audience.

**Amendment vs. successor** — decided on ADR-0055's own refine-vs-reverse test. ADR-0054's Herren
decision was „keep the porch **thin**; the widening is **not shipped**." This ADR **re-adopts a
widening** (a rich, broad conversion surface) and flips the audience premise (warm → broad) it rested on.
That **reverses** the core decision — it does not narrow or refine it. By ADR-0055's line („a reversal
earns a successor, not an amendment"), and because ADR-0055 is the _Damen_ document, the Herren change
earns its own successor: **ADR-0056**.

## Decision

The Herren porch's **realization** moves from **thin conversion porch → broad conversion surface at
richness** — the same page kind as the Damen porch under ADR-0055, now Herren-calibrated.

**What changes:**

- **Audience & channel flip.** The „warm, hand-picked, sent privately" premise is **dropped**. The
  Herren porch is the landing target of the **official segmented Rundmail** (#215) — the broad Herren
  membership, not the 15 soft-committed. Success stays **conversion volume** (Herren was always a
  conversion job, never the Damen probe's learning signal); the effort's metric is maximizing total
  signups before the **19.08.2026** Anmeldeschluss.
- **Thin → rich.** The porch gains structural richness at the **depth of the Damen porch** — Das Event /
  Deine Felder / Der Ablauf / Drumherum / FAQ / presence — each section **re-derived for the Herren
  audience**, not Damen-specific machinery imported wholesale. This ADR records the **realization
  change**; the section-by-section content spec is #241.

**The field-framing stance (decided in #239, recorded here):**

- **The split axis is strength / fairness, not motive and not team-membership.** Damen splits its two
  fields by _motive_ (social vs. competitive) to dissolve a self-image barrier; **Herren does not**.
  **Both Herren fields are competitive.** The split is playing strength — Herren Hauptfeld (`mens`) holds
  the strongest players; Herren Challenger (`mens-challenger`) holds serious-but-capped competition
  (Cap LK 20). It is explicitly **not** a „team players vs. non-team players" split (the Challenger
  contains Mannschaftsspieler too, from weaker teams / higher LK).
- **No Damen-style guided chooser — two equal-weight, self-confident competitive cards.** The reader
  self-selects by strength in seconds via the existing self-recognition `audience` lines
  (`tournament.ts`); neither card ranks above the other. There is **no motive-router** (no motive
  problem to solve) and **no strength-router** (it would spotlight the exact „Challenger = the weaker
  ones" hierarchy the framing must avoid).
- **The Challenger objection-flip is a _fairness_ flip, never a _shame_ flip.** It answers the one real
  blocker — _„werde ich hier abgeschossen?"_ — not _„bin ich gut genug?"_. The angle: the **strongest**
  players are in the Hauptfeld; here you play auf Augenhöhe, real Wettkampf, a real chance at a _wertig_
  title. The `Ab LK 20 · geschützt` chip carries the mechanic; the line carries the invitation.
- **The hero leads with belonging, then two equal doors.** It continues the #216 Rundmail hook
  (whole-club belonging + Wettkampf — „der ganze TV Winsen spielt, volle Anlage, echtes Turnierfeeling",
  the strongest shared pull in the interviews), then presents both competitive options equally — neither
  field led over the other. The current lead's „für Freizeit- und Einsteiger" register is **dropped**
  (it leans beginner and misstates the axis).

**Copy-discipline rule (the mirror of ADR-0055, pointed the other way):** reserve _„egal wie gut du
spielst" / druckfrei / keine Turniererfahrung / erstes Turnier_ language for the **Damen** side. On the
Herren porch, protection reads as **fairness and ambition, never reassurance**. In particular the #220
front-door Challenger flip („vielleicht sogar dein erstes Turnier? … keine Turniererfahrung nötig") is
**rejected on the porch** — that register is a compromise for the front door's gender-unknown _cold_
walk-up; on the segmented Herren porch it would devalue the field (the exact harm the concept owner
warned against).

## What still holds

- **The ADR-0052 porch mechanics stand:** `noindex`, no site nav to it, link-reachable only, the
  `GET /api/phase` → `/` signup-era redirect, and all evergreen content on the front door and linked,
  never restated. The Rundmail is a broader way to **hand out the link**; it does not change what the
  porch _is_. (A rich Herren porch adapts evergreen sections _Herren-framed_ as a **disposable**
  signup-era surface — the same ADR-0054 amendment precedent that licensed the rich Damen page: a
  temporary second copy, not the permanent full-standalone page ADR-0052 rejected.)
- **Strength redaction for the protected Challenger** (ADR-0048): no LK, no seeding on any public
  surface, including this porch. LK is the behind-the-scenes fairness mechanism (Cap LK 20), never a
  number to advertise.
- **Still members-only, still `noindex`** (ADR-0017): „broad" means the whole Herren membership via an
  official internal channel — not public, not search-indexed, not non-member reach.
- **The Damen porch** (ADR-0055) is untouched.

## Considered and rejected

- **A sixth ADR-0054 amendment, or amending ADR-0055.** Rejected on ADR-0055's own terms: this
  **reverses** ADR-0054's Herren realization (thin → rich, warm → broad), and a reversal earns a
  successor, not an amendment. And ADR-0055 is the _Damen_ document — burying the Herren change inside it
  would mislead a future reader.
- **Mirror the Damen porch wholesale** (motive-chooser, beginner-welcome block, „Das brauchst du hier
  nicht"). Rejected per #239: Herren has **no „nicht gut genug" barrier** to dissolve — that self-image
  scar is a Damen phenomenon. The Challenger players want _real_ Wettkampf on their level; a motive-split
  and beginner-reassurance would misstate the axis and **devalue** the fields.
- **The #220 beginner-reassurance Challenger flip on the porch** („erstes Turnier / keine
  Turniererfahrung nötig"). Rejected: a cold-walk-up compromise for the front door, not the register for
  a segmented Herren audience — see the copy-discipline rule.
- **Keep the porch thin under the broad send.** Rejected: the thin porch was validated only for warm,
  pre-briefed players who needed nothing explained. A broad member who meets the event here for the first
  time needs orientation and the two fields explained — the very gap ADR-0053 named and the thin ADR-0054
  porch could leave open only because its audience was pre-briefed.

## Consequences

- **Both porches are now broad conversion surfaces on the same segmented Rundmail.** The ADR-0054
  „conversion porch (Herren)" / „validation probe (Damen)" pair is now fully historical: the Damen probe
  was retired by ADR-0055, and the thin Herren conversion-porch realization is retired here. CONTEXT.md's
  **„Outreach porch"** glossary entry is updated so the Herren realization reads as a broad conversion
  surface at richness (docs-only, like the ADR-0055 recording).
- **The honest-field frame is symmetric in mechanism but opposite in register.** Both sides sell honestly
  to a broad members-only audience; Damen dissolves a _self-image_ barrier (motive split,
  beginner-welcome), Herren answers a _fairness_ concern (strength split, no beginner register). The
  copy-discipline rule is what keeps the two registers from bleeding into each other — the Damen
  protections must **not** migrate onto Herren, and the Herren fairness framing must **not** soften into
  Damen-style reassurance.
- **Broad reach raises the stakes of the field framing**, exactly as it did for the Damen protections
  under ADR-0055. A skill-hierarchy misstep („Challenger = the weaker field") in front of a hand-picked
  few was a small risk; in front of the **whole Herren membership** it reaches every returning and
  recreational player at once. „Two equal competitive doors, split by fairness not rank" matters **more**
  under the broad send, not less.
- **The section spec (#241) and the eventual build inherit this framing** — the hero belonging-lead, the
  two equal-weight cards, the fairness-not-shame Challenger flip, and the copy-discipline rule.
