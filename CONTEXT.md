# Domain Glossary — Winsener Meisterschaften

The shared vocabulary for this project. Use these terms exactly in code, issues, and UI copy.
When a concept here drifts or a new one appears, update this file rather than inventing a synonym.

## Event

- **Meisterschaften** — the joint club championship of TV Winsen/Luhe and TSV Winsen, held on one
  weekend (22./23.08.2026). Vereinsintern: members only, no LK rating effect.
- **Phase** — the event moves through four phases, and the site presents itself differently in each.
  The phase is a single operator-controlled value stored in D1 and toggled in the admin (not derived
  from dates); every public surface keys off it. _(See ADR-0006.)_
  1. **Anmeldung** (phase value `signup`) — registration is open; members sign up, the participant
     list fills. **Naming:** the one German word _Anmeldung_ maps to **two** English identifiers, on
     purpose, because they name two different things: `signup` is this **phase** (the activity / the
     open time-window), while `registration` (the row, `registrations` table, the Registration domain)
     is the **record** a member creates. Phase ≠ aggregate — the split is deliberate, not a synonym
     slip; keep `signup` for the phase and `registration` for the entry.
  2. **Auslosung** — registration is closed; the draw is made and seedings fixed.
  3. **Live** — the tournament weekend; matches are played and results come in.
  4. **Post-Event** — the tournament is over; final results and champions stand. Results (names, club,
     Konkurrenz, scores, brackets) are archived as a lasting public record; contact data (email,
     phone, IP) is purged in an explicit operator-initiated step, per the privacy policy. _(See
     ADR-0007.)_
- **Setzungs-Freeze** — before the draw, LKs keep updating and the **provisorische Setzliste**
  (seeding preview) reflects them live. At Auslosung the draw snapshots each player's current LK into
  its immutable draw record (ADR-0003) — that snapshot _is_ the frozen seeding. The weekly nuLiga cron
  is phase-gated to run only during Anmeldung, so it is a no-op afterward (no suppression flag).
  Advancing into Post-Event likewise freezes brackets and the Spielplan (read-only). _(See ADR-0010.)_
- **seedingLk** — a pure module that answers "what is this player's current nuLiga LK?" — `lookup(player)`
  matches a player against a roster behind a `RosterSource` port (nuLiga HTTP+parse adapter in prod,
  in-memory fake in tests) and returns `{ playerId, lk } | null`. It never touches D1; persistence is
  the Store's job, composed by thin orchestration (`matchOnRegister` at signup, `resolveLkOnConfirm`
  at confirm, `syncAll` on cron/admin). It holds no freeze logic. _(See ADR-0010.)_

## Participants & fields

- **Konkurrenz** (code: `competition`) — a single field a member registers for. Identified by a
  `slug`. Three are registerable today (`COMPETITION_SLUGS`): Damen (`womens`), Herren (`mens`),
  Herren Challenger (`mens-challenger`). Damen Freizeit is planned but not yet a registerable
  Konkurrenz.
- **Hauptfeld** — an open championship field where the Winsener Meister/Meisterin title is decided
  (Damen, Herren).
- **Challenger / Freizeit** — a protected field for recreational/returning players, capped by LK
  (e.g. Herren Challenger is LK 20 and weaker, or no LK = counts as LK 25).
- **Anmeldung / Registration** (D1 table `registrations`) — one member's entry into one Konkurrenz.
  Status flow: `new` → `confirmed` → `cancelled`. **`cancelled`** is the single "no longer participating,
  keep the record" state, reached either by the member's self-service withdrawal (`/api/cancel`, by person)
  or by the operator marking a drop-out (`/api/admin/cancel`, by id) — the row does not record which.
  Reviving a `cancelled` entry is the member's act alone: re-registering revives the row (`revive`); the
  admin cannot un-cancel, only hard-delete. (`hidden` was retired — it overlapped `cancelled`; see
  ADR-0018.) **A member may hold only one active entry**
  (matched by name / email / player_id) — one Konkurrenz per person, enforced at registration. This is
  a load-bearing invariant: it guarantees no person is ever in two matches at once, which is what keeps
  the Spielplan validator free of cross-field player clashes (ADR-0005).
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
- **LK (Leistungsklasse)** — a player's nuLiga rating, synced weekly from nuLiga and used only for
  **Setzung** (seeding). It is **never entered by hand**: a player's LK is whatever nuLiga has for their
  linked `player_id`, and any player with no resolvable rating — no linked ID, or an ID nuLiga has no
  rating for (unrated / not yet rated) — defaults to `defaultLk` (25.0).
