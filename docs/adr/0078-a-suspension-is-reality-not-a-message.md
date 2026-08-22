# ADR-0078: A suspension is reality, not a message

- Status: accepted
- Date: 2026-08-22
- Amended: 2026-08-22 (see Amendments below — the band is pinned and it condenses; the suspension names
  its courts, so play can resume on one court while another stays stopped)
- Relates to: ADR-0032 (the live phase records reality; status is the signal), ADR-0041 (the schedule
  publish gate — the plan is what the organiser withholds), ADR-0071 (the hedge moves behind the number),
  ADR-0077 (the operator reads the plan, the public reads the announcement), ADR-0048 (a wire decision, read
  as one signal), ADR-0062 / ADR-0064 (the `app_state` singleton and the `/api/phase` signal), ADR-0035 (the
  feed degrades per slot), ADR-0076 (the site has one shape), ADR-0021 (small N), ADR-0028 (English
  everywhere except user-facing copy)

## Context

The ask was one sentence: a „Flashmeldung" for a rain delay — play suspended, switchable from the admin.

The word is the first thing to go. „Flash message" already means something else in web vocabulary (the
one-shot notice after a redirect), and this project has refused a borrowed word before on exactly these
grounds — „**Scoreboard** is **not** a term in this project: it is a useful word for arguing about how the
weekend surfaces should be _read_, but the things it would name already have names."

What is left after the word is a genuine gap. The site has a **Match status** (`planned → running → done`)
and a **Live board** derived from it, and both are per-match. It has a **Schedule publication** flag, which
is per-event but gates the _plan_. It has nothing that says something about the **whole event, right now,
that is true rather than planned**. When it rains on the sand, every match that has not started is wrong
about when it starts, the three that are running are standing in the clubhouse at 4:3 in the second set,
and the site says nothing at all.

Two facts about the codebase turned out to decide the shape more than any preference did.

