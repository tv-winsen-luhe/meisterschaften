# ADR-0066: The public participant list is a seeding board on every seeded field

- Status: accepted
- Date: 2026-08-17
- Relates to: ADR-0058 (unseededness is a slug-suffix trait — the predicate this adopts), ADR-0061 (the
  Challenger publishes its seed numbers — half-implemented until now), ADR-0065 (one LK order for the cut,
  the Setzliste and the public list), ADR-0047 (seed rank is LK-derived, never read off a row's position),
  ADR-0046 (the sibling split: `tournament-draw.render.ts`), ADR-0022 (a field-type rule, never a per-slug
  exception)

## Context

The Herren Challenger's Setzliste on the website showed no seed markers, while the Herren Hauptfeld's did.
Two accepted decisions already said it should: ADR-0061 §1 made seed numbers public on the Challenger
("because a draw must be checkable"), and ADR-0065 said the Setzliste's badges read in numeric order on
every field. The tableau preview honoured them; the public participant list never did.

The cause was a slug allow-list in `participant-list.astro`:

```ts
const layoutFor = (slug: string) => (slug === 'mens' || slug === 'womens' ? 'board' : 'list')
```

`mens-challenger` fell through to `list`, and that one word suppressed three things at once — the position
number, the seed circle, and the lot divider — because the row builder gated the rank cell on
`layout === 'board'` and the group loop forced the seed count to `0` for anything else. The wire had
carried a correct Challenger `seedRank` since ADR-0047; this surface simply ignored it.

The allow-list was defensible when it was written: ADR-0047 records that "the participant list ignores it
(a Challenger field renders as a registration-ordered friendly list with no seed markers)" — a list in
registration order genuinely cannot carry seed markers without lying about who is seeded. ADR-0065 removed
that premise a day after ADR-0061 removed the redaction one, and neither ADR revisited this file. A rule
written as two hardcoded slugs cannot be found by a search for the predicate that superseded it, which is
why it survived both.

## Decision

**Whether the public participant list renders a field as a seeding board is `!isUnseededCompetition(slug)`
— the same predicate ADR-0058 made the single carrier of unseededness — never a list of slugs.** Only the
`-social` mixer keeps the friendly list, because it is unrated by construction and never drawn.

Three consequences of that single rule:

1. **The Challenger panel becomes a board.** It gains position numbers, filled seed circles on Nr. 1–4
   with bold names, the LK column it already had, and the „Weitere im Feld — Platzierung wird bei der
   Auslosung gelost" divider it has never had. The divider is literally true there: the Challenger is
   drawn like any other field, and below the seed line the lot places the rest.
2. **A row is seeded iff the wire says so — `seedRank != null` — and the circle shows that number, not the
   row's position.** This is ADR-0047's rule applied to the last surface that had not adopted it. The
   client's own `displaySeedCount` call is deleted: the server already applies the DTB seed count and the
   draw floor (`worker/store/registrations.ts`), so a second computation over the same rows could only
   ever disagree with it — and if it did, the client would be the wrong one. The two coincide today
   (ADR-0065 gave the list and the seeding one comparator); the circle reads `seedRank` so that they may
   diverge again without the display lying.
3. **The `data-layout` attribute and the `layoutFor` helper are deleted.** The row builder took both a
   `layout` string and an `unseeded` flag — two parameters for one fact, which is how they drifted apart.
   They collapse into one `seeded` boolean, derived in exactly one place: `renderField` takes the
   competition's **slug** and applies the predicate itself, rather than accepting a ready-made flag from
   its caller. The decision this surface got wrong for two ADRs therefore lives inside the module a test
   can reach, not in the `<script>` block that no test can.

The caption loses its „Im Hauptfeld" qualifier: „Die markierten Plätze zeigen die **vorläufige Setzung**
nach Leistungsklasse". The prose no longer re-encodes the field list that the code just stopped encoding.
„(vorläufig)" stays in the seed tooltip — ADR-0065 deleted the `provisional` _flag_ because every cut is
now provisional, not because the pre-draw seeding stopped being so; it is provisional until the freeze.

**The row builders move to `src/components/participant-list.render.ts`**, mirroring the split ADR-0046
made for `tournament-draw.astro`: the `<script>` keeps fetch, phase caption and scarcity meter, the module
owns the DOM. That is what makes the behaviour testable — the bug lived in the interaction between the
layout gate and the row builder, and neither could be reached from a test while both sat inside a
`<script>` block.

## Consequences

- `test/participant-list-render.test.ts` covers what two ADRs missed: a Challenger field renders the same
  markers as a championship field, the circle numbers by `seedRank` rather than position, and the mixer
  renders none of it. Every case goes in by **slug**, so restoring the old allow-list fails three of them.
  It uses the `document.createElement` shim of `test/preview-seed-lot.test.ts` — Vitest runs in the workers
  pool, which has no DOM, and a jsdom environment would fight that config.
- The divider is placed at the first row with no `seedRank`, not counted out: the seeds are a prefix of the
  wire order because one comparator ranks both (ADR-0065).
- Below the draw floor (fewer than four confirmed entries) the server sends `seedRank: null` for everyone,
  so a small Challenger field shows no markers yet. That is the same boundary the scarcity meter honours.
- The panel's seeded-ness is no longer visible in the server-rendered HTML. Acceptable: the panel is a
  skeleton until the fetch resolves, so nothing read the attribute before the script ran anyway.
- ADR-0047's consequence bullet claiming the participant list "ignores it" is corrected there, in place.

## Considered and rejected

- **Just add `'mens-challenger'` to the allow-list.** The one-word fix, and the reason this bug exists: it
  leaves the next competition to trip over the same list, and leaves the rule unsearchable from the
  predicate that governs it. ADR-0022 already rejected per-slug exceptions in favour of field-type rules.
- **Make every field a board, mixer included.** Puts a rank number on a field whose placement is genuinely
  by lot, and contradicts ADR-0058's point that a mixer entry is not weak, it is unrated.
- **Open the gate but keep the marker position-derived.** Correct today by coincidence only — it works
  because ADR-0065 aligned the two orders, and would break silently if they ever split again. That is
  precisely the failure ADR-0047 was written about.
- **Extract only the row builder, not the group loop.** Would have left the part that was actually broken
  untested.
