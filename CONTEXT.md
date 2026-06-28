# Domain Glossary — Winsener Meisterschaften

The shared vocabulary for this project. Entries are keyed by the **English** term used in code; the
German the club actually speaks is given as a `(de: …)` alias — this glossary is the one bridge from
that German to the code (ADR-0028). Use these terms exactly in code, issues, and UI copy. When a
concept here drifts or a new one appears, update this file rather than inventing a synonym.

## Event

- **Championships** (de: Meisterschaften) — the joint club championship of TV Winsen/Luhe and TSV
  Winsen, held on one weekend (22./23.08.2026). Members only, no LK rating effect.
- **Phase** — the event moves through **three** operator-set phases, kept to the two transitions that
  are genuine global decisions; the site presents itself differently in each. The phase is a single
  value stored in D1 and toggled in the admin (not derived from dates); every public surface keys off
  it. The granular middle — _which_ competition is drawn / running — is **not** the phase; it is
  per-competition state (see Competition lifecycle), and the public presentation inside `tournament`
  is **derived** from it. _(See ADR-0006, revised by ADR-0027.)_
  1. **Signup** (phase value `signup`, UI: „Anmeldung") — registration is open; members sign up, the
     participant list fills. **Naming:** the one German word _Anmeldung_ maps to **two** English
     identifiers, on purpose, because they name two different things: `signup` is this **phase** (the
     activity / the open time-window), while `registration` (the row, `registrations` table, the
     Registration domain) is the **record** a member creates. Phase ≠ aggregate — the split is
     deliberate, not a synonym slip; keep `signup` for the phase and `registration` for the entry.
  2. **Tournament** (phase value `tournament`, UI: „Turnier") — registration is closed (the freeze
     fires, the cron stops); the draws and the weekend happen here. What the public sees is **derived**
     per competition, not a manual flip: draw-pending (nothing drawn yet) → draw reveal show (a reveal
     cursor is live) → bracket → live board (matches running). Entering this phase is the single global
     act of **closing registration**; the per-competition draws are separate actions within it.
  3. **Post-Event** (phase value `post-event`) — the tournament is over; final results and champions
     stand. Results (names, club, competition, scores, brackets) are archived as a lasting public
     record; contact data (email, phone, IP) is purged in an explicit operator-initiated step, per the
     privacy policy. _(See ADR-0007.)_
- **Competition lifecycle** (de: Konkurrenz-Lebenszyklus) — each competition carries its own draw
  lifecycle, independent of the global phase and of the other competitions: _not drawn → drawn (main
  bracket exists) → running → done_, plus a transient "reveal in progress" while its draw reveal show
  cursor is advancing. This is the per-bracket "already drawn?" state; it lives in the admin
  **„Konkurrenzen" section**, where the operator triggers **„Jetzt auslosen"** (draw now) per field.
  That action is a per-competition action, never a phase transition. While a field's reveal is in
  progress the admin **withholds its bracket** (showing „Auslosung läuft" + the _x/y enthüllt_ progress);
  the bracket appears only once the draw reveal show has fully revealed it — so projecting the admin can
  never spoil the draw, consistent with the unriggable-draw stance. _(See ADR-0027, ADR-0025, ADR-0002.)_
- **Seeding freeze** (de: Setzungs-Freeze) — before the draw, LKs keep updating and the **provisional
  seeding list** (de: provisorische Setzliste; the seeding preview) reflects them live. At the draw it
  snapshots each player's current LK into its immutable draw record (ADR-0003) — that snapshot _is_ the
  frozen seeding, and the LK that decides Challenger eligibility (ADR-0024). The weekly nuLiga cron is
  phase-gated to run only during signup, so it is a no-op afterward (no suppression flag). Advancing
  into Post-Event likewise freezes brackets and the schedule (read-only). _(See ADR-0010.)_
- **seedingLk** — a pure module that answers "what is this player's current nuLiga LK?" — `lookup(player)`
  matches a player against a roster behind a `RosterSource` port (nuLiga HTTP+parse adapter in prod,
  in-memory fake in tests) and returns `{ playerId, lk } | null`. It never touches D1; persistence is
  the Store's job, composed by thin orchestration (`matchOnRegister` at signup, `resolveLkOnConfirm`
  at confirm, `syncAll` on cron/admin). It holds no freeze logic. _(See ADR-0010.)_
- **seedingValue** — a pure helper (`seedingValue(lk)` in `shared/`) that turns a registration's LK
  string into the number it is seeded by: the LK parsed, with **no resolvable rating ⇒ `defaultLk`
  (25.0)** — so a missing or unratable LK seeds as the weakest, never the strongest. Not to be confused
  with **seedingLk** above: `seedingLk` _looks up_ a player's rating from nuLiga; `seedingValue` _orders_
  by an LK already on the row. It owns the "string LK → sort number" rule once, so the participant list
  and the future seeding share it rather than re-encoding it per surface. (LK stays stored as a string;
  this is the conversion at the sort boundary — ADR-0021.)

## Participants & fields

- **Competition** (de: Konkurrenz; code: `competition`) — a single field a member registers for.
  Identified by a `slug`. Three are registerable today (`COMPETITION_SLUGS`): Damen (`womens`), Herren
  (`mens`), Herren Challenger (`mens-challenger`). Damen Freizeit is planned but not yet a registerable
  competition.
- **Championship field** (de: Hauptfeld) — an open championship field where the Winsener
  Meister/Meisterin title is decided (Damen, Herren).
- **Challenger / recreational field** (de: Freizeit) — a protected field for recreational/returning
  players, capped by LK (e.g. Herren Challenger is LK 20 and weaker, or no LK = counts as LK 25). The
  cap **binds at the draw**, on the frozen LK — that is the only LK that counts (Seeding freeze). During
  signup the LK is still provisional, so confirming a too-strong entry raises a **hint, not a block**;
  the operator may confirm it. If the field's composition shifts before the draw, the lever is the
  global **`CHALLENGER_MIN_LK`** threshold, adjusted for the whole field — never a per-player override.
  At the draw the operator confirms/adjusts that threshold (default = the `shared/` constant) and the
  chosen value is **snapshotted into the draw record** (audited as part of the freeze) — there is no
  standing DB preference. One pure predicate `challengerEligibility(entries, threshold)` in `shared/` is
  both the draw's hard guard (a too-strong entry blocks the field's draw) and the provisional seeding
  list's affordance — authority in the draw, affordance in the client, definition once (ADR-0011).
  _(See ADR-0024.)_
