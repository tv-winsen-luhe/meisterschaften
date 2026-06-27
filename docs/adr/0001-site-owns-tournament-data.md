# ADR-0001: The site owns the tournament data end to end

- Status: accepted
- Date: 2026-06-25

## Context

The Meisterschaften site already owns registration data (D1 `registrations`) and has a token-gated
admin. The event continues past registration into a draw, a live weekend, and a
post-event phase. We had to decide whether the bracket and live results live **in this system** or in
an **external tournament tool** (nuLiga, Turnier.de, mybigpoint, a spreadsheet) that the site mirrors.

## Decision

The site is the single source of truth. The draw and live results are stored in D1 alongside
registrations, edited through the existing admin, and rendered by the public site. No external
tournament tool is in the loop.

## Consequences

- We build a small bracket/results data model and extend the admin for match entry — kept
  deliberately thin (an extension of the existing admin, **not** a courtside referee app).
- We fully control presentation across all four phases; no data is copied between systems.
- nuLiga remains a read-only input for LK/seeding only — never a store of results.
- If the event ever outgrows a single operator entering results, revisit this (the constraint that
  justified "thin" was a ~50-player, 6-court, single-operator event).
