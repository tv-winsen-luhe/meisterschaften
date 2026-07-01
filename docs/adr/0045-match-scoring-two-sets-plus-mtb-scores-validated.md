# ADR-0045: Match scoring is two sets + a Match-Tie-Break, and scores are hard-validated

- Status: accepted
- Date: 2026-07-01
- Refines: ADR-0022 (form constraints are hints, contract stays server-side), ADR-0033 (block the
  impossible, warn the unwise), ADR-0011 (one predicate in `shared/` — authority in the domain,
  affordance in the client), ADR-0026 (draw finality — winner change cascade-clears), ADR-0034
  (a standing sub-DTB choice, recorded so it doesn't read as a mis-transcription)

## Context

DTB Turnierordnung 2026 §37.1 plays matches „auf zwei Gewinnsätze" (best of three), each set to 6 with
an ITF-rule-5b tiebreak at 6:6, and the **third set a full set** — a Match-Tie-Break-to-10 substitutes
for it only when the Oberschiedsrichter invokes it for weather/timing. The Winsener Meisterschaften —
one weekend, a ~72-slot court budget (CONTEXT: Court budget) — always plays the deciding set as that
Match-Tie-Break; it never plays a full third set. That is a legal choice under §37.1 (the MTB-for-third
substitution), taken **standing** rather than per-match.

The result-entry drawer (issue #90) modeled the score as `set1 / set2 / mtb` (the MTB row appearing only
at 1:1) but placed **zero constraints** on the numbers, and made the winner a separate **mandatory tap
never tied to the score**. Two consequences: an operator who typed a full score but forgot the Sieger hit
a Save button greyed with no explanation (the reported bug), and an `8:6` set or a `9:7` MTB saved
silently into the permanent post-event archive (ADR-0007).

## Decision

**1. Match format is fixed at two sets + a Match-Tie-Break to 10 as the third set — never a full third
set.** The results schema has no `set3` slot by design; a deciding set is always the MTB. A deliberate,
standing sub-DTB choice (§37.1's MTB substitution taken as the rule), the same posture as ADR-0034's
4-draw extension — recorded so the absent third-set field reads as intentional, not an omission.

**2. The legal score space is closed, so illegal scores are hard-blocked.** Because the format admits no
advantage sets and no super-tiebreak-as-set, the legal space is finite and unambiguous:

- **Set (games):** `6:0 … 6:4`, `7:5`, `7:6` (either player). No `6:5`, no `7:0–7:4`, nothing ≥ 8, no ties.
- **Match-Tie-Break (points):** reach **10, win by 2, open-ended** — `10:0 … 10:8`, then `11:9`, `12:10`,
  `13:11`, … No `10:9`, nothing under 10, no margin ≠ 2 above 10.

An illegal score is **impossible**, not merely unwise, so ADR-0033's "block the impossible" half applies
and we hard-block it — a deliberate departure from the softer hint-only default (ADR-0022), justified by
the closed space: there is no legal-but-weird score to false-block. Per ADR-0022 the block is
**server-side authority** — a pure predicate in `shared/` enforced by `matchResultRequestSchema` + the
handler, reused by the drawer as affordance (Save disabled, the offending row flagged): the ADR-0011
"definition in one place" pattern.

**3. For a normal result the winner is derived from the score (read-only), not tapped.** A completed
normal match's winner is a function of its (now legal) score: `2:0` in sets → that player; `1:1` → the
MTB winner. The drawer computes it and shows it read-only, so a normal result's winner can never
contradict its own score. The explicit **Sieger** choice survives only where the score cannot decide it —
**Walkover** (no score) and **Retirement / Aufgabe** (the retiree loses even when ahead). The outcome is
therefore a clean trichotomy: **Normal ⟺ a full, legal, decisive score; scoreless ⟺ Walkover; partial ⟺
Retirement.**

**4. Retirement scores are exempt from validation.** A retirement ends mid-set, so its score is
legitimately partial and free-form; the winner is explicit, and the score merely records how far the
match got.

## Consequences

- A normal result **cannot** be saved without a full, legal, decisive score — a no-score win must be
  entered as Walkover, a partial one as Retirement. This forcing function is the intent, not a limitation.
- Save is **never** silently greyed again: when a normal score is not yet decisive (a blank or tied set,
  or `1:1` with no MTB winner) or is illegal, Save is disabled **with an inline reason**.
- The winner-change cascade (ADR-0026) now measures against the **derived** winner: re-entering a done
  match's score so the other player wins triggers the same „Sieger ändern?" cascade-clear warning.
- The wire contract is unchanged (`{ id, winner, outcome, score }`); the server now additionally verifies,
  for a normal outcome, that `winner` equals the score-derived winner and every set/MTB is legal.
- No archive migration: the block is on new writes; #90 shipped with no production results yet.
