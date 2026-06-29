# ADR-0043: Capped fields select by LK; the cut binds at the draw freeze

- Status: accepted
- Date: 2026-06-29

## Context

A competition's field is capped twice over: **structurally** at the largest supported draw size (16 —
the seed table supports only 4/8/16, and a larger field would also blow the shared **court budget**), and
**softly** per field by `capacity` in `tournament.ts`. Until now `capacity` was a display-only number, and
a field of 17+ confirmed simply **blocked** the draw (`drawBlocker` → `unsupported-size`) with no guidance
on whom to drop. Oversubscription is real: the organizer is collecting interest live, and a **stronger
player can register after the field already looks full**. The field must then be selected by a principled
rule — and which rule fits **depends on the field**: a championship field by strength (LK), a protected
recreational field by who registered first.

## Decision

When a competition's confirmed field exceeds its capacity, the surplus become **reserves**; the
**selection criterion depends on the field type** (`isChallengerField`, definition-once):

- A **championship field** (Herren, Damen) takes the **top-N by LK**, and the cut **binds at the draw
  freeze** on the frozen LK. During signup it is only a **provisional preview** — the provisional seeding
  list with a cut line at capacity — that drifts as LKs sync, because LK is provisional until the freeze
  (ADR-0024, ADR-0010). A late, stronger entry slots in by LK.
- A **Challenger / recreational field** takes the **first N by registration order** (`createdAt`):
  strength must not decide a protected field, so the cut is plain first-come-first-served. The ordering
  key never drifts, so a spot is **secure once taken** — no bumping, unlike the championship.

Either field still **seeds the drawn N by LK** in the bracket — the cut decides _who is in_, the seeding
decides _where_. Confirmed entries below the line stay `confirmed` as **reserves (Nachrücker)** — no new
status, no auto-cancel — and the top reserve steps in if a drawn player drops before the draw locks.

`capacity` stays a **soft, code-level planning constant**: no admin editor, no DB config, no signup block.
The operator plans against the shared **court budget** through the overview cockpit (projected match load,
per-field current state, the cut line) and reacts by adjusting the constants in `tournament.ts`.

The draw-time enforcement (accept >N confirmed, cut to the top-N, surface the reserves) is **designed now
but built only when a field actually approaches its cap** — today's fields sit far below 16.

## Considered Options

- **Live cut during signup** — a confirmed entry drops below the line the moment a stronger one registers.
  Rejected: it acts on _provisional_ LKs and churns "you're in / you're out", contradicting the freeze model.
- **FIFO waitlist** — confirm in registration order, overflow waits by time. Rejected: a late, stronger
  player would be stuck behind weaker early registrants; a championship field must be ordered by strength.
- **New `waitlisted` status, or auto-`cancelled` below the line** — rejected: reserves reuse `confirmed`
  (status stays minimal, ADR-0018), and auto-cancelling someone who was confirmed is socially wrong.
- **Admin-editable capacity (DB-backed config)** — rejected for now: a soft number changed a handful of
  times over one event does not justify a config surface (ADR-0021, ADR-0023); it stays a code constant.

## Consequences

- The cockpit ranks **active** entries (new + confirmed) by their already-derived LK and draws the cut
  line at `capacity`; `new` rows carry an LK because `matchOnRegister` name-matches them at signup and
  `syncAll` refreshes them weekly — so the reserve list is sortable without confirming anyone first.
- The protected-Challenger cut question is **resolved** by the field-type split above: a Challenger field
  cuts by **registration order**, not LK — sidestepping the "weakest vs strongest-allowed" ambiguity
  entirely, because strength does not decide a recreational field.
- **Damen Freizeit** (`womens-challenger`) is not yet a registerable KO field (format undecided until
  02.07); the registration-order cut applies once it becomes one. Today the split governs the three live
  fields: **Herren / Damen by LK, Herren Challenger by registration order**.