**First: `/api/phase` is read exactly once, on load.** Every consumer says so in its own comment — the front
door's cancellation patch (`competition-card.astro:44`), the admin hooks (`use-cancellation.ts:14`,
`use-social-mixer.ts:19`), and `/spielplan` itself („done once on load", `spielplan.astro:1024`). So the
naive placement — a global flag beside `cancelledCompetitions` on `/api/phase` — would have been invisible
to the one person the feature exists for: a spectator with the schedule open for forty minutes would never
see the suspension appear, and never see it lifted. **Second: `/spielplan` polls `/api/schedule`, and only
that, every 15 seconds** (`POLL_MS = 15000`).

**Third: the palette has no warning colour.** It has navy, blue, neon, clay and grey — and `--color-live` is
already `var(--color-neon)`. Neon means „läuft".

## Decision

**The suspension is a typed state of the event, not a message about it.** Eight rules.

1. **It is a state plus an optional time — never free text.** `Play suspension`: suspended yes/no, and
   optionally the clock time play is expected to resume. There is deliberately **no operator text field**.
   Two reasons, and the second is the load-bearing one: a text field on a public page, typed from a phone in
   the rain, is an **unreviewed publication**, and every other public string in this codebase is built by a
   projection (`shared/match-view`: every string is finished German, a renderer never concatenates). A
   feature that is the single exception to that rule does not stay the single exception.

2. **The name carries no cause.** „Spielunterbrechung", not „Regenpause"; `playSuspension`, not `rainDelay`.
   A thunderstorm, a wind that makes the clay unplayable, an ambulance on court, floodlight failure on 5/6 —
   for the spectator these are one thing, and the copy that names rain is a lie in four of five cases.

3. **It never touches Match status.** A match at 4:3 in the second set, waiting in the clubhouse, **is
   running** — it is neither unplayed nor finished, and its Zwischenstand belongs to it. Setting the
   suspension changes no match row and the Live board keeps standing; the banner supplies the context the
   board never had. Automatically reverting `running → planned` would be a data loss nobody undoes.

4. **While suspended, every not-yet-started Published time hedges — on `/spielplan` alone.** The suspension
   is precisely what ADR-0071 defines a hedge to be about („what can still move this start"), so it moves
   everything, including the day's first match that had nothing in front of it. But the hedge is a
   **statement with an explanation**, and it is only said where the banner stands: the **Bracket cell's**
   footer time is untouched, because a „ca." a reader cannot resolve is noise. Two surfaces rendering one
   placement differently is not drift here; it is the rule ADR-0077 just set — the same number, two readings,
   by rule.

5. **It travels on `/api/phase`, and `/spielplan` promotes its phase read to the existing 15s poll.** One
   decision, one home, one signal (ADR-0048), beside `phase`, `cancelledCompetitions` and the mixer block on
   the `app_state` singleton row. The price is named rather than discovered later: **`/api/phase` stops being
   a read-once wire and becomes a live one.** The front door keeps its single read — nobody parks on the
   front door for forty minutes.

6. **It is bound to `tournament`, and the transition to `post-event` clears it.** „Spielbetrieb unterbrochen"
   over the archive (ADR-0007) would be absurd, and the **last suspension of the tournament is exactly the one
   nobody lifts** — on Sunday evening one switches phases, not banners. This is the one automatic act in the
   feature, and it can break nothing, because the tournament is over.

7. **The time decays; the suspension does not.** It is 14:40 and „weiter ca. 14:30" has been refuted: the
   banner falls back to the plain state, the suspension stands until the operator lifts it. Auto-lifting at
   the resume time is the one option that fails **positively and silently** — it would announce that play has
   resumed. A stale „unterbrochen" is a visible error, loud in the admin (rule 8); a false „we are playing"
   is not. This is ADR-0035's per-slot degradation applied to one statement: the claim that no longer holds
   falls away, the claim that holds stays.

8. **One switch in the admin shell; one clay band at the top of two public pages.** The switch lives in the
   **shell**, not in a surface — the context is one person, one phone, rain, and both requirements point the
   same way: switching it on must be one tap from anywhere, and the on-state must be **loud wherever the
   operator looks**, which is ADR-0041's posture for the forgotten publish. It is explicitly **not** beside
   the phase controls: a suspension is not a phase, and standing it next to the two global transitions
   (ADR-0027) invites exactly that confusion. Publicly it is a full-width band at the top of the page content
   — above the Live board on `/spielplan`, above the front-door lead — in **clay** (`--color-clay`), not
   sticky and not dismissible, inheriting its shape unchanged from ADR-0076. Clay is not the leftover colour:
   it is **the colour of the court that cannot be played on**, so the state wears the colour of its cause
   without naming it (rule 2). Neon was unavailable on meaning, not on taste — it is `--color-live`.

### The copy

Without a time:

> **Spielbetrieb unterbrochen**
> Alle geplanten Startzeiten verschieben sich.

With one:

> **Spielbetrieb unterbrochen**
> Weiter geht es ca. 14:30 Uhr. Alle geplanten Startzeiten verschieben sich.

The second line is not decoration — it is what makes rule 4's „ca." legible on `/spielplan`. „**ca.**", not
„ab": the same word and the same reason as ADR-0071 — play can be called **earlier** too, and „ab 14:30"
would be a floor nobody promised. The front door says less, because it has no times to explain: **„Spielbetrieb
unterbrochen — Weiter geht es ca. 14:30 Uhr. Zum Spielplan"**. The front door points; the schedule owns its
content.

### The shape of the state

Two columns on `app_state` (`play_suspended` boolean, `play_resumes_at` nullable), a **discriminated union**
on the wire — `{ suspended: false } | { suspended: true, resumesAt?: … }` — and the Store **normalises on
read** (not suspended ⇒ the time falls away). The impossible state can exist in SQLite and does not survive
the Store, which is the shape `cancelledCompetitions` already has in the same row: a loose column below,
validation above, fail-closed. The resume time is an **absolute clock time**, free of the schedule's
30-minute grid, offered in the admin as **+15 / +30 / +60** quick-taps that resolve to an absolute value.

## Considered and rejected

- **A free-text notice banner** — the obvious build, and the one the ask literally described. It loses on
  rule 1's second reason, and on a subtler one: under a free-text banner every „ca. 14:00" on the page below
  stays unchanged and keeps asserting something false, so the banner contradicts the page carrying it. Only
  a typed state can pull the other surfaces with it.
- **A text field _in addition_ to the time** (the „both" option). Rejected as the cost of rule 1 rather than
  as a free win, because it does give up something real: **„Heute geht nichts mehr, Fortsetzung Sonntag"
  cannot be said.** That is a real rain-day sentence. The position taken here is that it is a
  **rescheduling**, not a notice — its honest form is moved placements and a phone call, not a banner
  overwriting a page that still claims Saturday 16:00. If that judgment turns out wrong, this is the rule to
  re-open, and re-opening it means re-opening rule 1's exception too.
- **Auto-lifting when the resume time passes.** See rule 7. Recorded because it is the feature anyone would
  add without thinking about the sign of the failure.
- **Setting running matches back to `planned`, or marking them „unterbrochen" on every surface.** See rule 3.
  The second is not wrong so much as redundant: the band above the board already says it once, for all of
  them.
- **Reusing the schedule's 30-minute slot grid for the resume time.** The interesting mistake. Rain stops at
  14:20. And ADR-0077 just named the distinction the reuse would blur: the grid is a **reservation**
  instrument (the operator reads the plan), the resume time is an **announcement** (the public reads the
  announcement). Sharing the vocabulary would assert a kinship that is not there.
- **Storing the resume time relatively („+30 min"), the way the operator actually thinks.** Storing it that
  way needs a reference instant carried alongside — more state for the same statement. The relative thinking
  survives where it belongs: in the buttons.
- **Riding `/api/schedule`, the wire that is already polled.** Genuinely tempting — a live fact on the live
  wire, no promotion needed. It loses because the **front door does not read `/api/schedule`** and would need
  a second source for one decision.
- **Carrying it on both wires.** Ruled out without discussion: two wire sources for one decision is the
  failure ADR-0048 is named after.
- **Its own table.** Premature by the schema's own stated trigger — a table is what „the moment a **second
  per-competition** operator flag appears" calls for, and this is global, i.e. exactly what the singleton row
  is for.
- **Storing when the suspension began** („seit 14:10 unterbrochen"). The public question is „when does it
  continue", not „how long already", and the answer to the second gets more uncomfortable every minute
  without saying more.
- **Adding a warning colour to the palette**, or using neon. See rule 8. A permanent palette word for a
  feature visible perhaps two hours a year, and red asserts alarm where the subject is weather.
- **A dismiss button.** Per-visitor dismissal state is `localStorage`, i.e. a whole second concept for a
  notice that should not be dismissible in the first place.
- **The banner on the public draw**, and **hedging the Bracket cell's time**. See rule 4. A banner over a
  tableau explains nothing; a hedge without its banner is noise.
- **„wegen Regen" in the copy** (rule 2), **„ab 14:30"** (ADR-0071's reason, inverted), and **„Wir bitten um
  Verständnis"** — filler that lengthens the line without saying anything.
- **The switch beside „Anmeldung schließen" / „Veröffentlichen".** See rule 8.

## Consequences

- **`/api/phase` is now a live wire.** This is the real cost of the decision and the reason it is an ADR at
  all. Every future addition to that response is now polled every 15 seconds by every open schedule page, and
  anyone who assumes „read once on mount" from the existing comments will be wrong for `/spielplan`. The
  other consumers keep their single read and are unaffected.
- **A competition cancellation now propagates mid-session too**, on `/spielplan` — a free side effect of the
  promotion, and a small improvement: today a cancellation reaches an open page only on reload.
- **The Published time's hedge gains a second source.** Until now it was purely structural — a chain
  abutment, computed from the reservations (ADR-0071). It is now `structural OR suspended`, so
  `shared/match-view`'s time projection takes the suspension as an input. „Published time" was already a
  public-only concept after ADR-0077; it is now also a **stateful** one.
- **This is the first notice/banner component in the codebase.** `src/components/` has cards, headers,
  explainers and lists — nothing that speaks to the visitor about the site itself. The next one has to look
  like this one. It is **square**, like everything else: ADR-0076 rule 1 names „bands, or notices" outright,
  and the front door's existing full-bleed clay band is the shape it inherits.
- **Two public wires moved into the projection while building.** `/api/phase`'s payload is now
  `projections.phaseSignal()` and the participant list's cancellation filter is `publicParticipants()` —
  both were assembled inline in the route. The rule they now follow is the one this decision leaned on
  anyway: building a public wire is a projection, and a route's job is to serve one. The immediate trigger
  was the 300-line cap on `worker/app.ts`, which is a lint rule doing what it is for rather than a reason of
  its own.
- **Clay acquires a meaning.** It was a decorative surface tone (`--color-surface-warm`); it now says
  „unplayable" in one place. That is a small claim on the palette, and it should not be spent twice.
- **The write endpoint must live under `/api/admin/*`.** Not a choice — a route outside it is born public
  (CONTEXT: Admin), which is why the token-only `/export` route was removed rather than kept.
- **The resume time is an instant, which is how the timezone stops being a problem.** Workers run UTC and the
  event is UTC+2 in August, so a stored „14:30" would need a timezone to mean anything and a second one to be
  compared against. Storing epoch milliseconds instead makes the decay rule a plain `<=` and confines
  Europe/Berlin to `formatResumeTime`, where the value is _said_ rather than reasoned about. It deliberately
  does **not** go through the schedule's `slotTime`: that helper answers „what clock time is grid slot N",
  which is the reservation vocabulary this decision already refused to reuse.
- **There is no way to say „today is over".** Named in the rejections above as an accepted gap, and repeated
  here so it is not discovered as a bug during a wet Saturday.

## Amendment 1 (2026-08-22): the band is pinned and it condenses — rule 8's „not sticky" was asserted, never argued

The ask came back the same day the feature shipped, and it is a bug report rather than a wish: the band is
only visible at the top of the page. On the front door it sits above a `min-h-dvh` hero, so it is gone after
one flick; on `/spielplan` a spectator scrolled into Sunday has no statement above them at all. **A
suspension is true for as long as it stands, so it has to be readable wherever the reader is** — a notice
that is only visible at scroll 0 tells the one person the feature exists for nothing, which is the same
failure mode rule 5 already refused when it promoted `/api/phase` to a live wire.

Rule 8 says „not sticky and not dismissible". Reading it again: **only the dismissible half was ever
argued.** The reason given — dismissal state is per visitor, i.e. `localStorage`, a whole second concept —
defends non-dismissibility and says nothing about pinning. So this amendment is not overturning a reasoned
trade-off; it is filling a hole. **Not dismissible still stands, unamended.**

1. **The band is pinned, on both surfaces.** The front door is where it was noticed and `/spielplan` is
   where it matters more — that is the page somebody leaves open for forty minutes, and the page whose every
   „ca." (rule 4) the band explains. One component, one rule.

2. **It pins _below_ the page's own header, never above it.** The header is site chrome and the band is
   content about the event; a clay band over the wordmark and the „Zurück"-link reads as a takeover. The
   alternative — the band at `top: 0` with the header beneath it — would also make the header's offset
   conditional on a live state.

3. **The statement is pinned, not the whole band: it condenses.** Full on arrival (headline, lines, and on
   the front door its link), one line thereafter. At full height a pinned band is a third of a phone viewport
   for as long as the rain lasts, which is how a notice becomes an obstruction. The posture is the event
   header's own — full, then condensed past a sentinel — so it is an existing vocabulary rather than a new
   behaviour.

4. **The front door's condensed bar keeps its link and gives up the time.** The front door **points**; the
   time it drops is one tap away on the page it points at. The schedule keeps the time and drops
   „Alle geplanten Startzeiten verschieben sich.", which the reader has already read on the way past.

5. **The condensed line is authored in the projection, like every other public string** (rule 1 is
   untouched): `SuspensionNotice` gains a finished `condensed`. It is deliberately **not** sliced out of
   `lines` by the renderer, because no position holds the right half — on the front door `lines` is empty
   whenever no resume time is known, and on the schedule the only line left after the time decays is the one
   the condensed form does not keep. It is never uppercased: it carries a clock time, and a shouted time
   reads as an error.

6. **The live region announces once.** The condensed copy is `aria-hidden` and permanently in the DOM: a
   second readable copy would double the announcement, and toggling `display` inside a live region
   re-announces a state that has not changed. A screen reader hears the full notice when the suspension is
   declared; **scroll position never speaks.**

7. **The layout shift when the band appears is accepted, not compensated.** It arrives on a 15s poll, so a
   reader parked mid-board gets ~40px inserted above them. Adjusting `scrollTop` to hide that would be
   invisible machinery fighting the browser's own anchoring — and the jolt is the moment the reader _should_
   look up. It happens perhaps twice a tournament, in each direction.

8. **While the band stands, `/spielplan`'s day heading stands down.** That page caps itself at two pinned
   layers on purpose — the court heading is already excluded because „three pinned layers on a phone is most
   of the viewport" — and the pinned band would be the third. So the day heading drops to `position: static`
   while a suspension is up, on a root class the band's renderer toggles. „When does play continue" outranks
   „which day am I looking at" for exactly the period the band is up, and the heading stays perfectly legible
   in flow on the way past. **Nothing stacks below the band**, which is why this is a state a page reacts to
   and not an offset anyone has to add up.

9. **Two heights are now stated constants, and one of them was measured.** The band reads its own pinned
   offset per surface: `--site-header-legal-h` on the schedule, and a new `--site-header-event-stuck-h` on
   the front door, declared beside it and for the same reason. Only the event header's **condensed** height
   gets a number, which is not a gap — the tall state exists at scroll 0 only, where the band is still in
   flow and needs no offset. The number is **55px**, measured in a browser rather than derived: the CSS
   arithmetic said 52 and would have shipped a 3px gap with the page showing through it.

10. **The condense trigger is a 1px sibling in flow, and the JS reads the offset back out of the CSS.** Two
    mistakes are recorded here because both were made and only a browser caught them. A sentinel **inside**
    the band is carried along by the very `position: sticky` it exists to detect and never leaves the
    viewport — the band pins and stays full-size forever. And the observer's root must be shrunk from the top
    by the band's pinned offset, or the sentinel exits a whole header-height too late. That offset is read
    from the band's own computed style rather than restated in JS, so the constant lives in exactly one place.

### Considered and rejected

- **Putting the statement into the header instead of pinning the band.** The header is already pinned on both
  pages, so this needs no second sticky layer and no offset — genuinely the smaller layout change. It loses
  because it makes a chrome shared with `/impressum`, `/datenschutz` and `/abmelden` carry a tournament-only
  state, and it would shorten the copy a second time in a component that authors none of it.
- **A `--pinned-top` sum published for whatever stacks below the band.** The obvious design, and rule 8's
  own answer made it unnecessary: the one thing that used to stack below is exactly what steps aside (rule 8
  above). A state is not an offset.
- **Compensating the scroll position** when the band appears or lifts. See rule 7.
- **Deriving the condensed line from `lines`** in the renderer, with no new string. See rule 5 — the cheapest
  option, and it keeps the wrong half.
- **A sentinel inside the band**, and **a CSS-only „am I stuck"**. See rule 10; the second does not exist
  reliably, and a scroll-driven rule would have to be told the pinned offset a second time.
- **Animating the condense**, matching the event header's `padding 0.3s`. That header only changes its
  padding; this changes _which sentence is shown_, and a cross-faded text swap reads as a glitch. A hard swap
  needs no `prefers-reduced-motion` escape either, which is its own small argument.
- **A dismiss button**, again. Rule 8's argued half stands: a pinned notice is more tempting to dismiss, and
  the reason not to has not changed.

### Consequences

- **The event header's condensed height is now load-bearing.** `--site-header-event-stuck-h` joins
  `--site-header-legal-h` as a number a change to `.is-stuck` has to update, and the file says so in both
  places. If that row ever grows a taller item than its CTA, the front door's band gains a gap.
- **`/spielplan` has two pinned layers in both states, and they are different layers.** Playing: bar + day
  heading. Suspended: bar + band. That is a deliberate swap, not a coincidence, and it is the reason the
  count never reaches three.
- **The band now emits two root elements**, the sentinel and the `aside`. A page mounting it inside a flex
  container inherits an `order: -2` sentinel it does not have to know about — the band still asks nothing of
  the page that carries it.
- **`SuspensionNotice` has three fields, and a fourth surface would need three strings.** The projection is
  still the only place German is written, which is what rule 1 is for.

## Amendment 2 (2026-08-22): the suspension names its courts — partial resumption, and rule 3 is what survives because of it

The organiser's case: it rains, everything stops, and then **court 3 is playable while court 4 still has
puddles**. The shipped suspension is all-or-nothing, so the only moves are to lift it entirely (and lie about
court 4) or hold it (and lie about court 3). This is the one thing the rejection list above never considered —
every alternative it weighed was about the _form_ of an event-wide statement, never about its _extent_.

The ask arrived as „a `suspended` state per match, and a bulk lever that fans out over all running matches".
That is the wrong object, and taking it literally would have reopened **rule 3**. The cause in the organiser's
own example is a property of a **court** — puddles are on court 4, not on Brettschneider vs. Kraatz — and once
the state is per-court, rule 3 needs no reopening at all: no match row changes, and the bulk-versus-individual
levers the ask described fall out of set membership rather than out of a fan-out write.

1. **The suspension carries the set of stopped courts.** The suspended arm of `playSuspension` gains
   `courts: number[]`, non-empty, validated against `COURT_NUMBERS`. **All six is a total suspension** — this
   event _is_ six courts, so „every court is stopped" and „the event is stopped" are one fact, and the copy
   derives the difference rather than storing it. The empty set is not a state: `resolveSuspension` degrades it
   to `NOT_SUSPENDED`, the same fail-closed normalisation it already applies to a resume time on a lifted
   suspension. Storage follows `cancelled_competitions` exactly — JSON text on the singleton row, defaulting to
   `[]`, unparseable degrading to empty.

2. **One resume time for the whole suspension, never one per court.** „Court 3 at 14:30, court 4 not before
   15:15" is expressible only with per-court times, and it costs more than it says: rule 7's decay stops being
   one refuted claim and becomes six, the band can carry one sentence anyway, and each extra time is another
   write that gets forgotten in the rain. The operator who knows court 4 needs another 45 minutes says so by
   **releasing court 3 now** and leaving court 4 stopped.

3. **The shell switch is unchanged and still means „alles unterbrechen".** Rule 8's „one tap from anywhere" is
   about the common case — it rains on the whole club — and that path must not get slower to buy a rarer one.
   Releasing a single court is a **second** control, present only while a suspension stands: six court chips in
   the shell's suspension popover, tap to release, tap to stop again. The muscle memory of the fast path is
   preserved for the one person who uses it under stress.

4. **The band stands for a partial suspension and names the stopped courts**, and rule 4's hedge narrows to
   match. A partial suspension that said nothing at the top of the page would leave every „ca." below it
   unexplained, which is the precise failure rule 4 exists to prevent — so the band is not conditional on
   totality. But the hedge is: while courts 1–3 are playing normally, hedging _their_ times asserts something
   false. So rule 4's „every not-yet-started Published time hedges" becomes **„every not-yet-started Published
   time on a stopped court hedges"**, and for a total suspension that is the same sentence it always was.

5. **Rule 3 stands, untouched, and this is the amendment's whole point.** A match on a stopped court **is**
   `running`; it is neither unplayed nor finished, and its Zwischenstand belongs to it. Nothing here writes a
   match row. Two smaller rules follow from the same posture:
   - **The Live board's presence rule is untouched** (#347): a stopped court with no match on it gets no cell.
     The board still shows only courts with a running match, and such a cell is now _marked_ as stopped rather
     than reading as live play. The band already names the empty ones.
   - **Starting a match on a stopped court is hinted, never blocked, and never auto-releases the court.** It may
     simply mean the court dried and the operator has not said so yet — neither impossible nor obviously unwise
     (ADR-0033). The „Läuft" button carries a soft inline „Platz 4 ist als unterbrochen markiert", which puts
     the contradiction in front of the only person who can resolve it. Auto-releasing on a start is the
     tempting version and it fails exactly the way rule 7 rejects auto-lifting: it would announce, positively
     and silently, that play has resumed there.

### Considered and rejected

- **A fourth `MatchStatus` value, `suspended`, with the shell switch fanning out over every running match.**
  The ask as it was literally phrased, and the design this amendment replaced after two rounds of working it
  through. It reopens rule 3 (a waiting match stops being `running`, and its Zwischenstand's home becomes
  ambiguous); it puts a fourth value into a closed enum consumed by the public wire, the bracket, the Live
  board and the admin; it needs a fan-out write and therefore a story about the write that half-failed; and
  it re-earns the rejection already recorded above — „the band above the board already says it once, for all
  of them". It also cannot express a **not-yet-started** match on an unplayable court, because a match that
  never began is not interrupted. The court-set model expresses that one for free.
- **A per-match suspension _in addition_ to the court set**, for „this match is stopped but its court is
  fine" — an injury while court 4 is dry. Named because it is the one case the court model genuinely cannot
  say. It buys a second, rarer vocabulary for a state the desk can already communicate by leaving the match
  `running` and nobody starting the next one, and it would put two independent sources on one question.
- **`courts: number[] | null`, with `null` for „the whole event"**, distinct from all six being listed. Two
  encodings of one state, forever, for a distinction this event does not have.
- **Collapsing the boolean — the suspension _is_ the set, empty means play is happening.** Tidier on paper and
  it throws away the discriminated union's one purpose: `suspended: false` beside a stale court list becomes
  representable again, which is exactly what the union was written to prevent.
- **Requiring a court selection on the shell switch.** See rule 3. It taxes the common case to serve the rare
  one and slows down the tap that happens in the rain.
- **Showing stopped courts with no match on the Live board.** See rule 5. Six „frei" cells was already the
  argument against the strip existing when nothing runs; „frei, aber unbespielbar" is the same screenful.

### Consequences

- **The hedge's input stops being a boolean.** After the original decision it was `structural OR suspended`;
  it is now `structural OR (suspended AND this match's court is stopped)`, so `shared/match-view`'s time
  projection needs the match's court, not just the suspension. That is a wider signature on the one projection
  every public time goes through.
- **`COURT_NUMBERS.length` becomes load-bearing for public copy.** „Total" is now derived from the set's size,
  so a seventh court would silently turn every historical total suspension into a partial one. The event's
  court count was already a constant; it is now a constant the German depends on.
- **The band's copy gains an enumeration**, authored in the projection like every other public string (rule 1,
  untouched): „Spielbetrieb auf Platz 4 und 5 unterbrochen" beside the existing total form. A list inside a
  sentence is the first public string in this codebase whose length varies with data.
- **The admin gains a second suspension control**, and it is the first control in the shell that is not a
  single switch. The popover exists only while a suspension stands, so the shell's resting state is unchanged.
- **„Today is over" is still unsayable**, and partial resumption does not change that. Repeated from the
  original consequences because a court set looks like it might help and does not.
