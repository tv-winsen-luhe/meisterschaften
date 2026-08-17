import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import { frontDoorLead, matchesLead, type FrontDoor } from './front-door-lead'
import { resolveSocialMixerBlock, type SocialMixerPlacement } from '../../shared'
import { socialMixerWhen } from '../data/tournament'

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
//   5. cancel   — [data-competition="<slug>"] marks every element that belongs to exactly one field
//                 (a card, a participant group). One that is not among the fields the page shows is
//                 gated, and the derived FAQ line is filled in and revealed (ADR-0062).
//
// Order matters: the reveal must read the gates that shipped in the markup before step 2 adds more.
const project = ({ leads, order, competitions, cancellationNote }: FrontDoor) => {
  document.querySelectorAll('[data-phase-gate]').forEach(el => el.removeAttribute('data-phase-gate'))
  document
    .querySelectorAll('[data-signup-open], [data-signup-lead]')
    .forEach(el => el.setAttribute('data-phase-gate', ''))
  document.querySelectorAll('[data-phase-lead]').forEach(el => {
    if (matchesLead(el.getAttribute('data-phase-lead'), leads)) el.removeAttribute('data-phase-lead')
    else el.setAttribute('data-phase-gate', '')
  })
  if (order === 'results') document.body.classList.add('is-results-order')

  document.querySelectorAll('[data-competition]').forEach(el => {
    const slug = el.getAttribute('data-competition')
    if (!competitions.some(shown => shown === slug)) el.setAttribute('data-phase-gate', '')
  })
  // A container that held nothing but competitions goes with the last of them: an empty „Damen"
  // heading over an empty grid would claim there is more than there is. This is the filter rule, not
  // a special case for a lost side — if both Damen fields are cancelled the page simply reads as the
  // Herren-only event it then is (ADR-0062 consequences).
  document.querySelectorAll('[data-competition-group]').forEach(el => {
    if (!el.querySelector('[data-competition]:not([data-phase-gate])')) el.setAttribute('data-phase-gate', '')
  })
  // The one line a cancellation leaves behind (see `cancellationNote`). It ships hidden and empty, so
  // a page whose phase read never resolves says nothing rather than something stale.
  const note = document.querySelector<HTMLElement>('[data-cancellation-note]')
  const line = note?.querySelector('[data-cancellation-line]')
  if (note && line && cancellationNote !== null) {
    line.textContent = cancellationNote
    note.hidden = false
  }
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

// Rewrite the Social mixer's appointment wherever it is rendered, from the operator's stored placement
// (ADR-0064). The statically built line already names the default placement, so this only ever changes
// something once the block has actually been moved. Any confirmed count resolves the same sentence — only
// the block's *courts* follow the head-count, and no public line names them.
export const applyMixerAppointment = (placement: SocialMixerPlacement) => {
  const block = resolveSocialMixerBlock({ ...placement, confirmed: 0 })
  if (!block) return
  const line = socialMixerWhen(block)
  for (const el of document.querySelectorAll<HTMLElement>('[data-mixer-when]')) el.textContent = line
}

// Best-effort: any failure leaves the statically rendered signup page standing. The affordances it
// then leaves visible are harmless, because register and cancel enforce the closed window
// server-side (ADR-0059) — only the optics mislead, nothing breaks.
export const projectPhaseOnLoad = async ({ frontDoor = false }: Options = {}) => {
  const client = hc<AppType>(location.origin)
  try {
    const res = await client.api.phase.$get()
    if (!res.ok) return
    const { phase, cancelledCompetitions, socialMixerPlacement } = await res.json()
    // The mixer's appointment first, and **before** the signup early-return: the block is never gated by a
    // phase or by the schedule publish flag (ADR-0063 §3), it is simply where the operator has put it
    // (ADR-0064). Every surface that renders the line carries `data-mixer-when`; a surface without one is
    // simply not patched.
    applyMixerAppointment(socialMixerPlacement)
    // The cancelled set rides on the same read (ADR-0062), so `signup` still costs one call. It only
    // takes effect from `tournament` on: during signup the „ab 4" notice is the recruiting call the
    // cancellation replaces, and a field is not cancelled before its window has even closed.
    if (phase === 'signup') return
    const bits =
      frontDoor && phase === 'tournament' ? await readStageFlags(client) : { drawn: false, schedulePublished: false }
    project(frontDoorLead({ phase, ...bits, cancelled: cancelledCompetitions }))
  } catch {
    // Network error: leave the signup default standing.
  }
}
