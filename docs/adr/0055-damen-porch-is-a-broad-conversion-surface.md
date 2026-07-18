# ADR-0055: The Damen porch is a broad conversion surface; the content protections survive the role change

- Status: accepted
- Date: 2026-07-18
- Supersedes: **ADR-0054 for the Damen porch's _job_ only** — the audience, the channel, and the
  success metric flip. ADR-0054's Herren "conversion porch" realization, and everything it inherits
  from ADR-0052, are untouched.
- Builds on: ADR-0052 (per-side outreach porch), ADR-0042 (front door is the one phase-projected
  surface), ADR-0017 (noindex, members-only, link-only), ADR-0051 (four fields, two per side)
- Relates to: the official-announcement effort (wayfinder map #213) and its surface decision (#215)

## Context

ADR-0054 defined the Damen porch as a **validation probe**: an instrument to validate and iterate a
concrete format guess, handed out **by link only to a warm, hand-picked audience** (commitment round,
Botschafterinnen, WhatsApp), **never a cold mass send**, with success measured as **signal, not raw
signups** — it "deliberately optimizes for learning over conversion volume." The reply channel was
"the personal conversation around the shared link," not an element on the page.

The official-announcement effort (map #213) changes the premise the probe rested on. The surface
decision (#215) sends the **whole Damen membership** onto the Damen porch via the segmented
Vereins-Rundmail — the Rundmail can segment by gender, so Damen members land on `/damen`, Herren on
`/herren`. And the effort's success metric is fixed as **maximize total signup volume before the
19.08.2026 Anmeldeschluss**, not per-field balance and not the porch's learning-over-volume.

That flips three load-bearing premises of ADR-0054's Damen decision at once:

1. **Audience:** warm, hand-picked → the **broad** Damen membership.
2. **Channel:** the personal WhatsApp thread → a **mass segmented Rundmail** ("no mass mailing" dropped).
3. **Success metric:** signal / learning-over-volume → **raw conversion volume**.

ADR-0054's own discipline is the deciding test. Each of its four amendments is tagged
"**refines, does not reverse**," and pins the harm or the change to a specific, narrow thing while
keeping the core premise. This change does the opposite — it **reverses** the core premise (the job
of the page). By ADR-0054's own refine-vs-reverse line, a reversal is not another amendment; it earns
a successor.

## Decision

The Damen porch's **job** changes from **validate-and-iterate a format guess** to **convert a broad,
segmented member audience**. It becomes a **broad conversion surface** — the same page kind as the
Herren conversion porch (ADR-0054), now serving a broad rather than a pre-convinced audience.

**What changes:**

- The "warm, hand-picked, no mass mailing" premise is **dropped**. The Damen porch is the landing
  target of an **official mass send** (the segmented Rundmail, #215).
- Success is **conversion volume**, not learning signal. A low count is now a **shortfall to fix**,
  not an expected and protected outcome.

**What stays — the content protections survive the role change verbatim.** These were built during
the probe (ADR-0054 and its amendments), and the role change does not weaken a single one — it
**strengthens** the case for them (see Consequences):

- **Never a lonely count for the fragile A-field — named presence, never a number** (#210,
  ADR-0054 amendment 2026-07-18): the Meisterin field surfaces a named face at ≥ 1 name, its count
  badge dropped; the social field keeps its "N schon dabei" badge as proof, not scarcity.
- **The two fields split by _motive_ (social vs competitive), never by skill; self-choice, never
  Orga assignment** (Track C). A strong player choosing the social field is normal, not slumming.
- **No "Challenger" / LK / seeding / title vocabulary in the social B-field** (the 02.07
  Sag/Vermeide table).
- **Absolute-beginner welcome** — the "Das brauchst du hier nicht" block (zählen, Aufschlag, lange
  Ballwechsel, Turniererfahrung, each struck through), the beginner FAQ, the quiet
  "Anfängerinnen willkommen" chip, and the guided chooser that signposts self-choice without
  abolishing it (#204, ADR-0054 amendment 2026-07-13).
- **Actively invites holding both fields** (the "Einzel, Doppel — oder beides?" FAQ), since a "both"
  entry converts the fragile A-field (ADR-0054 amendment 2026-07-12).

**What is untouched:**

- The **Herren** conversion-porch realization (ADR-0054) stands as written.
- The **porch mechanics** from ADR-0052 stand: `noindex`, no site nav, link-reachable, the
  `GET /api/phase` → `/` signup-era redirect, evergreen content on the front door and linked, never
  restated. The Rundmail is a new, broader way to _hand out the link_; it does not change what the
  porch _is_.

## Considered and rejected

- **A fifth ADR-0054 amendment.** Rejected on ADR-0054's own terms: its amendments are each
  "refines, does not reverse," and this reverses the page's job (warm → broad, signal → volume). An
  amendment would bury a reversal inside a document whose every prior change was a refinement, and a
  future reader scanning ADR-0054's amendment log would misread the porch as still a probe.
- **A successor that supersedes ADR-0054 wholesale.** Rejected: most of ADR-0054 still holds — the
  Herren realization, the ADR-0052 mechanics, and above all the content protections, which are not
  merely retained but load-bearing under the broader audience. Superseding the whole thing would
  throw away the discipline the broad send most needs. This ADR supersedes ADR-0054's **Damen job
  only**.
- **Drop the probe-era content protections now that volume is the goal.** Rejected — and this is the
  point most at risk of being "optimized away" by a future volume-chaser. The protections are not
  probe-era scaffolding; they are the honest-field frame that makes a broad, members-only send
  survivable (see Consequences).

## Consequences

- **The role change strengthens the content protections, it does not license dropping them.** A lonely
  "1 für die Meisterin," a skill-split, or "Challenger"/LK vocabulary in the B-field was a self-image
  risk in front of a hand-picked few; in front of the **whole Damen membership** the same misstep
  reaches every woman in the club at once. Broad reach raises the stakes of the fragile A-field's
  copy, so "named face, not count" and "motive, not skill" matter **more** here than they did for the
  probe.
- **Still members-only, still `noindex` (ADR-0017).** "Broad" means the whole Damen membership via an
  official internal channel — not public, not search-indexed, not non-member reach. The effort is
  vereinsintern-broad; the honesty frame operates inside that boundary.
- **The "validation probe (Damen)" glossary entry is retired for the live role** and CONTEXT.md's
  "Outreach porch" entry updated: the Damen porch is now a **broad conversion surface** that keeps the
  probe's content discipline. "Conversion porch" and "validation probe" survive as the historical
  ADR-0054 realizations; the Damen porch has moved from the second to a broad-audience form of the
  first.
- **The learning-channel is gone by design.** The probe's "one low-friction reply channel feeds
  iteration" rationale lapses with the format now settled and the goal now volume; nothing on the page
  changes, since that channel was always the personal conversation, never a page element.
