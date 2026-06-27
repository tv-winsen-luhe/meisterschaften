# ADR-0023: Admin shell visual redesign — measured columns, card overview, flat nav, richer detail

- Status: accepted
- Date: 2026-06-27

## Context

The admin shell (ADR-0019) shipped functional but visually sprawled: content ran full-bleed on wide
screens, the overview's table and „neu — zu bestätigen" call-to-action left large empty regions, and the
registration detail panel was vertically cramped with a thin form floating above a pinned action bar. A
grilling session walked each complaint to a fix. Everything here stays inside ADR-0016's neutral, no-theming
look — these are layout and structure decisions, not branding. It refines, and in places supersedes, the
visual choices of ADR-0019; the two-axis navigation (sidebar = "where am I", phase stepper = "where is the
event") and the semantic status-colour carve-out both stand.

## Decision

1. **Admin content is measured and centered, not full-bleed.** Each surface caps its content to an
   intentional, centered column (overview `max-w-4xl`, registration detail `max-w-3xl`) rather than
   stretching to the viewport. With deliberately small N (ADR-0021) there is little data to show; a measured
   column makes the empty space read as calm rather than unfinished, and the alternative — manufacturing
   charts and tiles to fill pixels — was rejected as complexity the data does not justify. This is the
   standing convention for future operator surfaces.

2. **The overview is a card dashboard, not a table + CTA.** Supersedes ADR-0019 point 1's overview shape.
   The „neu — zu bestätigen" call-to-action block is removed; a thin summary line (aktiv · neu · bestätigt)
   sits above one card per competition (status counts, projected draw, club split, fill bar). The
   call-to-action's one job — one click into the Neu queue — is preserved in two smaller forms: the „Neu N"
   figure in the summary line is clickable (→ registrations filtered to Neu), and the sidebar carries a „neu"
   count badge for ambient awareness. Cards over a table because the set is three rows (ADR-0021): a glance,
   not a grid.

3. **Sidebar navigation is one flat list in event-flow order.** The „Verwaltung" / „Turnier" group split is
   dropped — it was a false axis (the registrations surface is as much "tournament" as "administration"). The real axis is
   the event's flow: overview (home), then registrations → draw → schedule → results in order, with
   later phases disabled. The disabled state already says "later"; no group label is needed. The logout
   stays in the footer, set off by a separator.

4. **The registration detail panel is richer and uses its space.** Contact facts become actions —
   E-Mail (mailto), Anrufen (tel), and WhatsApp (wa.me, with German-number normalisation; omitted when no
   phone is stored) render as labelled icon buttons. The club picker becomes a segmented two-option toggle
   showing each club's logo (dropdown is overkill for two clubs). The derived LK (ADR-0020) shows as a badge
   with its provenance (nuLiga / Standard) rather than a fake read-only input — it is not editable, so it
   should not look like a field. "Zuletzt aktualisiert vor X" is a clear meta line. The "stark fürs
   Challenger-Feld" warning becomes a proper shadcn `Alert`.

5. **The overview gains an overall-load gauge — projected match load vs. the weekend court
   budget.** A strip shows the matches the event will run, summed over the active players per field
   (`shared/draw.ts`): main bracket `N−1` + third-place match (main bracket only, from four entrants up) +
   consolation bracket (R1-loser consolation). It measures against a court budget of 72 (6 courts × ~6
   matches/court/day × 2 days, at the 90-min default; `courtSchedule` in `tournament.ts`). The match
   math lives in `shared/` so the future draw/schedule reuse it. It is a planning figure: the
   main bracket count and the 3rd-place playoff are exact, while the consolation bracket is exact for full
   power-of-two fields (full headline ≈ 57) and a slight under-estimate with byes (the bye-then-R2
   losers are bracket-dependent). The gauge goes red only if the projection exceeds the budget.

   The planned **Damen-Freizeit** field shares the event weekend's courts but is a different format
   (recreational, likely round-robin, shorter matches — undecided until 02.07), so it is **not** folded
   into the KO match math. It is carried as a provisional reserved-slot block (`freizeitReservedSlots`)
   shown as a second, striped segment in the same gauge — the championship load and the Freizeit
   reservation read against the one 72-slot budget. The reservation is a placeholder to be set once the
   format is known; the field stays `status: 'planned'` and out of `COMPETITION_SLUGS` until then.

   The overview also carries a **„Letzte Anmeldungen"** list, derived without an audit log or new
   columns: the most recent signups by `createdAt`, each with its current status dot. It deliberately
   uses **only `createdAt`** — the one cron-safe timestamp — because `updatedAt` is bumped by the LK
   sync (`seeding-lk.syncAll`, any linked row, any status) and so cannot date a confirm or a cancel.
   Cancellations still surface (a recent signup carrying a red dot); they are not given a separate
   timestamped "abgemeldet" event precisely because that time would be unreliable.

6. **The sidebar logo is the full club emblem at 32px — a deliberate operator override.** Recorded because
   it is surprising: the `signet.svg` monogram is the legible mark at that size, while the full
   `tv-winsen.svg` emblem's rim text ("TENNISVEREIN … WINSEN L.") turns to mush at 32px. The operator chose
   the full emblem anyway, accepting the rim text as decorative. ADR-0016 holds that admin branding has low
   value, so no effort goes into making it legible (e.g. a larger header). Noted so a future reader does not
   "fix" the illegible logo back to the signet thinking it a mistake.

## Consequences

- New shadcn components enter the admin (owned source, per ADR-0016): `alert`, `toggle-group`. Sorting in
  the registrations queue (registration date / LK / name, default oldest-first, empty LK last) reuses the existing
  `native-select`; the „neu" badge reuses the sidebar module's `SidebarMenuBadge`.
- ADR-0019 stands except its overview shape (point 1), superseded by point 2 here. ADR-0016 (neutral,
  light-only, no theming) and ADR-0020 (LK derived, never edited) both stand and are respected.
- The WhatsApp action is best-effort: `wa.me` only works for mobile numbers, so it opens an empty chat for a
  landline. It is shown whenever a phone is stored rather than guessing mobile-vs-landline.
- Numbers render in the app's standard font, not a monospace/`font-mono` face — counts, LK, the gauge and
  card figures read like the rest of the UI. `tabular-nums` is kept where digits must align (tables, the
  live gauge). The lone exception is the Spieler-ID input, where mono aids verifying an 8-digit id. Noted
  because shadcn examples often default numbers to mono/tabular — don't reintroduce it wholesale.
