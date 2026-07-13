# ADR-0054: The Damen porch is a self-choice validation probe; the porch is not one symmetric object

- Status: accepted
- Date: 2026-07-11
- Supersedes: ADR-0053 for the Damen side; **abandons** ADR-0053's Herren widening (it never shipped)
- Builds on: ADR-0052 (per-side outreach porch), ADR-0051 (four fields, two per side), the discovery
  interviews (`vault/documents/interviews/`), the Matchday participant survey (n=21), the Damen
  commitment-round guide (`vault/documents/guides/Gesprächsleitfaden Damen-Format 2026-07-02`), and
  Discovery-Programm Track C
- Relates to: ADR-0042 (front door is the one phase-projected surface), ADR-0017 (noindex, link-only)

## Context

ADR-0053 treated the two porches as **one symmetric object** — „one template, two params", differing
only in an asymmetric live-momentum band — and set its hero to **orient a cold WhatsApp visitor** who
cannot tell what the event is. Checked against the club's own execution record, **both premises fail**:

- **The audience is warm, not cold.** The Durchführungsplan hands the link out personally: the Herren
  Hauptfeld to the **15 soft-committed** (mostly interviewed) players, the Challenger as a WhatsApp wave
  to a **named candidate list**, the Damen via a **commitment group round + Botschafterinnen**. The
  Matchday survey (n=21) confirms demand travels through personal network / WhatsApp, not club channels.
  Nobody meeting the porch needs the event explained; several carry the opposite problem — the **scar**
  of dead past Meisterschaften, or the **„nicht gut genug"** self-image.
