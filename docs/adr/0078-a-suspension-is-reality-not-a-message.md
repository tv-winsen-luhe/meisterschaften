# ADR-0078: A suspension is reality, not a message

- Status: accepted
- Date: 2026-08-22
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
  like this one.
- **Clay acquires a meaning.** It was a decorative surface tone (`--color-surface-warm`); it now says
  „unplayable" in one place. That is a small claim on the palette, and it should not be spent twice.
- **The write endpoint must live under `/api/admin/*`.** Not a choice — a route outside it is born public
  (CONTEXT: Admin), which is why the token-only `/export` route was removed rather than kept.
- **The resume time crosses a timezone.** Workers run UTC and the event is UTC+2 in August; the time must go
  through the same helper the schedule's `slotTime` uses, not through a fresh conversion.
- **There is no way to say „today is over".** Named in the rejections above as an accepted gap, and repeated
  here so it is not discovered as a bug during a wet Saturday.
