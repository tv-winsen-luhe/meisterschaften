# ADR-0041: The schedule has a publish gate and a reset

- Status: accepted
- Date: 2026-06-29
- Refines: ADR-0005 (the public schedule), ADR-0032 (live truth is the match status)
- Sits under: ADR-0006 / ADR-0027 (operator-controlled global state; derive the middle, keep the ends explicit)

## Context

Until now the schedule had no draft/published distinction: the instant the operator placed a match, its
`court/day/slot` were live on the public `spielplan.astro` page. That conflates two states the operator
needs to keep apart — **a half-built plan** (most matches still in the backlog) and **a finished plan** —
and there was no way to wipe placements and start over short of `undraw`, which destroys the draw itself.

Two distinct worries hide in "should it be gated?":

1. **Before the plan is ready**, a partial schedule shown publicly is misleading.
2. **After it is published**, the event is live and matches do get nudged — and the question is whether
   that churn is acceptable or should be re-gated.

This adds **global operator state**, so it sits under ADR-0006/0027. ADR-0027's rule is "derive the
derivable middle, keep only genuine non-derivable global acts" — it deleted the hand-timed `draw → live`
flip precisely because that boundary had a crisp derived trigger (the per-competition reveal cursor). The
test for any new manual flag is therefore: is "the schedule is ready to show" a genuine operator judgment,
or a derivable state we'd be re-introducing a forgettable flag for?

## Decision

**Add a global `schedule_published` flag, off by default — and it is a legitimate manual axis, not a
derivable middle.** Unlike `draw → live`, schedule-readiness has **no clean derived trigger**: "backlog
empty" is the obvious candidate and it is wrong, because the operator may deliberately leave matches unplaced
(undecided feeders, or a staged "publish round 1 now, place round 2 later"). "The plan is ready" is a
judgment call, like closing registration — so it is manual. ADR-0027's "operator forgets and the public is
stuck in the wrong mode" risk is weak here: forgetting to publish leaves a loud, self-evident
"noch nicht veröffentlicht" on the operator's own schedule page, not a silently-wrong public surface.

**Publishing with a non-empty backlog warns, but does not block.** The "stage round 1, place round 2 later"
case above is, in practice, rare: the operator plans the whole main bracket up front, later rounds placed
immediately as feeder slots („Sieger M{n}"). So a non-empty backlog at the moment of „Veröffentlichen" is
almost always a **forgotten placement**, not a deliberate one — and the publish action therefore **confirms**
when matches are still unplaced („N Matches sind noch nicht geplant — trotzdem veröffentlichen?"), catching
the omission the operator would otherwise only notice once the public page was already live. It stays a
**warn, not a hard block** (ADR-0033, "block the impossible, warn the unwise"): we trust the single operator,
and a hard gate could trap a genuinely-unplaceable match (e.g. one that no longer fits the court budget) into
a schedule that can never be published. The consolation bracket is not a counterexample — it is drawn live
after round 1 and placed as ordinary post-publish live edits, so it is never in the backlog at first publish.

Until the operator hits **„Veröffentlichen"**, the public schedule shows a "noch nicht veröffentlicht"
state; the whole build happens in private. Scope is **global** (one flag for the event — ADR-0008's
event-wide page), not per-competition: at a club event the draws happen together at the Auslosungs-Show, so
the operator builds and publishes in one sitting.

**The gate is on the _planned_ reveal, never on live truth.** `schedule_published` suppresses the
forward-looking plan (a not-yet-started match's planned `court/day/slot`). It does **not** gate the live
board — the „jetzt auf dem Platz" courts board and a `running`/`done` match's _actual_ court + status are
current truth (ADR-0032) and are served regardless of the flag. Today's `/spielplan` carries no live board
yet (that is issue #91), so unpublished simply yields an empty "noch nicht veröffentlicht" page; but the
constraint is load-bearing for #91 — the gate is built as a _plan_ gate, not a blanket feed kill, so the
live board is never blanked out from under a running match.

**After publishing, edits stay live — there is no re-publish step.** For a single operator, with planned
times already framed "ca." and the **actual live court** shown once a match starts (ADR-0032), drift is
communicated honestly through match status, not by silently reshuffling. Re-publishing every tweak would be
pure friction. The gate's value is the _clean first reveal_, not ongoing change control. Filling backlog via
„Vorschlag" or nudging a placement after publishing are ordinary **live edits** — they do not touch the flag.

**Reset („Spielplan zurücksetzen") is a separate, placement-only action, and a pre-event build tool.** It
returns matches to the backlog (clears `court/day/slot`), leaving the draw, brackets, and results fully
intact. It is global, confirm-guarded, **only un-places `planned` matches** (a `running`/`done` match keeps
its court — we never erase where a match was actually played), and **flips `schedule_published` back to
false** so the public page is never blanked into a half-empty grid mid-rebuild. It pairs with the
auto-suggest as the rebuild loop: reset → Vorschlag → tweak → veröffentlichen.

The "keep `running`/`done` placements" rule is a **safety net** for the edge case where reset is pressed
after the first match has started — **not** an endorsement of mid-event re-planning. Reset's confirm dialog
**escalates its warning when any match is `running`/`done`** (naming that the public plan goes dark until
re-published) but does not hard-block — we trust the single operator, as everywhere else. In normal use the
flag is flipped true once, at the clean first reveal, and **stays true for the whole live event**; the only
lever that flips it back is Reset.

## Consequences

- A `schedule_published` boolean joins the phase/settings state (`app_state`, beside `phase`); the public
  schedule feed and page gate on it. The name is **scoped** (`schedule_published`, not bare `published`)
  because `app_state` carries other global state.
- **Reset is the only lever that unpublishes.** Auto-suggest only fills the backlog and never re-plans a
  placed match (issue #136), so "re-suggest over a published plan" cannot churn the public view — there is
  no such auto-unpublish path. There is also **no manual „unpublish"** button: published too early is just
  another reason to Reset (which the operator wants anyway, to rebuild).
- The gate is implemented at the projection layer (fail-closed, like the reveal cursor): unpublished, the
  feed returns `published: false` with **no** matches (no leak); the page renders the "noch nicht
  veröffentlicht" state.
- This is deliberately _not_ a per-change approval workflow — that would fight the "ca. + live status"
  model ADR-0032 already settled.
