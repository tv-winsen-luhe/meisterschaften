import type { AdminRegistration } from '../../../shared'

// Auto-advance for the Anmeldungen triage (ADR-0019): after the operator acts on a row, open the
// next one so the "Neu" queue can be worked without re-clicking. A pure function over the queue as
// it stood at the moment of the action (already filtered + sorted) — the surface owns the queue,
// this owns only the "which id next" rule, so it is tested in isolation like the other predicates.
//
// The rule: the entry following the acted-on row, or the previous one if the last was acted on, or
// null if there was no other entry (or the id is absent — a defensive no-op).
export const nextSelection = (queue: readonly AdminRegistration[], actedId: number): number | null => {
  const i = queue.findIndex(r => r.id === actedId)
  if (i === -1) return null
  const next = queue[i + 1] ?? queue[i - 1] ?? null
  return next ? next.id : null
}
