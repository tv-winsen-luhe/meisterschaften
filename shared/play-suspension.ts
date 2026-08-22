import { z } from 'zod'

// Play suspension (CONTEXT: Play suspension; ADR-0078) — the event-wide statement that play is **not
// happening right now**. The first fact this site carries about the whole event as *reality* rather than as
// plan: Match status is per-match, Schedule publication is per-event but gates the *plan*, and nothing said
// „nobody is on court and every time below is wrong".
//
// It is a **typed state, not a message** (ADR-0078 rule 1): two facts and no prose. A public string typed
// from a phone in the rain would be the one unreviewed publication on a site where every public string is
// built by a projection, so the surfaces derive their finished German from here — `suspensionNotice` below
// is the only place that authors it.
//
// Pure, and with **no clock of its own**: every function takes `now`. The decay rule below is a comparison,
// not a timer, and a module that read the clock itself would be untestable at exactly the seam that matters.

/**
 * The moment play is expected to resume, as **epoch milliseconds** rather than a clock string.
 *
 * The event runs at UTC+2 in August and Workers run UTC, so a stored „14:30" would need a timezone to mean
 * anything and a second one to be compared against. An instant needs neither: the decay rule is a plain
 * `<=`, and Europe/Berlin appears exactly once, in `formatResumeTime`, where the value is *said* rather
 * than reasoned about. (ADR-0078 records this as the shape of the state; the epoch is that decision's
 * concrete form.)
 */
const resumesAtSchema = z.number().int().nullable()

/**
 * The wire form: a **discriminated union**, so „not suspended, but a resume time is set" is not
 * representable above the Store. The two columns below it are independent and a hand-edited row can put
 * them in that combination; `resolveSuspension` is where it stops.
 */
export const playSuspensionSchema = z.discriminatedUnion('suspended', [
  z.object({ suspended: z.literal(false) }),
  z.object({ suspended: z.literal(true), resumesAt: resumesAtSchema })
])
export type PlaySuspension = z.infer<typeof playSuspensionSchema>

/** Play is happening — the state a fresh database is in, and the one a lift returns to. */
export const NOT_SUSPENDED: PlaySuspension = { suspended: false }

/**
 * The state as a surface should read it, given the moment it is read at. Two normalisations, and both are
 * about a claim that no longer holds rather than about a state that changed:
 *
 * - **The time decays, the suspension does not** (ADR-0078 rule 7). At 14:40 „weiter ca. 14:30" has been
 *   refuted, so the resume time falls away and the plain suspension stands until the operator lifts it.
 *   Lifting automatically is the one option that fails *positively and silently* — it would announce that
 *   play has resumed. A stale „unterbrochen" is a visible error, loud in the admin; a false „we are
 *   playing" is not. Same instinct as the feed's per-slot degradation (ADR-0035): the claim that no longer
 *   holds falls away, the claim that holds stays.
 * - **The impossible combination is dropped**, fail-closed like the Store's other readers: a resume time on
 *   a lifted suspension is not a suspension.
 */
export const resolveSuspension = (state: PlaySuspension, now: number): PlaySuspension => {
  if (!state.suspended) return NOT_SUSPENDED
  const resumesAt = state.resumesAt !== null && state.resumesAt > now ? state.resumesAt : null
  return { suspended: true, resumesAt }
}

// Europe/Berlin, once. Built at module load like the tournament page's formatter, because an
// `Intl.DateTimeFormat` is expensive to construct and this one is asked on every poll.
const clockFmt = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Europe/Berlin'
})

/** An instant as the clock time the grounds read: „14:30", in the event's own timezone. */
export const formatResumeTime = (at: number): string => clockFmt.format(new Date(at))

/**
 * Which surface is asking. The two say different things because they have different things to explain: the
 * schedule carries the times the suspension moves, the front door carries none (ADR-0078, and the
 * Front-door lead's standing rule — the front door **points**, the schedule owns its content).
 */
export type NoticeSurface = 'schedule' | 'front-door'

/** The band's finished German. Every string is complete; a renderer iterates and never concatenates. */
export interface SuspensionNotice {
  headline: string
  lines: string[]
}

/**
 * The band, or null when play is happening.
 *
 * The headline **names no cause** (ADR-0078 rule 2): rain, a thunderstorm, an ambulance on court, a
 * floodlight failure on 5/6 — one thing for the spectator, and the copy that names rain is a lie in four of
 * five cases.
 *
 * „**ca.**", not „ab": the same word and the same reason as ADR-0071 — play can be called **earlier** too,
 * and „ab 14:30" would be a floor nobody promised.
 *
 * The schedule's second line is not decoration. It is what makes the „ca." this suspension puts on every
 * not-yet-started row legible; without it the page hedges everywhere and explains nowhere.
 */
export const suspensionNotice = (
  state: PlaySuspension,
  now: number,
  surface: NoticeSurface
): SuspensionNotice | null => {
  const resolved = resolveSuspension(state, now)
  if (!resolved.suspended) return null
  const resume = resolved.resumesAt === null ? [] : [`Weiter geht es ca. ${formatResumeTime(resolved.resumesAt)} Uhr.`]
  return {
    headline: 'Spielbetrieb unterbrochen',
    lines: surface === 'schedule' ? [...resume, 'Alle geplanten Startzeiten verschieben sich.'] : resume
  }
}

/** Whether play is suspended *as read now* — the one input the Published time's hedge takes (ADR-0078 rule 4). */
export const isPlaySuspended = (state: PlaySuspension, now: number): boolean => resolveSuspension(state, now).suspended
