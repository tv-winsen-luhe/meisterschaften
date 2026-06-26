# ADR-0021: Small N is a fixed design constraint — build for clarity, never for scale

- Status: accepted
- Date: 2026-06-26

## Context

The event is vereinsintern and capped: at most ~36 registrations in total across three fields
(capacities 8 / 16 / 16), draw sizes of at most 32, and on the order of ~35 matches. This is a hard
upper bound for the event, not a starting point that grows. None of it is visible in the code — a reader
sees "a list of registrations" or "a grid of matches" and cannot tell that the count is bounded and tiny.

## Decision

Treat the small participant count as a **design constraint** that steers the admin (and the coming
Auslosung / Spielplan / Ergebnisse surfaces) toward clarity-at-a-glance and away from anything built for
volume.

- **Encouraged**: render the full set at once (no paging), in-memory sort/filter, the whole Spielplan on
  one grid, the Übersicht as a 3-row table.
- **Avoided**: pagination, "load more" / infinite scroll, list virtualisation (`react-window` & co.),
  server-side search/filter endpoints, and density tricks that only pay off at hundreds of rows.

## Consequences

- Stops the reflexive "add pagination/virtualisation for scale" that the invisible bound would otherwise
  invite — that complexity is pure cost here, and showing everything at once is the better UX.
- If the event ever outgrows this (e.g. opens to non-members), this ADR is the thing to revisit before
  reaching for scale machinery — the bound is a deliberate assumption, recorded, not an accident.