- **The two sides are not the same object.** The Herren concept is **validated** — interviews first,
  then a page sent privately — and converted **12 Hauptfeld + 4 Challenger** in its **thin** ADR-0052
  form. The Damen concept — above all the social B-field's **format** — is **open**: format, name, and
  singles/doubles were still undecided at the 02.07 round (issue #61 open), and the competitive A-field's
  demand is **fragile** (hoped-for 4, ceiling 8, realistically thin — a strong Damen-50 player already
  prefers the social field over the title).

So the widening ADR-0053 built — a live-momentum band, long barrier-led explainers, the front door's
full visual identity — was **never validated** (the thin porch already did the Herren job) and, on the
Damen side, encoded the **wrong antidote**: „wir teilen die Felder ein", which Track C had already
reversed.

## Decision

Drop the „one symmetric widened porch" model. The outreach porch has **two realizations**, and the
difference is the **job**, not a momentum toggle:

1. **Herren = conversion porch.** Validated concept, warm pre-briefed audience → the page **converts**.
   Keep the **thin** live version (ADR-0052). The ADR-0053 Herren widening is **not shipped**.

2. **Damen = validation probe.** Open format, warm hand-picked audience, **no mass mailing** → the page
   is an instrument to **validate and iterate** a concrete format guess; success is **signal**, not raw
   signups. Concretely:
   - **The social B-field leads**, working name „Damen Doppel-Mixer" (a rotating-partner doubles mixer —
     come alone, partners rotate, leave with new Spielpartnerinnen; the name itself is provisional, part
     of what the probe tests). The fragile A-field (Meisterin, KO) is the honest, ambitious **second**
     option.
   - **The two fields split by _motive_, never by skill** — social vs competitive. A strong player
     choosing the social field is normal, not slumming; the copy never frames B as „for those not good
     enough" or A as „the serious field for the good ones".
   - **The „nicht gut genug" barrier is dissolved by self-choice into a desirable field, never by Orga
     assignment** (Track C; reverses ADR-0053). The whole persuasion weight therefore falls on making the
     B-field a genuine first choice.
   - **Never a lonely count for the fragile A-field** — a bare „1 für die Meisterin" would be the maximal
     self-image reinforcer; the Damen momentum treatment is invitation-only, never scarcity.
   - **The copy follows the 02.07 Sag/Vermeide table**, not ADR-0053's prose: never „Challenger", never
     an LK number or seeding, never title/competition vocabulary in the B-field.
   - **One low-friction reply channel** („passt das für dich? schreib mir") turns reactions into
     iteration signal; the page stays cheap to edit between small send-waves. That channel is the
     **personal conversation around the shared link** (the same warm thread that hands the porch out —
     commitment round, Botschafterinnen, WhatsApp), **not an element on the page**: the porch carries one
     concrete action (the `womens-social` / `womens` signup) and nothing that would duplicate a channel
     the sender already owns.

Only once the Damen format and Ansprache are validated does the phase-projected front door adopt them.

## What still holds from ADR-0052

Link-only, `noindex`, no site nav; the per-URL OG preview is why a porch is a route not an anchor;
signup-era with the `GET /api/phase` → `/` redirect; evergreen content stays on the front door and is
linked, never restated. Unchanged.

## Considered and rejected

- **Ship the ADR-0053 widening symmetrically.** Rejected: unvalidated on both sides; the thin Herren
  porch already converted 12+4, and the Damen widening carried the wrong (assignment) antidote.
- **Orga assigns the Damen fields** („nimmt die Überforderung weg"). Rejected: Track C found that removing
  the choice does not solve the self-image barrier and can feel like being sorted into the lesser field;
  self-choice into an attractive B-field does.
- **Split the Damen fields by skill** (strong → A, rest → B). Rejected: contradicted in the room — a
  strong player wants B; the split is **motive**, and a skill framing feeds the very barrier.
- **Let the page put the format to a vote.** Rejected: it reads as unfinished and feeds „not made for me
  yet"; the format is built with the group in the room — the page presents a confident guess and listens
  via the reply channel.

## Consequences

- ADR-0053 is superseded for the Damen side and abandoned for the Herren side; its uncommitted stack is
  disposed of (Herren widening reverted, Damen explainer + momentum-copy rebuilt).
- **„Conversion porch"** and **„validation probe"** enter the glossary as the two realizations of an
  outreach porch.
- The Damen probe deliberately optimizes for **learning over conversion volume**; a low count is expected
  and must never be surfaced as failure.

## Amendment (2026-07-12): the probe is a rich, _disposable_ page with gated presence

In build we found the _thin_ probe still too thin — it did not make clear _what the event is_. The
resolution refines (not reverses) the decision above:

- **The probe is a rich, standalone page, deliberately disposable.** It adapts several evergreen sections
  from the front door (Das Event, Der Ablauf, Drumherum, a Damen-relevant FAQ), Damen-framed. This looks
  like the „full standalone page per side" ADR-0052 rejected — but that rejection is calibrated for a
  **permanent** second surface (two copies drifting forever). This page exists only for a few send-waves;
  once the Damen format and Ansprache are validated, the learnings move into the **real** front door and
  _then_ get communicated broadly (ADR-0042). So the content-drift cost does not apply, and a temporary
  second copy is acceptable. It stays link-only, `noindex`, signup-era with the phase redirect.
- **Presence is shown — but Damen-safe, and gated.** The front door's `ParticipantList` is **not** reused:
  it renders the championship field as a **seeding board** with an LK column, „vorläufige Setzung nach
  Leistungsklasse" and a „Plätze frei" meter — all forbidden by the probe's copy discipline, and it would
  **lonely-count the fragile Meisterin field**. Instead a bespoke section shows plain names as chips,
  appears **only once a floor of total signups is reached** („show the list once a few are in" — below it
  there is no section at all, so nothing reads as empty), leads with the social field, and surfaces the
  competitive Hauptfeld group **only once it too clears the floor** — never a lonely count. This is the
  concrete form of „the Damen momentum treatment is invitation-only, never scarcity" above.
- **The reply channel stays the personal conversation** around the shared link, not an element on the page.

## Amendment (2026-07-12): the probe invites _both_ fields, not one

The probe frames its two fields as a self-choice (above), and the copy reads as an either/or. The
registration guard, however, is **per person + competition** (`personWhere`, `worker/store/registrations.ts`),
so a member may hold the championship **and** the mixer at once — and the first live send-wave produced
exactly that: a woman signed up for both. We make that explicit rather than accidental:

- **The porch invites „both".** The FAQ becomes „Einzel, Doppel — oder beides?" and answers that the two
  fields go together (one added sentence, **FAQ-only**, nothing else on the page touched). The rationale is
  the probe's own economics: the competitive Meisterin A-field is the **fragile** one (hoped-for 4), and a
  woman who comes for the social field and _also_ takes the championship is exactly the A-field entry the
  field needs to come together. „Both" is a **conversion lever for the fragile field**.
- **It stays a postscript, never the headline.** The hero, the „Deine Felder" section and the closing
  section keep the „self-choice by motive" story; only the FAQ carries „both". This protects the core
  narrative _and_ the probe signal (see the caveat).
- **Caveat — signal dilution.** The probe measures **signal**, and a „both" signup inflates the A-field
  count without evidencing a pure competitive motive. Accepted knowingly: at small N the count is read by
  eye (the operator sees who holds both in the admin), and the conversion value for the fragile field
  outweighs a slightly noisier count. No instrumentation is built.
- **Operator consequence — the Sunday clash the validator cannot see.** The mixer runs Sunday midday,
  **offline**, invisible to the schedule validator; the A-field also plays Sunday. A „both" player can
  therefore be scheduled for a championship match _during_ the mixer block with **no validator warning**.
  We build nothing (ADR-0021, small N): the desk hand-places a „both" player's championship match
  **outside the Sunday mixer block**, and the mixer's rotating, informal format absorbs the rest. Recorded
  as operator knowledge, not a system guard.
- **What did not change.** No registration-guard change. The guard's real scope — per person+competition,
  which also admits `mens` + `mens-challenger` — and the fact that the cross-field „no two matches at once"
  guarantee rests on the schedule validator, not this guard, are corrected in **CONTEXT.md's Registration
  entry** (the invariant's home) and filed as a separate guard-scope issue; left as-is under small-N.

## Amendment (2026-07-13): remove the bar explicitly for absolute beginners; signpost the choice

First live send-wave feedback (WhatsApp, via a Botschafter): a beginner Damen player and several of her
teammates _want in_ but stall at the very „nicht gut genug" barrier this probe was built to dissolve —
and two things the page didn't do surfaced:

- **The barrier is concrete, and the abstraction missed it.** The fears are specific — „weiß nicht, wie
  man zählt", „Probleme mit dem Aufschlag", can't sustain a rally — and „egal wie du spielst" / „auf
  jedem Niveau" never reached them; one „war nicht bewusst, dass das Doppel-Mixer-Format auch für
  Anfängerinnen geeignet ist" (the message didn't land).
- **Self-choice itself confused the beginner.** The probe rests its whole persuasion weight on „wähl
  selbst dein Feld" (above), but the exact player it wants „wusste nicht ganz genau, was damit gemeint
  ist".

This **refines, does not reverse** the decision above. The two moves:

- **Name the fears and _remove the bar_ — which is not the forbidden reassurance.** The rule „never
  reassure `du bist gut genug`" forbids conceding a bar and arguing you clear it (a skill frame). It does
  **not** forbid stating that _there is no bar_: the social field has no scoring, serve, or rally
  standard to meet. The social explainer gains a „**Das brauchst du hier nicht**" block (zählen,
  Aufschlag, lange Ballwechsel, Turniererfahrung — each named and struck through) and a beginner FAQ; a
  quiet „Anfängerinnen willkommen" chip replaces the loud hero badge a rejected variant tried (that badge
  risked reframing the Mixer as „the beginners' field" — the skill split this ADR forbids).
- **Signpost the self-choice, don't abolish it.** A guided chooser leads the „neu / unsicher / gesellig"
  player to the Mixer before the two explainers. It routes _into_ the desirable field and never frames the
  championship as „the good players' field" (its option is motive — „will mich messen"), so it stays
  self-choice with a signpost, not the Orga assignment this ADR rejected.
- **Validated by prototype** (`/damen-proto`, three strategies A/B/C, since deleted): the „remove the bar"
  explainer + „signpost the choice" chooser won; the „name beginners loudly in the hero" variant was
  rejected for drifting toward the skill frame.
- **Scope.** Probe-only, per the amendments above; folds into the front door only once validated (ADR-0042).
