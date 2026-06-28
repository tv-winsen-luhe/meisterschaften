# ADR-0031: The draw reveal show is operator-paced in the gated admin, forward-only, and not replayable

- Status: accepted
- Date: 2026-06-28
- Refines: ADR-0003 (precompute-then-reveal), ADR-0027 (per-competition lifecycle)

## Context

ADR-0003 establishes that the draw is precomputed atomically and then revealed lot step by lot step over a
reveal cursor; ADR-0027 makes the per-competition reveal a lifecycle state with the public middle derived.
Building the show (issue #71) forced several concrete questions the prior ADRs left open: where the show
lives, who drives it, whether the operator can step backwards (the PRD, issue #66 user story 9, asked for
„vor/zurück"), what the admin shows while a draw is mid-reveal, and what happens once it is fully revealed.

## Decision

- **The show is the operator's projection in the gated admin, not a public URL.** „Jetzt auslosen"
  computes the draw and opens the full-screen show at once (cursor 0); the operator projects it onto the
  hall screen and paces it. The off-site audience watches the separate public live bracket, which mirrors
  the same cursor-sliced reveal by polling (ADR-0008). There is no public self-serve show.
- **The reveal moves forward only — the „zurück" step is dropped (revising PRD US-9).** A lot, once shown,
  is already public (the live bracket mirrors the cursor within ~1–2s), so a back-step would un-reveal it
  there — incoherent for a live reveal. A held presenter key is guarded against double-firing instead, so
  the forward path cannot accidentally skip a lot either.
- **The Auslosung is a one-time act, not a replayable show.** Once the cursor reaches the end the draw is
  fully revealed; the admin then shows the bracket and the "open the show" affordance is gone. (A reload
  mid-reveal still resumes from the persisted cursor — ADR-0003 — so an interrupted reveal can be
  continued, just not replayed from the start once it is complete.)
- **While a draw is mid-reveal the admin withholds its bracket,** showing „Auslosung läuft" and the _x/y_
  reveal progress instead. Only a fully revealed draw shows its bracket in the admin. Projecting the admin
  therefore cannot leak the result ahead of the show — the same suspense the public reveal endpoint already
  enforces (ADR-0003), now also true of the operator surface, and consistent with the unriggable draw
  (ADR-0002).

## Consequences

- The show reads the cursor-sliced public reveal (`GET /api/draw`) and advances via the admin endpoint; it
  never re-rolls (ADR-0003) and needs no separate server surface of its own.
- The „Konkurrenzen" surface gates on `cursor === total`: _not drawn_ → _„Auslosung läuft"_ (cursor <
  total) → _„ausgelost"_ (bracket shown). The admin draw projection carries the reveal cursor + total so the
  surface can render this without reading the unrevealed tail.
- Forward-only means a misfire reveals one lot early with no undo; this is accepted as truthful to a real
  draw (a drawn name cannot be un-drawn) and mitigated by the double-fire guard.
- The visual treatment — a light, club-palette stage for beamer readability in a sunlit hall — is
  presentation, recorded in CONTEXT (the glossary), not a decision here.
