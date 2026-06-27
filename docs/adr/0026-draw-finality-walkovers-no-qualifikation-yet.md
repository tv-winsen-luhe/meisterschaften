# ADR-0026: A drawn bracket is final — dropouts are walkovers, no Nachrücker/Lucky Loser (no Qualifikation yet)

- Status: accepted
- Date: 2026-06-27
- Builds on: ADR-0002, ADR-0003 (automatic, unriggable, precompute-then-reveal draw)

## Context

The draw is precomputed atomically and revealed Los für Los (ADR-0003). Two questions the Auslosung
epic must answer: when may a draw be re-run, and what happens when a player drops out after the draw?
DTB §32.2 is explicit — "eine Auslosung darf, sofern sie den Regeln entspricht, nicht wiederholt
werden": a rules-compliant draw is final. DTB also defines Nachrücker (§25.5) and Lucky Loser (§25.4,
§33.2b) to fill spots vacated before play — but **Lucky Loser are a Qualifikation mechanism** (a quali
loser fills a Hauptfeld vacancy). The event currently has no Qualifikation: it is vereinsintern, with
no Sign-In. A Qualifikation is, however, a recognized **conditional possibility** — likely a
Friday-evening round, triggered only if a Konkurrenz draws more than 16 entrants.

## Decision

**A drawn bracket is final the moment it is revealed.**

- **Re-run is break-glass and only before the first revealed Los.** While the draw is computed but
  unrevealed (reveal cursor still 0, nothing public), the operator may discard and re-draw — this is
  the only legitimate "repeat," because nothing has been published. Once the first step is revealed
  (cursor > 0 / the show is live), the draw is **frozen** and the start endpoint refuses a re-run.
- **A post-reveal dropout is a Walkover**, not a re-draw and not an edit (ADR-0002). The opponent
  advances "ohne Spiel" (DTB §33.4). CONTEXT already models Walkover as a match outcome — that is the
  lever, not a new draw.
- **No Nachrücker and no Lucky Loser** are built. With no Qualifikation there are no quali losers to
  promote, and a vacated Setzliste position is simply not back-filled — the bracket stands and the
  vacancy resolves as a walkover.

**The Qualifikation is deferred, but the model is not closed against it.** We do not build a quali
system now: it is conditional (only if a field exceeds 16), uncertain, and its format is undefined —
building it speculatively is pure cost (CLAUDE.md: simplest solution; ADR-0021: small N). Should it
become real, it is an **additive** change: the `bracket` discriminator gains a `qualifikation` value,
`matches` gains a cross-bracket feed (Qualifikant → Hauptfeld slot) by migration (ADR-0025), the draw
procedure (a reusable pure module) is run once more for the quali field, and **this ADR is reopened** —
Lucky Loser become DTB-relevant the moment a Qualifikation exists.

## Consequences

- The draw module needs no Nachrücker/Lucky-Loser machinery and no Setzliste back-fill logic — a real
  simplification over the full DTB §33/§34 procedure, recorded as a deliberate deviation so it is not
  later "fixed."
- Two threads stay explicitly outside this epic: the **registration cap** ("what happens when >16
  register" — accept / waitlist / cap is a Registration-domain question; today there is no hard cap)
  and the **quali format** (decided only if entry counts force it).
- The re-run guard hangs on the reveal cursor: "unrevealed" (cursor 0, not public) is the only state
  in which the start endpoint will replace an existing draw.
