import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import { frontDoorLead, matchesLead, type FrontDoor } from './front-door-lead'

type Client = ReturnType<typeof hc<AppType>>

// The public site's phase projection (ADR-0042, extended by ADR-0060). One read of GET /api/phase
// on load — the phase changes ~twice in the event's life, so there is no poll timer — projecting
// the statically rendered signup page onto the current presentation. Four moves, the first three
// the same attribute toggle against the single `display: none` rule in global.css:
//
//   1. reveal   — [data-phase-gate] comes off what shipped hidden for signup („Der Draw" and its
//                 nav link on the front door, the „Anmeldung geschlossen" panel on /abmelden).
//   2. hide     — every signup affordance gets [data-phase-gate] put ON it. Selected generically
//                 via [data-signup-open] (the attribute that already wires every trigger to the
//                 signup modal) plus [data-signup-lead] for the signup-only blocks, so the swap set
//                 cannot go stale when a new button is added.
//   3. swap     — [data-phase-lead] carries a whitespace-separated list of leads (ADR-0060
//                 amendment §3). The attribute comes off the elements opting into an active lead;
//                 every other one is gated. The gating matters for the lists containing `signup`:
//                 those ship *visible* (the static page is the signup page) and must be taken away
//                 rather than revealed.
//   4. reorder  — from `tournament` onward the page and its nav present their sections in the
//                 results order, via one class on <body> (ADR-0060 §5).
//
// Order matters: the reveal must read the gates that shipped in the markup before step 2 adds more.
const project = ({ leads, order }: FrontDoor) => {
  document.querySelectorAll('[data-phase-gate]').forEach(el => el.removeAttribute('data-phase-gate'))
  document
    .querySelectorAll('[data-signup-open], [data-signup-lead]')
    .forEach(el => el.setAttribute('data-phase-gate', ''))
  document.querySelectorAll('[data-phase-lead]').forEach(el => {
    if (matchesLead(el.getAttribute('data-phase-lead'), leads)) el.removeAttribute('data-phase-lead')
    else el.setAttribute('data-phase-gate', '')
  })
  if (order === 'results') document.body.classList.add('is-results-order')
}

// The two extra reads behind the three `tournament` stages (ADR-0060 §1). Both are existing public
// contracts, both are read once on load beside the phase, and both degrade to `false` — which is
// stage 1, the lead that points at „Das Feld". Understating what exists is safe; overstating it
// sends visitors to a page that says „noch nicht veröffentlicht".
const readStageFlags = async (client: Client) => {
  const drawn = client.api.draw
    .$get()
    .then(async res => (res.ok ? (await res.json()).brackets.length > 0 : false))
    .catch(() => false)
  const schedulePublished = client.api.schedule
    .$get()
    .then(async res => (res.ok ? (await res.json()).published : false))
    .catch(() => false)
  return { drawn: await drawn, schedulePublished: await schedulePublished }
}

interface Options {
  // The homepage is the only surface with staged leads and a section order, so it is the only one
  // that pays for the two extra reads. /abmelden needs the plain phase swap and nothing else.
  frontDoor?: boolean
}

// Best-effort: any failure leaves the statically rendered signup page standing. The affordances it
// then leaves visible are harmless, because register and cancel enforce the closed window
// server-side (ADR-0059) — only the optics mislead, nothing breaks.
export const projectPhaseOnLoad = async ({ frontDoor = false }: Options = {}) => {
  const client = hc<AppType>(location.origin)
  try {
    const res = await client.api.phase.$get()
    if (!res.ok) return
    const { phase } = await res.json()
    if (phase === 'signup') return
    const bits =
      frontDoor && phase === 'tournament' ? await readStageFlags(client) : { drawn: false, schedulePublished: false }
    project(frontDoorLead({ phase, ...bits }))
  } catch {
    // Network error: leave the signup default standing.
  }
}
