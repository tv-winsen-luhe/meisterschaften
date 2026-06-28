# ADR-0019: The admin becomes a navigable shell; the phase is its global header

- Status: accepted (overview shape in point 1 superseded by ADR-0023)
- Date: 2026-06-26

## Context

The admin is one React island (ADR-0008) styled with shadcn/ui (ADR-0016), and it is set to grow well
beyond registrations: the scheduling grid, results entry, and the post-event purge all land here, and the
draw reveal show is carved out as its own surface. Today the admin is a single registration screen — one
long, scrollable list of editable cards with a header, stat tiles, phase buttons, and a filter bar stacked
on top.

That single-screen shape does not host a second surface. Built as-is, each future surface would invent its
own chrome and re-litigate where navigation, the phase control, and at-a-glance numbers go. The redesign is
the moment to decide the frame once.

The work was scoped through a grilling session; the design decisions below are its outcome.

## Decision

1. **A shell with surface navigation, now — a deliberate YAGNI deviation.** A shadcn `sidebar`
   (icon-collapsible) owns the navigation between surfaces. V1 ships two real surfaces — **overview** (an
   at-a-glance dashboard: the „neu — zu bestätigen" call-to-action, fill per competition, total counts) and
   **registrations** (the registration workbench) — with **draw / schedule / results** as disabled
   placeholders. Building the frame before the second surface exists is the same kind of considered
   exception to "prefer the simple solution" that ADR-0016 itself is: it stops the chrome being rebuilt
   when the scheduling grid arrives.

2. **The phase is a global header, not a gate.** The operator-controlled phase (ADR-0006) renders as a
   stepper above every surface — it both _shows_ the phase and _sets_ it. Setting it goes through a
   confirmation dialog (`alert-dialog`) on every change, because advancing freezes the seeding and ends the
   nuLiga sync (ADR-0010) — a misclick has event-wide consequences. The phase does **not** gate the
   sidebar: every surface stays reachable in every phase, and a surface whose phase has not yet produced
   data shows an `empty` state (e.g. draw during signup). Two independent axes: _where am I_
   (sidebar) versus _where is the event_ (stepper).

3. **Triage is a surface choice, not a shell mandate.** The registrations surface uses a two-pane layout — a filtered
   queue on the left, the selected registration's edit panel on the right, with auto-advance after a
   confirm so the operator can work the „Neu" queue without re-clicking. It uses `native-select` (keeps the
   platform picker on a phone) and a `switch` for the „keine ID" mode. On a narrow screen the panes
   collapse to one and the edit panel becomes a `drawer`. The shell only provides sidebar + global header +
   content region; the schedule and draw surfaces will take the full width. A shared triage shell may be extracted
   when results entry (which fits the same pattern) is built — not before.

4. **Semantic status colour is a bounded exception to ADR-0016's neutral rule.** ADR-0016 point 2 chose
   shadcn's neutral look with no theming. The redesign adds one colour axis: status (amber = neu, green =
   bestätigt, red = abgemeldet), shown as a dot in the queue and a badge in the panel. This is information
   encoded as form, not brand theming, and it is the _only_ colour — the neutral base, the light-only
   policy, and the no-event-branding stance all stand. Recorded here because it sharpens, rather than
   simply restates, ADR-0016.

   _Amendment (#120):_ the carve-out widens from one axis to two. The schedule grid gives each competition
   a distinct accent on its match cards (`competitionAccent`), so the operator can tell a card's field at a
   glance when several competitions are drawn. Like status colour, it is information encoded as form, not
   brand theming, and it never stands alone — it rides _alongside_ the „M{n} · {competition}" label, so a
   colour-blind or low-vision operator still reads the field from the text. The neutral base, light-only,
   and no-event-branding stances are unchanged; the rule is now "colour carries information (status, field),
   never decoration."

## Consequences

- Future operator surfaces inherit a home and a consistent frame instead of each defining its own chrome.
- More shadcn components enter the admin (owned source, per ADR-0016): `sidebar`, `resizable`, `tabs`,
  `scroll-area`, `native-select`, `switch`, `sonner`, `separator`, `tooltip`, `drawer`, `field`, `empty`.
  All are pure JS — `allowBuilds` is unaffected.
- `admin-app.tsx` + `registration-card.tsx` split into shell (sidebar + phase header), the overview
  surface, and the registrations surface (queue + detail panel). No API or data-model change comes from _this_
  ADR; the status-model change rides in ADR-0018.
- ADR-0016 stands and is sharpened: neutral + light-only + no brand theming hold, with a single documented
  carve-out for semantic status colour.
- The overview is intentionally thin in V1 (counts and fill, no charts). It gains substance — and possibly
  shadcn charts — once the draw and live data give it more than one source to summarise.
