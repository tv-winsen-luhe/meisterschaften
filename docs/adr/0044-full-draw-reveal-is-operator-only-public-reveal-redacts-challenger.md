# ADR-0044: The full draw reveal is operator-only; the public reveal redacts Challenger strength

- Status: accepted
- Date: 2026-06-30
- Revised by: ADR-0048 (Consequence 4: per-surface hand-nulling → a single enforced strength-redaction decision on the public wire)

## Context

The Challenger is a protected field — its strength is not advertised publicly (ADR-0024, CONTEXT
„Challenger"). #155 hid LK and seed numbers on the public draw bracket **client-side**, and #164 stopped
the participant-list **wire** from carrying Challenger LK. The draw reveal has the same wire leak, but it
could not be fixed the same way.

`GET /api/draw` (the `publicDraws` projection) joins each revealed step by name **and LK** and ships
`step.seed`. It is a public route, outside Cloudflare Access. For a drawn Challenger field the protected
field's strength leaves the server on the public, Access-free wire — the public off-site bracket only hides
it client-side.

A flat redaction inside `publicDraws` is not available, because `GET /api/draw` is **shared**: the
operator's beamer draw show reads the very same endpoint (`use-reveal.ts` → `client.api.draw.$get()`,
cursor-sliced server-side) and renders `Gesetzt · Nr. {seed}` and `LK {lk}` with no protected-field guard.
Nulling the projection would project „Nr. null / LK folgt" onto the operator's projector during a live
Challenger draw — and the operator needs the LK and seed to run it (ADR-0024). Varying the
public projection by operator identity is not available either: Cloudflare Access injects identity only on
`/api/admin/*` paths, so getting it onto `/api/draw` would mean gating that route — which would kill the
public off-site bracket.

Two product questions sit behind the leak:

1. Where does the full, un-redacted reveal belong?
2. Does the public Challenger reveal also need its **structure** neutralized? Even with LK and seed nulled,
   the public reveal still signals _which players are seeded_, via `step.kind`, the seed-first reveal order,
   bracket `position`, and the names on seed-bye lines — structural signals that already exist on the public
   bracket today (#155 hid badges and LK, not the structure).

## Decision

**1. Split the reveal into a redacted public projection and a full operator projection.** The full reveal
— cursor-sliced but with LK and seed intact — moves under `/api/admin/*` (a new `GET /api/admin/draw/reveal`),
the Access destination; the operator beamer reads it there. `GET /api/draw` stays public but redacts
protected fields: for an `isChallengerField` competition the projection nulls each step's `lk` and `seed`
(names, `kind`, `position`, cursor, total, size unchanged). This is not a workaround — CONTEXT „Admin"
already requires that _every operator endpoint live under `/api/admin/_`\*; the full reveal carries
protected-field strength, so it is operator data and belongs there. The split restores that boundary, with
the public wire backing up #155's client-side hiding (defense in depth, the same posture as #164's
participant-list redaction).

**2. The public Challenger reveal keeps its seeded structure; it is not neutralized.** The Challenger field
is genuinely seeded by LK (ADR-0043) — the byes really go to the seeds (§31). A strength-neutral public
bracket would force either drawing the field unseeded (changing the sporting format for a privacy nicety,
against ADR-0043) or rendering a _fake_ neutral bracket to the public while the real seeded one plays (the
public bracket would lie about where its byes are). The structural signal is also weak and points at the
least-sensitive end: inferring it requires the DTB seeding rules and which line is the top seed, and it
reveals _relative rank_ (who is strongest in the field), never an LK value. The protection exists for
_absolute_ weakness — an LK broadcast — which redaction fully removes.

## Considered Options

- **Redact inside the shared `publicDraws`** — rejected: it projects „Nr. null / LK folgt" onto the
  operator's beamer, which needs LK + seed to run the draw (ADR-0024).
- **Vary the public projection by Access identity** — rejected: Access injects identity only on
  `/api/admin/*`; gating `/api/draw` to obtain it would kill the public off-site bracket.
- **Neutralize the public Challenger bracket structure** — rejected: it would change the format (ADR-0043)
  or make the public bracket lie about its byes, to hide a weak, relative-rank signal that points at the
  strongest (least-sensitive) players.

## Consequences

- A new `GET /api/admin/draw/reveal` returns the cursor-sliced reveal with LK + seed intact; the beamer
  (`use-reveal.ts`) reads it instead of `/api/draw`. The two projections share one builder — the public one
  is the full one mapped through a Challenger redactor (`lk`/`seed` → null), reusing the `isChallengerField`
  predicate (as #164 did in the store).
- The public wire (`GET /api/draw`) no longer carries Challenger LK or seed; #155's client-side hiding stays
  as a second layer.
- The structural signal (seed order, position, seed-bye names) remains on every public bracket, championship
  and Challenger alike — an accepted, documented non-goal, not an oversight a future review should re-open.
- The redaction is **per public surface**, not a single enforced seam: it now lives in two hand-written
  projections — `redactChallenger` here and `toConfirmedParticipant` in the registrations store (#164). With
  only two public surfaces joining a Challenger row's `lk`/`seed`, a shared boundary would be premature
  abstraction (ADR-0021). The standing rule instead: **any new public projection that joins a Challenger
  registration's `lk` or `seed` must null them**, or it re-opens this leak — the trap #166 itself was.