- **Seeding basis** — the minimal input that makes a Registration confirmable and seedable. The LK
  itself is **derived, not supplied** (see LK): the only seeding input the operator gives is whether the
  entry is **linked to a nuLiga `player_id`** or **explicitly has none** („keine nuLiga-ID"). From that,
  the LK follows — the linked player's nuLiga rating, or `defaultLk` (25.0) when there is no ID or no
  rating. `canConfirm` (in `shared/`) judges whether that choice has been made (an ID is linked, or
  no-ID is explicitly set); `resolveSeedingBasis` (beside it) derives the basis fields from that input.
  There is deliberately no operator LK override. _(See ADR-0011, ADR-0020.)_
- **Setzung (seeding)** — ordering players in the draw by LK so the strongest are kept apart early.
  Follows the DTB Turnierordnung 2024:
  - **Number of seeds** by draw size: 8 → 2, 16 → 4, 32 → 8, 48+ → 16.
  - **Placement**: Nr. 1 on the first line, Nr. 2 on the last line; Nr. 3 and 4 on prescribed lines,
    all further seeds distributed **by lot** (Losverfahren) — so even seed placement contributes Lose
    to the show.
  - **Freilose (byes)**: given in round 1 whenever the entry count is not a power of two; assigned to
    the seeds first, highest seed first. _(Exact line indices and bye order are implemented against the
    official DTB Turnierordnung 2024 — the authoritative text, not an approximation.)_
- **Draw size** — the next power of two ≥ number of confirmed players; the gap to that size is filled
  with Freilose.

## Tournament structure

- **Auslosung (the draw)** — assigning seeded and unseeded players into bracket positions, producing
  the bracket for each Konkurrenz. Automatic and unriggable (DTB-Ranglistenturnier conventions), with
  no operator edit step. _(See ADR-0002.)_
- **Los** — a single draw step: one unseeded player being placed into one open bracket slot. The
  Auslosung proceeds Los für Los so it can be revealed dramatically, one placement at a time.
- **Auslosungs-Show** — the public presentation mode that plays the draw back Los für Los on a large
  screen (TV/beamer) during the live draw event. The draw is precomputed atomically; the show is pure
  playback advancing a **reveal cursor** (how many Lose have been shown). _(See ADR-0003.)_
- **Hauptrunde** — the main KO bracket; the title is decided here.
- **Nebenrunde** — a Trostrunde: a second KO bracket for the Hauptrunde's first-round losers (plus
  players who took a Freilos in round 1 and then lost in round 2). Round-2+ losers are out. Guarantees
  every entrant at least two matches. It is a full DTB draw in its own right — seeded by LK, with its
  own Freilose, drawn randomly — but **not** revealed Los für Los: it is drawn after the Hauptrunde
  first round and published directly, with no Auslosungs-Show. _(See ADR-0004.)_
- **Draw procedure** — the single reusable operation behind both brackets: given a set of players with
  seeding LK, produce a seeded DTB bracket with Freilose. The Hauptrunde runs it once up front with a
  live reveal; the Nebenrunde runs it after round 1 with no reveal.
- **Match** — a single tie between two players; best of 2 sets, Match-Tie-Break to 10 at 1:1. A match
  exists as a bracket position from the moment of the draw; until results arrive it names its feeders
  ("Sieger M3 vs Sieger M4"). Default planned length: **90 minutes**.
