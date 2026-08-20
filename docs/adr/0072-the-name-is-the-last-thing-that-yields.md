# ADR-0072: The name is the last thing that yields

- Status: accepted
- Date: 2026-08-20
- Refines: ADR-0070 (one surface owns the schedule and the results; `slotGames` is the single formatter),
  ADR-0046 (the public bracket projects live results once fully revealed)
- Relates to: ADR-0050 (per-entry club logos stay — re-examined here and **kept**), ADR-0069 / ADR-0071
  (the published time and its hedge), ADR-0028 (English everywhere except user-facing copy; the linkable
  bracket), ADR-0042 / ADR-0060 (the front door is phase-projected, so the signup CTA is absent during
  `tournament`), ADR-0004 (the round pager on a phone)

## Context

A review of both weekend surfaces against a running build — local D1 in `tournament` phase, schedule
published, 2 draws / 32 matches / 36 registrations, read at 1440px and 400px — found four defects with
located causes (fixed separately) and around eleven design problems. Listed as eleven, they look like a
polish backlog. They are not: **eight of them are competing bids for the same pixels in one row**, and the
name loses every time. Observed truncations, verbatim: „Maximilian Bus…", „Henry Falkenb…", „Steffen
Brettschn…", „Fabian P…", „Sascha Kra…".

The draw's entire job is telling a reader who plays whom, and the name is the **first** thing sacrificed —
to the LK badge, the seed chip, the crest, and a status pill that reads `GEPLANT` on twenty-odd rows where
planned is the default state. Meanwhile the one genuinely time-sensitive fact on the page, „läuft", is the
quietest thing on it: muted sage on light grey, and on the courts strip two live matches are distinguished
from four idle courts by a faint green border alone — status by colour only, which also fails a colourblind
reader. The lime brand accent is spent on a signup CTA.

**Who the surfaces are for settles all of it.** `CONTEXT.md` (Match status) names „off-site followers", while
the whole reservation apparatus of ADR-0069/0071 exists for „a player who drives home between matches". Both
are real; only one breaks ties. This is a one-weekend club championship on six courts at one venue, so the
reader who decides every trade-off is **on site, on a phone, choosing which court to walk to** — and that
reader is also the one truncation hurts most. The off-site follower wants the same facts in the same order,
without the urgency, so serving the on-site reader costs the follower nothing.

Fixing the eleven findings one at a time means re-litigating that same pixel budget eleven times, and losing
each time, because no individual ticket has standing to remove anything from the row.

Two things the review asserted that checking the build **corrected**, both recorded here because they change
the decision:

