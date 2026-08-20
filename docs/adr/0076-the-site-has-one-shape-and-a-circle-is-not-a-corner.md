# ADR-0076: The site has one shape, and a circle is not a corner

- Status: accepted
- Date: 2026-08-20
- Amends: ADR-0075 rule 3 (the card promises nothing)
- Relates to: ADR-0070 (the schedule is the results surface, the bracket carries its own score), ADR-0072
  (the weekend surfaces are scanned, not read), ADR-0052 (the competition card renders on the front door and
  the porches alike)

## Context

The prompt was a reader's complaint, not a bug: `/spielplan` looks like a different site than the front door,
and the rounded corners are why.

Checking the two pages side by side is what makes the complaint precise. **The front door holds one shape
with total discipline: the rectangle.** The competition cards are hard-edged blocks of flat colour that butt
against each other on a 2px seam. The badges are hairline rectangles. The format chips are flat-filled
rectangles. The signup CTA is a lime rectangle. The lead's accent is a hard bar, the section dividers are
hairline rules, and the display face carries an outline rather than a fill. There is not one rounded corner
on the page. The single soft gesture anywhere on it is the marker brush behind „HERREN CHALLENGER" — and that
is a **hand-made mark**, irregular on purpose, which is the opposite of a geometric softening.

`/spielplan` had five radii: 12px on the mixer band, 10px on a court cell, 8px on a match card, and 999px on
both the filter chip and the „läuft" badge. The public bracket had three more — 999px on the segment control
and on its own „läuft" badge, 11px on the lot number.

One of those is the whole argument on its own. `.board-chip`'s inactive fill is
`color-mix(in srgb, var(--color-navy) 6%, transparent)`. The front door's format chips are `bg-navy/[0.06]`.
The **same fill**, at the same 12px, the same weight, the same tracking, on the same white ground. The only
thing that ever differed between the two was the shape: a pill on the schedule against a rectangle on the
card. That is not a decision anybody made, it is two people drawing the same component twice — and a reader
who meets both in one session correctly concludes they are looking at two products.

The other thing the side-by-side reading found is that the rounding was already **arguing against a decision
this project had made in writing**. ADR-0075 rule 3 says the match card „promises nothing" — no fill, no
shadow, no hover lift, no link — because cards are the language of tappability and this project has no match
detail page for a tap to reach. It then gave that card a radius. A rounded rectangle is the single strongest
tappability cue in a stylesheet; of the five properties rule 3 considered, the one it kept was the one
working against it.

## Decision

**The site has one shape. Everything is a rectangle, and a circle is only for something that is round in the
world.** Two rules, and the second is what stops the first from being a blunt instrument.

1. **No rounded rectangles anywhere on the public site.** Not on panels, not on cards, not on chips, badges,
   controls, bands, or notices. `border-radius` on a rectangle is not a property this design has. The
   boundary work a radius was doing is carried by what already carried it on the front door: a hairline
   border, a flat fill, a hard rail, a rule, or a gap.

2. **A circle is a different primitive, and it stays.** The club crest on a contestant line, the club logo in
   the modal and on the presence strip, the participant avatar, the seed disc, the draw's pips and its
   progress dot: every one of these is `50%` (or `999px`) on an **equal-sided box**, so it draws a circle
   rather than a softened rectangle. They are round because the thing they depict is round — a crest is a
   disc, a dot is a dot — and the front door flies both a round crest and the lime dot after
   „MEISTERSCHAFTEN.", so the circle is already in this vocabulary. What is not in it is the stadium and the
   squircle: the lot number's 11px on a 22px box read as a pill, and went.

The test a new element has to pass is therefore not „how much radius" but „is this thing round". If the
answer is no, it has corners.

**ADR-0075 rule 3 is amended rather than overruled.** Its intent — a frame that states „this match ends
here" and claims nothing else — is unchanged and better served without the radius. The list simply loses its
exception: no fill, no shadow, no hover lift, **and no radius**.

**ADR-0070 §4 is why the bracket moves in the same pass.** It holds that the schedule and the bracket keep
one stance on how a live match looks. A squared „läuft" on the schedule beside a rounded one in the bracket
would be exactly the divergence that section forbids, so `.sched-status--running` and `.dm-live` are one
change, not two.

## Alternatives considered

- **Rounding the front door instead.** The cheaper direction on paper — one shape token, applied outward — and
  wrong, because the front door's squareness is not a default it fell into. The outlined display face, the
  full-bleed clay band, the flush card seams and the hard lime rail are a coherent, deliberately severe look
  that a radius would sand the edge off. The page with the point of view is not the page that yields.

- **A `--radius` token, set to a small value everywhere.** This is what „make it consistent" usually means
  and it would have made the incoherence uniform rather than absent: eight elements rounded to the same 6px
  is still eight elements the front door has no counterpart for. It also invents a knob whose only honest
  setting is `0`.

- **Keeping the pill on the two controls (`.board-chip`, `.dm-seg`) and squaring the rest.** Defensible for
  about as long as it takes to look at the front door's chips, which are the same component with the same
  fill and are rectangles. There is no version of this where the filter chip and the format chip are
  different shapes and both are right.

- **Squaring `.dm-seg` was checked against a recorded reason and the reason did not hold.** The comment on it
  said the segments were pills so the round pager below „can never read as a second row of the same rank".
  `.dm-roundtab` turns out to be an underline tab — transparent, no box, a rail on one edge — so the rank was
  never carried by the curve. Bordered box against underline tab, uppercase-and-tracked against mixed case,
  and a size step: stated three times over without it.

## Consequences

- **The change is CSS only, and subtractive.** Eight `border-radius` declarations are deleted across
  `spielplan.astro`, `tournament-draw.astro` and `participant-list.astro`; no markup, no render module and no
  view model is touched, so every render test holds by construction. Two `border-radius: 0` resets in print
  blocks go with them — they existed to undo a screen radius that is no longer set.

- **The rule is stated as a shape, so it is checkable.** „No `border-radius` on the public site except `50%`
  or `999px` on an equal-sided box" can be read off a grep, which is the property the old situation lacked:
  five radii accumulated one plausible element at a time, each defensible alone.

- **The court cell keeps its tint and its hairline.** Squaring was the whole ask; the courts board is a data
  surface and six discrete cells want a border in a way a marketing card does not. What it does not keep is
  the soft edge that made it read as an app tile.

- **The card now reads as un-tappable, which is what ADR-0075 wanted.** Rule 3's stated goal was a boundary
  rather than a destination, and the frame states it more plainly with corners than it did with a radius.

- **The front door's flush card seam is not adopted here.** The competition cards butt against each other;
  the courts board keeps its 10px gap, because six independent courts are not one continuous block. Shape is
  shared, layout is not — the schedule is allowed its own grid.

- **The admin is untouched.** It is a shadcn surface with its own radius scale, behind Access, and nobody
  reads it beside the front door. This ADR is about the public site.

- **What this does not fix.** The schedule's `<h1>` sits at `clamp(36px, 6vw, 56px)` while the front door's
  section headlines run on `--text-h2` at `clamp(44px, 10vw, 120px)`, and the day heading is a 12px
  small-caps label where the front door would set a display line. So the two pages still do not share a
  **type** scale, and a reader may well read that as the same complaint. It is a separate decision with a
  real argument on both sides — a board scanned at the courts has different needs from a page scrolled on a
  sofa — and folding it in here would let a shape decision settle a typography one it did not make.
