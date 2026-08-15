import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'

// The public site's phase projection (ADR-0042). One read of GET /api/phase on load — the phase
// changes ~twice in the event's life, so there is no poll timer — projecting the statically
// rendered signup page onto the current phase. Three moves, all the same attribute toggle against
// the single `display: none` rule in global.css:
//
//   1. reveal   — [data-phase-gate] comes off what shipped hidden for signup („Der Draw" and its
//                 nav link on the front door, the „Anmeldung geschlossen" panel on /abmelden).
//   2. hide     — every signup affordance gets [data-phase-gate] put ON it. Selected generically
//                 via [data-signup-open] (the attribute that already wires every trigger to the
//                 signup modal) plus [data-signup-lead] for the signup-only blocks, so the swap set
//                 cannot go stale when a new button is added.
//   3. swap in  — [data-phase-lead] comes off the elements matching the current phase only (the
//                 hero lead and header CTA variants; pages without them just no-op).
//
// Order matters: the reveal must read the gates that shipped in the markup before step 2 adds more.
const project = (phase: string) => {
  document.querySelectorAll('[data-phase-gate]').forEach(el => el.removeAttribute('data-phase-gate'))
  document
    .querySelectorAll('[data-signup-open], [data-signup-lead]')
    .forEach(el => el.setAttribute('data-phase-gate', ''))
  document.querySelectorAll(`[data-phase-lead="${phase}"]`).forEach(el => el.removeAttribute('data-phase-lead'))
}

// Best-effort: any failure leaves the statically rendered signup page standing. The affordances it
// then leaves visible are harmless, because register and cancel enforce the closed window
// server-side (ADR-0059) — only the optics mislead, nothing breaks.
export const projectPhaseOnLoad = async () => {
  try {
    const res = await hc<AppType>(location.origin).api.phase.$get()
    if (!res.ok) return
    const { phase } = await res.json()
    if (phase !== 'signup') project(phase)
  } catch {
    // Network error: leave the signup default standing.
  }
}
