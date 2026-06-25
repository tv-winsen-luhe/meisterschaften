# Domain Glossary — Winsener Meisterschaften

The shared vocabulary for this project. Use these terms exactly in code, issues, and UI copy.
When a concept here drifts or a new one appears, update this file rather than inventing a synonym.

## Event

- **Meisterschaften** — the joint club championship of TV Winsen/Luhe and TSV Winsen, held on one
  weekend (22./23.08.2026). Vereinsintern: members only, no LK rating effect.
- **Phase** — the event moves through four phases, and the site presents itself differently in each.
  The phase is a single operator-controlled value stored in D1 and toggled in the admin (not derived
  from dates); every public surface keys off it. _(See ADR-0006.)_
  1. **Anmeldung** — registration is open; members sign up, the participant list fills.
  2. **Auslosung** — registration is closed; the draw is made and seedings fixed.
  3. **Live** — the tournament weekend; matches are played and results come in.
  4. **Post-Event** — the tournament is over; final results and champions stand. Results (names, club,
     Konkurrenz, scores, brackets) are archived as a lasting public record; contact data (email,
     phone, IP) is purged in an explicit operator-initiated step, per the privacy policy. _(See
     ADR-0007.)_
- **Setzungs-Freeze** — advancing into Auslosung snapshots each player's seeding LK so the weekly
  nuLiga sync can never shift an already-drawn bracket. Advancing into Post-Event likewise freezes
  brackets and the Spielplan (read-only).

## Participants & fields

- **Konkurrenz** (code: `competition`) — a single field a member registers for (Damen, Herren,
  Herren Challenger, Damen Freizeit). Identified by a `slug`.
- **Hauptfeld** — an open championship field where the Winsener Meister/Meisterin title is decided
  (Damen, Herren).
- **Challenger / Freizeit** — a protected field for recreational/returning players, capped by LK
  (e.g. Herren Challenger is LK 20 and weaker, or no LK = counts as LK 25).
- **Anmeldung / Registration** (D1 table `registrations`) — one member's entry into one Konkurrenz.
  Status flow: `new` → `confirmed` → `cancelled` / `hidden`. **A member may hold only one active entry**
  (matched by name / email / player_id) — one Konkurrenz per person, enforced at registration. This is
  a load-bearing invariant: it guarantees no person is ever in two matches at once, which is what keeps
  the Spielplan validator free of cross-field player clashes (ADR-0005).
- **LK (Leistungsklasse)** — a player's nuLiga rating, synced weekly from nuLiga and used only for
  **Setzung** (seeding). Players without an LK default to `defaultLk`.
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
  feeders finish, forbids more matches per slot than the 6 courts, and warns on back-to-back matches
  for one player. _(See ADR-0005.)_
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
- **Admin** — the operator surface (`/admin`, `/api/admin/*`, plus the new draw/schedule endpoints)
  used to manage registrations and, going forward, the draw and results. One operator (the tournament
  desk) entering results from a phone during the Live phase — no per-court access. Gated at the edge by
  **Cloudflare Access** (Zero Trust free plan, email-OTP login); the public API and cron stay outside
  Access. The whole admin is a single **React app** (`client:only`, mounted in an Astro route),
  replacing the legacy worker-HTML page — scheduling grid (`dnd-kit`), Auslosungs-Show (`motion`),
  results entry, phase control, export, purge all live here. React is the only client framework and is
  confined to this gated area; the public site stays zero-JS-by-default. The legacy `ADMIN_TOKEN`
  survives only as a local-`wrangler dev` fallback. _(See ADR-0008.)_
- **PUBLIC_LIST_ENABLED** — kill-switch flag for the public participant list.
- **Live-data delivery** — the public site is static Astro (zero client JS by default), but a live
  component opts into a small inline `<script>` that fetches `/api/…` client-side (as
  `participant-list.astro` and `tournament-draw.astro` already do). The live bracket, Spielplan, and
  Live-Board follow this same pattern — no SSR of dynamic pages, no rebuild-to-publish. Updates arrive
  by **polling** on a timer (Live-Board ~10–20s; Auslosungs-Show ~1–2s while running) — no SSE,
  WebSockets, or Durable Objects. _(See ADR-0008.)_