- **Registration** (de: Anmeldung; D1 table `registrations`) — one member's entry into one competition.
  Status flow: `new` → `confirmed` → `cancelled`. **`cancelled`** is the single "no longer participating,
  keep the record" state, reached either by the member's self-service withdrawal (`/api/cancel`, by person)
  or by the operator marking a drop-out (`/api/admin/cancel`, by id) — the row does not record which.
  Reviving a `cancelled` entry is the member's act alone: re-registering revives the row (`revive`); the
  admin cannot un-cancel, only hard-delete. (`hidden` was retired — it overlapped `cancelled`; see
  ADR-0018.) **A member may hold only one active entry**
  (matched by name / email / player_id) — one competition per person, enforced at registration. This is
  a load-bearing invariant: it guarantees no person is ever in two matches at once, which is what keeps
  the schedule validator free of cross-field player clashes (ADR-0005).
- **Active entry** — a registration still participating: status `new` or `confirmed` (i.e. not yet
  `cancelled`). Defined positively over exactly those two states — the set, not the absence of
  `cancelled` — so adding a future status leaves an entry inactive until it is explicitly classed active.
  The "one active entry per member" invariant above is the rule over this set.
- **Registration domain** — the module that owns the registration lifecycle: the transitions
  (`register`, `revive`, `confirm`, self-service `cancel` (by person), operator `cancel` (by id), admin
  `setPlayerId`/`setLk`) each return a typed Result; the Store and `seedingLk` are injected; it persists through the Store, never raw SQL. The
  domain returns its typed **Result** (the persisted/affected rows) and never awaits nuLiga or Telegram;
  the **transport edge owns the side-effect orchestration** — the nuLiga LK match + Telegram
  notification — as named functions in `worker/registration-effects.ts`, run via `ctx.waitUntil`.
  Invariants like `canConfirm(reg)` live
  as pure predicates in `shared/`: the domain enforces them, the React admin reuses them for affordance
  (authority in the domain, affordance in the client, definition in one place). _(See ADR-0011.)_
