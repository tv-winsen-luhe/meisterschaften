# ADR-0057: The Herren porch is retired; the broad Herren send lands on the front door

- Status: accepted
- Date: 2026-07-19
- Supersedes: **ADR-0056 in full** — the Herren porch's realization it defined (thin → rich, broad
  conversion surface) is reversed one day after acceptance: there is no Herren porch at all. ADR-0056's
  field-framing analysis (#239) survives as the _content_ rule for the Herren fields, but its **surface**
  (a dedicated `/herren` porch) is dropped. ADR-0055 (Damen) is untouched.
- Builds on: ADR-0055 (the Damen porch stays a broad conversion surface — the asymmetry this ADR rests
  on), ADR-0052 (per-side outreach porch — now a Damen-only mechanism), ADR-0042 (the front door is the
  one phase-projected surface), ADR-0051 (four fields, two per side, offered as equals not mirrored),
  ADR-0048 (strength redaction — no LK/seed on the protected Challenger), ADR-0028 (English identifiers,
  German user-facing copy)
- Relates to: the official-announcement effort (wayfinder map #213), its surface decision (#215, the
  segmented Rundmail), #216 (the whole-club belonging hook), #220 (the front-door cold-walk-up Challenger
  flip — reconciled here, not rejected), #239 (the Herren field-framing this ADR keeps as content)

## Context