- **Match-Ergebnis (result)** — full set scores (e.g. `6:3, 4:6, [10:7]`) plus the winner, captured by
  the operator during Live. Entry defaults to a quick straight-sets path and expands as needed. Beyond
  a normal completed score, a match can resolve as a special outcome:
  - **Freilos (bye)** — auto-resolves at draw time; winner advances, no score, never scheduled.
  - **Walkover (w.o.)** — opponent didn't appear; winner advances, no score.
  - **Aufgabe (retirement)** — a player retires mid-match; partial score may be recorded.
    Every advancement — byes included — is represented as a match result, so the bracket stays uniform.
- **Spielplan (schedule)** — the assignment of matches to a **Platz** (court) and a **planned start**
  (day + approximate time) after the Auslosung, the way nuTurnier does it. Planned times are
  explicitly approximate ("ca."), not guarantees. The operator places matches by hand on a courts×time
  grid; the system validates rather than auto-generates — it forbids scheduling a match before its
  feeders finish, forbids more matches per slot than the 6 courts, caps each player at **2 matches per
  day** (so a deep run, or a Hauptrunde exit plus the Nebenrunde, necessarily spreads across both event
  days — the Nebenrunde is not a Saturday-only affair), and warns on back-to-back matches for one
  player. _(See ADR-0005.)_
- **Platz (court)** — one of 6 sand courts. Capacity constraint for the Spielplan: at most 6 matches
  run in the same time slot.
- **Match-Status** — `geplant` → `läuft` (on a named Platz) → `beendet`. The operator updates it; the
  public Live view reflects it in near-real-time so off-site followers can track what is on court now.
- **Live-Board** — the public weekend view: a schedule (who plays when/where) and a live board (what
  is on court right now), both derived from the same match records. Published planned times are static
  ("ca."); drift is communicated through Match-Status, not by continuously rescheduling.

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
  `worker/tsconfig.json` boundary): the Zod API contract, inferred types, the typed `Konkurrenz` slug,
  and shared constants (`CHALLENGER_MIN_LK`, `DEFAULT_LK`).
- **Admin** — the operator surface (`/admin`, `/api/admin/*`, plus the new draw/schedule endpoints)
  used to manage registrations and, going forward, the draw and results. One operator (the tournament
  desk) entering results from a phone during the Live phase — no per-court access. Gated **only** at the
  edge by **Cloudflare Access** (Zero Trust free plan, email-OTP login) — there is deliberately no
  app-level auth in the worker. Two things make that safe, and both are load-bearing: the `workers.dev`
  route is disabled (`workers_dev = false`) so the worker has no un-gated hostname bypassing Access, and
  **every operator endpoint must live under `/api/admin/*`** (the Access destination) — a route outside
  it is born public (this is why the token-only `/export` route was removed, not kept). The public API
  and cron stay outside Access. Local `wrangler dev` has no Access and no token: the admin is simply open
  on localhost. The whole admin is a single **React app** (`client:only`, mounted in an Astro route),
  replacing the legacy worker-HTML page — scheduling grid (`dnd-kit`), Auslosungs-Show (`motion`),
  results entry, phase control, purge all live here. React is the only client framework and is
  confined to this gated area; the public site stays zero-JS-by-default. _(See ADR-0008.)_
- **PUBLIC_LIST_ENABLED** — kill-switch flag for the public participant list.
- **Live-data delivery** — the public site is static Astro (zero client JS by default), but a live
  component opts into a small inline `<script>` that fetches `/api/…` client-side (as
  `participant-list.astro` and `tournament-draw.astro` already do). The live bracket, Spielplan, and
  Live-Board follow this same pattern — no SSR of dynamic pages, no rebuild-to-publish. Updates arrive
  by **polling** on a timer (Live-Board ~10–20s; Auslosungs-Show ~1–2s while running) — no SSE,
  WebSockets, or Durable Objects. _(See ADR-0008.)_