- **LK** (de: Leistungsklasse) — a player's nuLiga rating, synced weekly from nuLiga and used only for
  **seeding**. The scale runs **1.0 (strongest) to 25.0 (weakest)**, so ordering ascending by
  LK puts the strongest first. It is **never entered by hand**: a player's LK is whatever nuLiga has for
  their linked `player_id`, and any player with no resolvable rating — no linked ID, or an ID nuLiga has
  no rating for (unrated / not yet rated) — defaults to `defaultLk` (25.0), i.e. treated as the weakest.
- **Seeding basis** — the minimal input that makes a Registration confirmable and seedable. The LK
  itself is **derived, not supplied** (see LK): the only seeding input the operator gives is whether the
  entry is **linked to a nuLiga `player_id`** or **explicitly has none** (UI: „keine nuLiga-ID"). From
  that, the LK follows — the linked player's nuLiga rating, or `defaultLk` (25.0) when there is no ID or
  no rating. `canConfirm` (in `shared/`) judges whether that choice has been made (an ID is linked, or
  no-ID is explicitly set); `resolveSeedingBasis` (beside it) derives the basis fields from that input.
  There is deliberately no operator LK override. _(See ADR-0011, ADR-0020.)_
- **Seeding** (de: Setzung) — ordering players in the draw by LK so the strongest are kept apart early.
  Follows the DTB Turnierordnung 2026 (Stand 09.11.2025), §§ 30–32:
  - **Number of seeds** by draw size (§30.5a): 8 → 2, 16 → 4, 24/32 → 8, 48/64/128 → 16 — plus our
    extension **4 → 2** (§30.5a's table starts at 8; a 4-field reuses the 8-field's 2-seed pattern, a
    deliberate sub-DTB extension — ADR-0034). Our fields draw at **4, 8, or 16**.
  - **Placement** (§30.5b table): Nr. 1 on the first line, Nr. 2 on the last line (4-field: lines 1 and
    4, both fixed, no lot). **Nr. 3 and 4 are drawn by lot onto two fixed lines** (16-field: lines 5 and 12) — the lines are prescribed, the lot only decides which of the two seeds lands on which. Larger fields draw the further seed groups
    (Nr. 5–8, 9–12, 13–16) by lot onto their prescribed lines the same way — so seed placement itself
    contributes lot steps to the show.
  - **Byes** (de: Freilose / „Rasten", §31): given in round 1 whenever the entry count is not a power of
    two; assigned **to the seeds first, in seeding-list order** (highest seed first). Any **remaining
    byes are drawn by lot, spread evenly across the sections** (halves/quarters/eighths) of the draw
    plan — this is the case once there are more byes than seeds (e.g. 9 entrants in a 16-draw → 7 byes,
    4 to seeds, 3 by lot). _(Exact line indices and bye order are implemented against the official DTB
    Turnierordnung 2026 — the authoritative text, not an approximation.)_
- **Draw size** — the next power of two ≥ number of confirmed players; the gap to that size is filled
  with byes. A field needs **≥4 confirmed to be drawn** at all: 4 is the smallest field that forms a real
  knockout (a 2–3 field would round to a 4-draw with a bye semifinal, so the club plays those off another
  way, not via this KO engine — ADR-0034). The smallest cast is therefore a **full 4-draw** (no byes; byes
  first appear from size 8 up); the largest is **16**. Distinct from a competition's **capacity** (the
  „Plätze frei" maximum on the participant list, `tournament.ts`): the bracket size follows the
  **confirmed field**, never the cap — so 7 confirmed in a 16-capacity field is an **8**-draw. The public
  draw preview sizes its bracket from the confirmed count clamped to the supported sizes (4/8/16), not
  from capacity. Below the draw floor (fewer than 4 confirmed) it shows no bracket at all but a **„ab 4"
  notice** („N / 4 — noch X bis zur Auslosung"), and the participant board drops its seed markers — so no
  public surface implies a castable field where the gate would refuse one. _(See ADR-0034.)_

## Tournament structure

- **Draw** (de: Auslosung) — assigning seeded and unseeded players into bracket positions, producing
  the bracket for each competition. Automatic and unriggable (DTB-Ranglistenturnier conventions), with
  no operator edit step. _(See ADR-0002.)_
- **Lot step** (de: Los) — a placement step **where the lot decided**: a seed _gezogen_ onto one of its
  two prescribed lines (Nr. 3/4+; DTB §30.5b calls each pairing a „Ziehung"), a remaining bye _eingelost_
  onto a section (§31.2b), or an unseeded player _eingelost_ into the next open slot (§32.4c). The
  deterministic placements (Nr. 1 / Nr. 2 onto their fixed table lines, byes that go straight to seeds)
  are reveal steps too, but they are **not** lot steps — nothing was drawn (§30.5b fixes Nr. 1/2 by table;
  §31.2 _assigns_ the seed byes in seeding-list order). The word „Los" therefore names a **drawn** step
  only: the show reveals the deterministic placements in sequence but never announces one as a Los, and
  its pacing language stays event-level („Auslosung"), not a per-step „Los". The draw proceeds step by
  step so the random steps can be revealed dramatically, one at a time.
- **Reveal sequence** — the draw's playback artifact: one flat, ordered list of **reveal steps** in
  DTB §32.4 order (seeds, then byes, then unseeded top-to-bottom). Each step places one entrant (or a
  bye) onto one position and carries a `kind` — `seed-fixed` | `seed-lot` | `bye` | `draw`. The
  same sequence, fully applied, _is_ the bracket (the source of the `matches` slots); the show is pure
  playback over it. _(See ADR-0003, ADR-0025.)_
- **Draw reveal show** (de: Auslosungs-Show; operator UI label: „Auslosung") — the **operator-paced**
  beamer projection in the **gated admin** that plays the reveal sequence back on a large screen during
  the live draw event. It is **not** a public self-serve URL: the operator drives it (projecting onto
  the hall screen) and it opens straight from **„Jetzt auslosen"**. The draw is precomputed atomically;
  the show is pure playback advancing a **reveal cursor** (an index into the reveal sequence — how many
  steps have been shown), and it moves **forward only** — a revealed lot is already public, so there is
  no stepping back (the public live bracket mirrors the cursor; a back-step would un-reveal a lot there
  too). Once it has fully revealed (cursor === total) it is done, not a replayable show. The off-site
  audience follows a separate **public live bracket** (`tournament-draw.astro`) that mirrors the same
  revealed prefix by polling (~1–2s). _(See ADR-0003, ADR-0025, ADR-0031; issue #71.)_
- **Main bracket** (de: Hauptrunde; bracket value `main`) — the main KO bracket; the title is decided
  here. The German name is the concept; the stored/wire `bracket` discriminator value is the English
  `main` (CLAUDE.md — German terms never become stored values). _(See ADR-0025.)_
- **Consolation bracket** (de: Nebenrunde / Trostrunde; bracket value `consolation`) — a second KO
  bracket for the main bracket's first-round losers (plus players who took a bye in round 1 and then
  lost in round 2). Round-2+ losers are out. Guarantees every entrant at least two matches. It is a full
  DTB draw in its own right — seeded by LK, with its own byes, drawn randomly — but **not** revealed lot
  step by lot step: it is drawn after the main bracket first round and published directly, with no draw
  reveal show. Its entrants are exactly the players who **lost their first match** — the round-1 losers,
  plus bye-seeds who then lose their round-2 match (the same set, cleanly stated; round-2+ losers who had
  already won a match are out). It is a **batch draw, not a per-slot feed**, and is **operator-triggered**
  via a per-competition **„Nebenrunde auslosen"** action that mirrors „Jetzt auslosen" — enabled only once
  every first match is decided (disabled with the reason shown until then), never auto-fired.
  **A consolation bracket exists only when the main bracket first round lies _before_ the
  semifinals — i.e. draw size ≥ 8.** At draw size 4 (exactly four entrants) the first round _is_ the
  semifinal, so its two losers are the same two players the third-place match already pairs — there is no
  separate consolation bracket, the third-place match _is_ the consolation and every entrant still gets
  two matches. Below four there is neither. _(See ADR-0004.)_
- **Third-place match** (de: Spiel um Platz 3) — a placement match between the two main-bracket
  semifinal losers, played once a semifinal exists (from four entrants up). It is **materialized at draw
  time** (a structurally-known slot) with two **loser-feeders** from the semifinals, filled by Advancement
  when they resolve. The main bracket has one; the consolation bracket does not. It is a real match —
  scheduled and recorded like any other — and
  counts toward the court load (ADR-0023). At exactly four entrants it doubles as the consolation (see
  Consolation bracket): the two semifinal losers have no separate consolation bracket, so this match is
  their guaranteed second match.
- **Draw procedure** — the single reusable operation behind both brackets: given a set of players with
  seeding LK, produce a seeded DTB bracket with byes. A **pure module in `shared/`** (beside the
  existing draw math in `shared/draw.ts`): `drawBracket({ players, size, random }) → { seeding, slots,
reveal sequence }`. Randomness enters through an injected **`RandomSource`** port (a crypto adapter
  in prod, a deterministic fake in tests — the ADR-0010 port pattern). The selection is **unbiased**
  (rejection sampling, not `value % n`) — fairness is a product feature here, not a detail (ADR-0002).
  The main bracket runs it once up front with a live reveal; the consolation bracket runs it after round
  1 with no reveal. _(See ADR-0004, ADR-0025.)_
- **Match** — a single tie between two players; best of 2 sets, Match-Tie-Break to 10 at 1:1. A match
  exists as a bracket position from the moment of the draw; until results arrive it names its feeders
  ("winner M3 vs winner M4"). Default planned length: **90 minutes**.
- **Match result** (de: Match-Ergebnis) — full set scores (e.g. `6:3, 4:6, [10:7]`) plus the winner,
  captured by the operator during the live phase. Entry defaults to a quick straight-sets path and
  expands as needed. Beyond a normal completed score, a match can resolve as a special outcome:
  - **Bye** (de: Freilos) — auto-resolves at draw time; winner advances, no score, never scheduled.
  - **Walkover (w.o.)** — opponent didn't appear; winner advances, no score.
  - **Retirement** (de: Aufgabe) — a player retires mid-match; partial score may be recorded.
    Every advancement — byes included — is represented as a match result, so the bracket stays uniform.
- **Advancement** — how a result propagates through the bracket. Resolving a match writes its
  `winnerRegId` and sends the winner into the **parent** match's open slot (fixed by the child's position
  parity) — that is how "winner M3 vs winner M4" fills in. Semifinals also route their **loser** down a
  **loser-feeder** into the Third-place match. **Correcting** a result distinguishes two cases: editing
  the **score** while the winner is unchanged just rewrites the score (nothing downstream depends on it);
  editing the **winner** re-fills the parent slot, and if a downstream match already consumed the old
  winner it **warns and cascade-clears** those dependent results recursively — the correction is never
  blocked, but the bracket is never left holding a player who lost. _(See ADR-0026.)_
- **Schedule** (de: Spielplan) — the assignment of matches to a court (de: Platz) and a **planned start**
  (day + approximate time) after the draw, the way nuTurnier does it. Planned times are
  explicitly approximate ("ca."), not guarantees. The operator places matches by hand on a courts×time
  grid of **fixed 90-minute slots**; the system validates rather than auto-generates, on the principle
  **block the impossible, warn the unwise**: it _forbids_ (hard) scheduling a match before its feeders
  finish and more matches per slot than the 6 courts — the only physically impossible states — and
  _warns_ (soft, operator may override) on a player's load: more than **2 matches per day** (so a deep
  run, or a main-bracket exit plus the consolation bracket, tends to spread across both event days — the
  consolation bracket is not a Saturday-only affair) and back-to-back matches with no rest gap.
  _(See ADR-0005, ADR-0033.)_
- **Court** (de: Platz) — one of 6 sand courts. Capacity constraint for the schedule: at most **one match
  per court per time slot** (the validator enforces this per-cell occupancy server-side, ADR-0033); with 6
  courts, "at most 6 matches in a slot" follows as its consequence, never a separate count.
- **Match status** (de: Match-Status; stored/wire values English `planned` → `running` → `done`, UI
  labels „geplant" → „läuft" → „beendet" per ADR-0028). The transition to `running` captures the
  **actual court** the match is on — which may differ from its planned court (a court frees up early), so
  the planned court/slot stay as the published plan while the live court reflects reality. The operator
  updates the status; the public live view reflects it in near-real-time so off-site followers can track
  what is on court now. The status transition is itself the **live signal**: set scores may be saved
  opportunistically per completed set, but there is **no game- or point-level live scoring** — the single
  desk has no courtside data source. _(See ADR-0032.)_
- **Live board** (de: Live-Board) — the public weekend view: a schedule (who plays when/where) and a
  live board (what is on court right now), both derived from the same match records. The public always
  shows the **current truth, never the stale plan**: a match's court is the **actual** live court once it
  is running (falling back to the planned court only before it starts), so a spectator is never sent to
  the wrong court. Published planned **times** stay static ("ca."); their drift is communicated through
  Match status (läuft/beendet), not by continuously rescheduling — but the **court** always reflects
  reality. It is **one event-wide page** across all competitions (a competition filter, not per-field
  pages), led by a „jetzt auf dem Platz" courts board; the per-competition brackets stay separate
  surfaces that fill with the same results. _(See ADR-0008, ADR-0032.)_

## System

- **Source of truth** — the site (Astro + Cloudflare Worker + D1) owns the tournament data end to
  end: registrations, the draw, and live results all live in D1. No external tournament tool.
  _(See ADR-0001.)_
- **Type-safe chain** — an unbroken type chain from DB to client: **Drizzle** (typed D1 schema + row
  types + `drizzle-kit` migrations) → **Store module** → **Zod** schemas in `shared/` (the validated
  API contract + inferred types) → **Hono** + `@hono/zod-validator` on the worker → **Hono `hc`** typed
  client on the public components and the React admin. tRPC was considered and rejected. _(See ADR-0009.)_
- **Store module** — a deep data-access module per aggregate (registrations, and the coming
  draw/match/schedule/phase tables). Drizzle lives inside it; its interface speaks domain operations
  (`listConfirmed`, `confirm`, `revive`, `setLk`, …), never raw SQL or Drizzle calls in handlers.
- **`shared/`** — the module both the worker and the client import (it crosses the separate
  `worker/tsconfig.json` boundary): the Zod API contract, inferred types, the typed `competition` slug,
  and shared constants (`CHALLENGER_MIN_LK`, `DEFAULT_LK`).
- **Admin** — the operator surface (`/admin`, `/api/admin/*`, plus the new draw/schedule endpoints)
  used to manage registrations and, going forward, the draw and results. One operator (the tournament
  desk) entering results from a phone during the live phase — no per-court access. Gated **only** at the
  edge by **Cloudflare Access** (Zero Trust free plan, email-OTP login) — there is deliberately no
  app-level auth in the worker. Two things make that safe, and both are load-bearing: the `workers.dev`
  route is disabled (`workers_dev = false`) so the worker has no un-gated hostname bypassing Access, and
  **every operator endpoint must live under `/api/admin/*`** (the Access destination) — a route outside
  it is born public (this is why the token-only `/export` route was removed, not kept). The public API
  and cron stay outside Access. Local `wrangler dev` has no Access and no token: the admin is simply open
  on localhost. The whole admin is a single **React app** (`client:only`, mounted in an Astro route),
  replacing the legacy worker-HTML page — scheduling grid (`dnd-kit`), draw reveal show (`motion`),
  results entry, phase control, purge all live here. React is the only client framework and is
  confined to this gated area; the public site stays zero-JS-by-default. _(See ADR-0008.)_
- **PUBLIC_LIST_ENABLED** — kill-switch flag for the public participant list.
- **Live-data delivery** — the public site is static Astro (zero client JS by default), but a live
  component opts into a small inline `<script>` that fetches `/api/…` client-side (as
  `participant-list.astro` and `tournament-draw.astro` already do). The live bracket, schedule, and
  live board follow this same pattern — no SSR of dynamic pages, no rebuild-to-publish. Updates arrive
  by **polling** on a timer (live board ~10–20s; the public live bracket ~1–2s while a draw reveals) — no
  SSE, WebSockets, or Durable Objects. _(See ADR-0008.)_