ADR-0056 moved the Herren porch thin → rich so a broad, segmented Herren send would land on a page rich
enough to orient a member meeting the event for the first time. It was accepted 2026-07-19 and shipped
(#241/#243/#244). One day of use of it in context surfaced that the surface itself — a dedicated
`/herren` porch — is redundant with the front door for this send. Three facts, none of which ADR-0056
weighed:

1. **The channel is pure email.** The segmented Vereins-Rundmail (#215) is an email, not a WhatsApp/link
   share. The porch's _stated raison d'être_ — „the route earns its keep at the preview layer: a per-URL
   `ogTitle`/`ogDescription` makes the WhatsApp preview card itself the pitch, the one thing a query
   param on the front door cannot do" (CONTEXT.md, Outreach porch; ADR-0052) — **does not apply to
   email**: email clients do not render OG preview cards. The one capability that justified a _route_
   over a front-door anchor is inert for this send.

2. **The front door already carries the Herren porch's only added value.** The rich Herren porch's job
   was to _explain the two competitive fields_. The front door's signup-phase `#competitions` section
   already presents **all four fields** with format chips and the objection-flip blocks
   (`index.astro`: the `mens-challenger` `FieldFlip`, the four `CompetitionCard`s), and the FAQ already
   explains Hauptfeld vs. Challenger in depth („Was ist das Challenger-Feld?", „Darf ich mit hoher LK im
   Herren-Hauptfeld?"). The explaining is done; the porch restated it on a second surface.

3. **The porch is a gender silo, and that undercuts the #216 hook.** The Herren hero leads with
   whole-club belonging („der ganze TV Winsen spielt, volle Anlage") and then shows only the Herren
   half. The front door shows **both sides** — it _delivers_ the whole-club promise the porch only
   asserts, and answers the „und was ist mit den Damen?" incongruity a men-only page invites.

**The asymmetry with Damen is the deciding reason, and it is not a symmetry violation.** The Damen porch
does work the front door **structurally cannot**: dissolve the „nicht gut genug" self-image barrier,
split the two fields by _motive_ not skill, show the fragile A-field as named presence not a lonely
count, and welcome absolute beginners — all of which depend on knowing the reader is a Damen and would
break the front door's cold, gender-unknown walk-up. The Herren porch does **no** such irreplaceable
work: both fields are competitive, there is no self-image barrier (ADR-0056/#239), and a reader
self-selects by strength in seconds. Asymmetric _need_ earns an asymmetric _surface_ — a bespoke Damen
porch, the front door for Herren — which is exactly ADR-0051's „offered as equals, not mirrored," now
applied at the surface layer.

## Decision

**There is no Herren porch.** The segmented Rundmail's Herren link targets the **front door (`/`)**; the
Damen link still targets **`/damen`**. The Damen porch (ADR-0055) is unchanged.

**The Herren field-framing (ADR-0056/#239) moves onto the front door as content.** Because the front door
now also lands the broad, segmented Herren send, the front door's Herren-Challenger copy is sharpened so
it serves **both** audiences it now carries — the cold, gender-unknown walk-up **and** the broad Herren
member. The rule (option B of the wayfinding session):

- **Frame the Challenger by mechanism + promise, never by a deficit identity.** „geschützt (ab LK 20),
  Wettkampf auf Augenhöhe, ein eigener Titel" — not „Freizeit- & Einsteiger-Feld" / „die, die nicht gut
  genug sind." This is the ADR-0056 fairness-not-shame flip, now on the front door.
- **Keep a factual low-barrier welcome for the cold walk-up (#220), but strip the competence-reassurance
  phrasing ADR-0056 rejected.** A genuine walk-in beginner is still welcomed — via _eligibility_ facts
  („keine LK nötig, offen für alle bis LK 20") — but the specifically-rejected register („vielleicht
  dein erstes Turnier? … keine Turniererfahrung nötig") is dropped, because on a surface a competitive
  capped Herren player now reads, it devalues the field (ADR-0056, the concept-owner warning). This is
  the reconciliation of #220 (cold-walk-up welcome) with ADR-0056's copy discipline on one shared
  surface — **not** a rejection of either.

The concrete copy (`tournament.ts` Challenger `tagline`/`audience`, `field-explainers.ts`
`mens-challenger.flip`, and the `index.astro` note + FAQ) is the option-B draft settled in the session.

## What still holds

- **The Damen porch (ADR-0055) is untouched** — same job, same content protections, same `/damen` route.
- **ADR-0052 porch mechanics still hold — for the Damen porch:** `noindex`, no site nav, link-reachable
  only, the `GET /api/phase` → `/` signup-era redirect, evergreen content on the front door and linked,
  never restated. „The two outreach porches" becomes „the Damen porch"; the mechanics are unchanged for
  the one that remains.
- **Strength redaction (ADR-0048) holds:** no LK value, no seed number on the public Challenger. The
  front-door copy carries only the **cap** (`Ab LK 20 · geschützt`), which is the eligibility mechanism,
  never a player's advertised rating.
- **The front door stays the one phase-projected surface (ADR-0042):** after Anmeldeschluss it projects
  tournament/post-event exactly as before — a Herren member landing there needs no signup-era redirect
  because they are already on the front door.

## Considered and rejected

- **Keep the rich Herren porch (the ADR-0056 status quo).** Rejected: the email channel voids the
  OG-preview rationale that made a route worth more than a front-door anchor; the front door already
  carries the field explanation; and the porch's gender silo undercuts the #216 whole-club hook. A
  second surface with no capability the front door lacks is pure redundancy to maintain.
- **A thinner Herren porch (revert ADR-0056's thin → rich instead of dropping the page).** Rejected: for
  an email send, _any_ Herren porch is redundant with the front door — thin or rich, it restates what the
  `#competitions` section and FAQ already say, without the OG capability that once justified the route.
- **Option A: strip the beginner register from the Challenger copy entirely.** Rejected: the front door
  is still the cold, gender-unknown walk-up, and a strict fairness-only frame reopens the #220 gap for a
  nervous walk-in beginner. Option B keeps a factual welcome while dropping only the field-devaluing
  phrasing — serving both audiences the single surface now carries.
- **Amend ADR-0056 rather than supersede it.** Rejected on the project's refine-vs-reverse line
  (ADR-0055): dropping the porch **reverses** ADR-0056's core decision (a rich Herren porch exists), so
  it earns a successor, not an amendment — the same discipline ADR-0056 itself applied to ADR-0054.

## Consequences

- **ADR-0056 is fully historical**, its realization reversed one day after acceptance — recorded
  honestly here rather than quietly reverted. Its #239 field-framing survives as the _content_ rule now
  hosted on the front door; only its _surface_ (a `/herren` porch) is gone.
- **CONTEXT.md's „Outreach porch" entry is updated:** the Herren realization is retired; the porch is now
  a **Damen-only** mechanism, and the broad Herren send lands on the front door. (Docs-only, as with the
  ADR-0055/0056 recordings.)
- **Code changes:** `sides.ts` and the porch route drop the `herren` side (so only `/damen` is emitted);
  `porch-herren.astro`, `porch-herren-presence.astro`, and `explainer-herren.astro` are deleted;
  `reglement.ts`'s comment loses its porch-herren consumer (the front-door Modus section is now the sole
  reader); and the front-door Challenger copy is sharpened to the option-B register
  (`field-explainers.ts`, `tournament.ts`, `index.astro`).
- **The Damen/Herren surface asymmetry (bespoke porch vs. front door) is intended and now visible.** It
  mirrors the asymmetric need — a self-image barrier to dissolve on one side, none on the other — and is
  consistent with ADR-0051's „offered as equals, not mirrored."
- **Operator action (outside the repo):** the segmented Rundmail's **Herren link must point to `/`**, the
  Damen link stays `/damen`. This is the single change to the send itself.
