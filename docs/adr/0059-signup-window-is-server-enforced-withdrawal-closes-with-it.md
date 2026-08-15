# ADR-0059: The signup window is server-enforced, and withdrawal closes with it

- Status: accepted
- Date: 2026-08-15
- Builds on: ADR-0006/ADR-0027 (the operator-set phase), ADR-0022 (form constraints are hints, the
  contract is server-side), ADR-0042 (the phase-projected front door)
- Relates to: ADR-0043 (the field cut rides the seeding freeze), ADR-0018 (registration status),
  ADR-0026 (draw finality)

## Context

ADR-0042 turned the homepage into a phase-projected front door and, in its Consequences, accepted a
known cost: a no-JS visitor during the event window still sees the `signup` lead and its „anmelden"
buttons. It justified that cost with a claim about the backend — „the signup endpoint is server-side
phase-gated, so only the optics mislead, nothing breaks."

The claim was never true. `POST /api/register` applied a honeypot, an IP rate limit and Zod shape
validation, and never read the phase; `POST /api/cancel` did even less. Once the operator advanced to
`tournament`, the „closed" registration was closed only in the copy: a stale tab, a bookmarked page, a
bot or a plain `curl` still created rows, and self-service withdrawal still cancelled entries — including
entries already frozen into a draw snapshot.

So two questions had to be answered together. First: where does the signup window actually live? Second,
and less obvious: what is the right cut for **withdrawal**? Signup and withdrawal are not symmetric — a
member who cannot play has a real need after the deadline, and refusing them costs something.

## Decision

**1. The phase is the signup window, and the window is enforced at the write path.** Both
`POST /api/register` and `POST /api/cancel` refuse with `409` and the shared `{ error }` envelope when
the phase is not `signup`. This is the authority; everything the site does visually is optics
(ADR-0022). One `signupOnly(message)` middleware carries both, ordered after validation so field errors
and the honeypot keep their existing precedence.

**2. Withdrawal closes with signup — the cut is the phase, not „is this entry already in a draw".**
The precise-looking alternative (allow withdrawal until _that_ competition is drawn) was rejected. The
field cut rides the seeding freeze (ADR-0043), so an entry that leaves between the freeze and the draw
changes exactly the field that was frozen — the cut-off player below the line is already gone. Modeling
it per-competition would also introduce a second time concept beside the phase, for a case the organiser
handles better by hand: after the close, `/abmelden` points at the organiser's address rather than
withdrawing silently.

**3. The optics follow the same rule on both public write surfaces.** The homepage's existing phase read
additionally hides every signup affordance, and `/abmelden` swaps its form for a „schreib uns" panel. A
form that is guaranteed to fail is a worse affordance than no form — but the guards above hold whether or
not that swap ever runs. (The mechanics are ADR-0042's; its §4 revision records them.)

## Considered and rejected

- **Leave it cosmetic** — hide the buttons, no server guard. This is the state ADR-0042 already believed
  it was in. It fails for exactly the visitors ADR-0042 named as the accepted cost, and it leaves the
  admin's phase flip meaning something different to the site than to the database. Rejected.
- **Gate withdrawal on the draw instead of the phase** — technically the sharper line, and the reason it
  was seriously considered. Rejected per §2: it protects less than it appears to (the freeze, not the
  draw, is where the field is decided) and buys that with a second lifecycle concept.
- **Auto-close signup on the deadline date.** Explicitly excluded by ADR-0006: dates drive copy, never
  state. The operator flip stays the only close.
- **Refuse withdrawal in the domain rather than at the edge.** The Registration domain deliberately has
  no phase concept (ADR-0011); the phase is app state, not part of the registration aggregate. Keeping
  the guard at the edge preserves that boundary.

## Consequences

- The admin's phase flip is now a real close in both directions. A backward flip to `signup` (ADR-0006's
  escape hatch, ADR-0029's reset) reopens both endpoints for free — the guard reads the current value and
  caches nothing.
- Late withdrawals become organiser work: a mail to the Sportwart instead of a self-service form. This is
  a deliberate trade for a small field (ADR-0021), not an oversight.
- ADR-0042's Consequences are corrected by this ADR: the „server-side phase-gated" claim it relied on now
  holds, so the no-JS cost it accepted is genuinely bounded to optics.
- The client-side swap remains **untested** — the repo has no DOM test harness and this change does not
  introduce one (a second test environment for two guards would be abstraction ahead of need). The two
  server guards are covered by worker integration tests; a regression in the swap would show as a stale
  button that fails loudly on click, not as a bad write.
- Extracting the route tree's HTTP primitives to `worker/http.ts` (validation, honeypot, reset gate, and
  the new `signupOnly`) was a side effect of this change: `worker/app.ts` sat at the 300-code-line lint
  cap. The route tree itself stays the single Hono chain ADR-0037 requires.
