# ADR-0007: Post-Event retention — archive results, purge contact data

- Status: accepted
- Date: 2026-06-25

## Context

The published privacy policy (`datenschutz`) commits that registration data is stored only to prepare
and run the event and is deleted after the tournament and its evaluation; it lists the publicly shown
fields as only first name, last name, club, competition; and it carries a separate Vereinschronik /
Vereinsarchiv legitimate-interest basis for archiving participation. Post-event retention therefore
has to honor that text, not invent a new policy.

## Decision

At post-event:

- **Archive the results** — final main and consolation brackets, scores, and champions
  (names, club, competition) persist as a lasting public 2026 record, projected as the post-event view
  (champions highlighted, final brackets browsable). Legal basis: the Vereinschronik legitimate
  interest.
- **Purge the contact data** — email, phone, and IP are deleted after the tournament and its
  evaluation, exactly as §Speicherdauer promises.
- The purge is an **explicit, operator-initiated final step** of post-event (a deliberate, logged
  act), not a silent cron job.

## Consequences

- The D1 row keeps identity + result fields after purge; the contact columns are nulled/deleted.
- The Post-Event view reads the same bracket/result records as Live — no separate archive store.
- **To reconcile (flagged):** §Speicherdauer currently reads as "Anmeldedaten … gelöscht," which
  reads as deleting everything. The wording must be made explicit that _names + results_ are retained
  under the Vereinschronik basis while the _contact fields_ are deleted — otherwise the policy text
  and this decision contradict each other. This is a content/legal to-do before go-live.
