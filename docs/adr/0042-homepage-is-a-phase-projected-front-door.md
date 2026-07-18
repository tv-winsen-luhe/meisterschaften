# ADR-0042: The homepage is a phase-projected front door, swapped client-side

- Status: accepted (§4 revised 2026-07-19 — see Revisions)
- Date: 2026-06-29
- Extends: ADR-0006/ADR-0027 (the phase model), ADR-0008 (static Astro + client-side polling)

## Context

Every public surface keys off the phase (ADR-0006): the participant list, the draw, `/spielplan`,
the coming live board. The homepage (`index.astro`) was the lone exception — a fixed `signup`-era
landing page (hero + „Jetzt anmelden", competition cards with signup buttons, draw _preview_,
weekend schedule, final signup CTA). Its embedded live sections (`ParticipantList`,
`TournamentDraw`) already self-update, but the page _shell_ is hard-wired for `signup`.

We asked whether the site is "a state machine" and whether the homepage should change per phase.
Two state dimensions already exist and ADR-0027 deliberately keeps them apart: the global **phase**
(`signup → tournament → post-event`, three operator-set values) and the per-**competition
lifecycle** (`not drawn → drawn → running → done`, derived). The question is how — and how much —
the homepage joins the phase-keyed surfaces, without breaking ADR-0008's static, zero-JS-by-default,
no-SSR-of-dynamic-pages, no-rebuild-to-publish posture.

## Decision

The homepage becomes a **phase-projected front door**, resolved **client-side**.

1. **Front door, not a second live surface.** Across phases the homepage _re-points_; it does not
   carry the heavy live/results content. `/spielplan` (and the coming live board, issue #91) and a
   future results/champions surface own that. The homepage may later lead with a _summary_ strip
   (a „jetzt auf dem Platz" teaser) that self-fetches client-side and links out — it never
   duplicates the board. (That teaser reads the Live board's current-truth data, which
   `schedule_published` never gates — ADR-0041; only the planned schedule is gated.)

2. **Keys off the phase alone — a pure 3-state projection.** The homepage reads the global phase and
   nothing else. The derived middle inside `tournament` (draw-pending → reveal → bracket → live)
   stays on the surfaces that already carry it (`ParticipantList`, `TournamentDraw`, `/spielplan`,
   the bracket pages). The homepage does not recompute per-competition state.

3. **The phase → presentation decision is made client-side**, joining the existing
   `participant-list` / `tournament-draw` pattern — staying inside ADR-0008 rather than introducing
   SSR or a rebuild step:
   - The **`signup` lead is rendered statically** as the default. This is the months-long common
     case, so it is exactly today's page — no fetch, no swap, no flash.
   - The small **`tournament` / `post-event` leads ship as hidden blocks**; an inline `<script>`
     reads `GET /api/phase` **once on load** (no poll timer — the phase changes ~twice in the
     event's life) and swaps the lead **only when `phase ≠ signup`**.
   - The read is of the **current** phase value, so a backward transition (ADR-0006's escape hatch)
     is handled for free. The homepage must never cache "highest phase reached".

4. **Three content categories, each with its own relation to the phase:**
   - **Signup affordances** — the header CTA, the three competition-card „Anmelden" buttons, the
     final CTA section, and the hero lead. These are _actively wrong_ once signup closes, so they
     are the **swap set**: an auditable, fixed list of elements toggled by the one phase read.
   - **Evergreen explainer** — Event, Modus, Drumherum, the FAQ core. **Static**, with copy
     **reworded phase-neutral** (no „wird ausgelost", no „ab 19.08.") so it reads true in every
     phase without swapping.
   - **Self-adapting live sections** — `#participants`, `#draw`. **Unchanged**; they are already
     phase-derived client-side and are precisely the surfaces that carry the derived middle.
     _(§4 revised 2026-07-19: `#draw` is no longer in this category — it is now hidden during signup;
     see Revisions. `#participants` stays self-adapting.)_

## Considered and rejected

- **SSR the homepage only** (Astro hybrid, `prerender = false` for `index`) so the Worker renders
  the right lead. Technically possible without a framework switch, but it punches an SSR hole in
  ADR-0008's static/zero-JS stance for the single most important page and would require an ADR-0008
  amendment. Rejected.
- **Rebuild-to-publish** (flip phase → CI redeploy). Explicitly excluded by ADR-0008; the phase is
  D1 runtime state, not a build input. Rejected.
- **Three full compositions per phase** and **one fixed page that only toggles sections**. The
  former builds `tournament`/`post-event` surfaces that do not yet exist (premature; the live board
  is #91, no results page exists) and duplicates the shared tail; the latter cannot promote the
  live lead to the top without reordering (which is composition). Rejected in favour of the
  front-door synthesis above.

## Consequences

- A no-JS visitor **during the event window** sees the `signup` lead (a misleading „anmelden").
  This is bounded (a weekend, a small audience), consistent with the site already requiring JS for
  all live content, and harmless to action: the signup endpoint is server-side phase-gated, so only
  the optics mislead, nothing breaks.
- The client-side swap stays small and auditable — one phase read toggling a known element list, not
  per-line phase logic scattered through the page.
- Tail copy must be scrubbed of signup-tense wording to be phase-true while static.
- ADR-0008 stands unamended; no new SSR or build path is introduced.
- The completed model: **three states, lenient (any-to-any) operator transitions with externally
  anchored guards (the seeding freeze rides the immutable draw snapshots, the cron self-gates), and
  a homepage that is a pure read of the current value.**

## Revisions

### 2026-07-19 — `#draw` is hidden during signup, not self-adapting

§4 originally placed `#draw` among the **self-adapting live sections** kept visible in every phase.
In practice, during signup that section is not a live surface at all: nothing is drawn yet, so it
shows only a **provisional preview** (seed heads + „?" lines, or the „Auslosung ab vier"-Countdown
below the draw floor). We decided that preview does not earn its place on the front door during
signup — the provisional seeding it hints at is already shown, in full, on the `#participants`
seeding board („Das Feld"), so `#draw` during signup is redundant anticipation rather than
information.

**Revision:** `#draw` moves from the _self-adapting_ category into the same **hidden-until-revealed**
mechanism §3 already defines for stale signup affordances — but mirrored in time. Where a signup
affordance ships visible and is hidden once phase ≠ signup, `#draw` (and its header nav link) now
**ships hidden and is revealed once phase ≠ signup**. The reveal is the same single client-side phase
read (`GET /api/phase`, once on load); any failure keeps the signup default (hidden). Implemented as
a `[data-phase-gate]` attribute the phase read removes. `#participants` is unaffected — it stays a
genuine self-adapting live section (its list and seeding board are meaningful in every phase).

One copy consequence follows the §4 evergreen principle: the `#draw` section header, now shown only
from `tournament` onward, was reworded phase-neutral (dropping the signup-tense „…werden bei der
Auslosung nach Meldeschluss gelost").