1. **The crest is not a rare-case mark.** The review reported „one non-Winsen crest"; the data says 5 of 36
   registrations are TSV Winsen — **14%**. And ADR-0050 already settled it: „Per-entry club logos **stay**
   (they identify a person's club, not a co-organiser)."
2. **A finished match cannot have an empty score position.** `status: 'done'` is only ever written in the
   same patch as winner + outcome + score (`worker/store/draw.results.ts:106`), and ADR-0070 §4 renders
   „Aufg." / „w.o." _in the score position_ when sets are missing. The only scoreless winner is a bye
   (`outcome: 'bye'`, no score — `shared/draw.ts:554`), and a bye is never a schedule row; it is the
   „Freilos" ghost cell on the bracket.

## Decision

**The weekend surfaces are scanned, not read, and four rules follow. They apply to `/spielplan` and the
public bracket together** — ADR-0070 §4 already binds them through the single `slotGames` formatter, so a
stance about what a live match looks like must be one stance or the formatter grows three opinions.

1. **The name is the last thing that yields; the LK badge is the first.** A contestant line drops its LK,
   then its seed chip, then its crest, before one character of a name is clipped. If everything has yielded
   and the name still does not fit, it **wraps** — a two-line name is readable and „Steffen Brettschn…" is
   not. This is a general rule, not a per-breakpoint fix: anything added to the row in future has to argue
   against it.

2. **A filled score position means finished; „läuft" is the only badge on the page.** `geplant` is the
   default and goes unmarked. `beendet` goes too — a row carrying „6:4 6:2" does not need a pill to explain
   itself, and per Context §2 the score position is never empty on a finished match, so there is no gap to
   cover. That leaves exactly one badge, on the one fact worth badging, and returns the ~28% of a mobile row
   the pill was eating.

3. **„läuft" owns the brand accent and a non-colour signal.** The lime accent moves from the CTA — absent
   during `tournament` anyway (ADR-0042/0060; `index.astro:162-180` swaps the hero CTA for
   `data-phase-lead="tournament-*"`) — onto the live state, on both the Live board strip and the in-list
   row, plus a **filled left rail** so the signal survives greyscale and a colourblind reader. **No motion:**
   a pulsing dot would need a `prefers-reduced-motion` escape hatch to say what the accent and the rail
   already say.

4. **The dead canvas funds the names.** Over 40% of the desktop bracket canvas is empty — a tall void right
   of the final, another below round 1. That space is not waste to be tolerated or filled with a panel; it is
   **the budget rule 1 spends.** Widening the cells into the horizontal void is what makes rule 1 achievable
   without layout gymnastics, so §1 and §4 are one change, not two competing ones. The „Spiel um Platz 3"
   box moves into the vertical void beside the final, where it belongs — it is already a match inside
   `bracket: 'main'` (`shared/advancement.ts:24`, ADR-0046).

**Consequent presentation, recorded as detail rather than as decisions** (these belong in the spec, and are
listed so the spec is not re-derived):

- **The mobile row becomes two stacked contestant lines**, each carrying its own name and its own set scores
  at the line end — the anatomy the renderer's own comment already names, „crest · full name · seed"
  (`schedule-board.render.ts:26`). One change retires three findings: score ownership becomes structural
  rather than alignment-dependent (today „6 6 / 3 4" floats between two names and can be misread by one
  column, which on a results surface is a correctness problem), the opponent boundary becomes the line break,
  and **`✓` is deleted** (see Consequences).
- **The crest stays on every line, unconditionally** (ADR-0050 upheld — see Considered and rejected).
- **The intro shrinks to one sentence plus a disclosure.** Eight lines on the „ca." convention above the
  first match is a preface on a page whose job is „when do I play"; ADR-0071 put the number in front of the
  hedge precisely so „14:00" versus „ca. 14:00" reads without one.
- **An undetermined round collapses to one summarised block.** Twelve consecutive rows reading „Sieger M11 —
  Sieger M12" name nobody. The dashed placeholder is right in a **bracket cell**, where topology makes it
  meaningful, and wrong as **twelve list rows**, where it is noise — this is a scoping of that device, not a
  reversal of it.
- **The round pager is re-ranked and carries progress.** Competition tabs („HERREN" / „HERREN CHALLENGER")
  and the pager are currently both square and dark-filled, so „which field" and „which round" read as equals.
  They are different kinds: the competition switch is linkable and persists (ADR-0028), the pager is
  positional. The pager becomes a quieter positional device — a positional control that looks like a mode
  switch invites the wrong tap — and shows **which rounds have results**, which costs a render rather than a
  projection change because ADR-0070 §2 already put `score` and `outcome` on the `LiveBracketMatch` wire. The
  8/4/2/1 round counts return on both: on a phone „Runde 2" alone does not say how big the round is.

## Considered and rejected

- **Eleven independent tickets.** The honest reading of the review, and it fails on the pixel budget: no
  single ticket has standing to remove the status pill or widen a cell, so each one would be argued and lost
  on its own.
- **Three ADRs — one per argument** (the crowded row, the invisible live state, the document pacing). Cleaner
  on paper. Rejected because rule 4 funds rule 1: splitting them puts the space and the thing that needs the
  space in different documents.
- **Showing the crest only where it differs from the host club** — 14% informative, 86% redundant, so the
  mark would mean „this person plays for TSV" and serve ADR-0050's stated _reason_ while dropping most of the
  marks. Rejected as a **presentation** call, not a data one: it makes TV Winsen the unmarked default and a
  TSV member could read a mark only they carry as being singled out. Rule 1 already stops the crest from
  costing a name anything, so the redundancy is affordable. Recorded so the next reader knows this was
  examined and kept, not overlooked.
- **Deleting the crest outright.** A straight revision of ADR-0050; the accessory Chanel would remove, and
  not ours to remove for width we got elsewhere.
- **Keeping `beendet` as a badge for explicitness.** Rejected on Context §2: it is unreachable as a distinct
  state — a `done` row always says so in the score position.
- **A pulsing dot for „läuft".** The loudest available non-colour signal, and it buys nothing over the accent
  plus the rail while adding a reduced-motion branch.
- **Filling the bracket void with a champion or summary panel.** Treats the space as a hole to plug. The
  names need it more, and a panel would compete with the final for the eye.
- **Naming the stance „scoreboard".** Useful for arguing about how the surfaces should be read, and rejected
  as vocabulary: the page and the strip already have names (`CONTEXT.md`: Schedule & results page, Live
  board), and a fourth metaphor for two existing things is how „Live board" came to mean both of them.

## Consequences

- **`CONTEXT.md`'s „Live board" is split, done in this change.** It named both the whole weekend page and the
  „jetzt auf dem Platz" strip inside it. It now names **only the strip**; the page becomes **Schedule &
  results page** (de: Spielplan & Ergebnisse), matching what ADR-0070 §1 called it. The entry warns against
  „public schedule" for the page, because `publicSchedule()` is the projection carrying only the **gated
  plan** — reusing the name would re-collapse exactly the gate asymmetry ADR-0070 §3 says must not be
  collapsed for tidiness. „Scoreboard" is recorded as not a term.
- **ADR-0071's closing illustration is retired, and its principle is not.** Its last consequence cites „the
  winner being both bold and checked" as deliberate redundancy that survives a phone in bright sunlight —
  and the presentation detail above deletes that `✓`. The principle stands and is honoured: the winner is still stated twice, by
  weight **and** by owning the higher scores on its own line, which is a stronger second signal than a glyph
  that also appears on bye winners and reads as „confirmed" rather than „advanced". The dimming redundancy
  ADR-0071 actually decided is untouched.
- **Advancement stops being stated by a glyph and starts being structural.** On the bracket it already was —
  the cell appears in the next round.
- **`slotGames` gains no callers and loses none.** All four readers (bracket cell, schedule row, courts
  strip, admin list) keep reading it; what changes is what sits next to it.
- **Rule 2 is a live-copy change with no wire change.** `schedule-board.render.ts:117` emits
  `sched-status--${row.status}` unconditionally today; it becomes conditional. `planned` stays a stored and
  wire value (ADR-0028 — data values are English and this is not a data decision).
- **Section padding becomes phase-aware.** ~280px between the hero CTA and `AUSLOSUNG`, and ~250px before the
  mobile terracotta band's text, are marketing-page rhythm applied to a board. They tighten under
  `tournament`. This is the one place the stance touches the front door rather than the two surfaces.
- **The admin is untouched.** The operator reads a dense list at a desk, not a board in sunlight; nothing
  here argues about that surface.
- **This ADR does not build anything.** The four rules are the hard-to-reverse part; the presentation detail
  above goes to a spec and then to tickets.
