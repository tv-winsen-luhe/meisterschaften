import { z } from 'zod'
import { courtLabel } from './match-view'
import { COURT_NUMBERS } from './schedule'

// Play suspension (CONTEXT: Play suspension; ADR-0078) — the event-wide statement that play is **not
// happening right now**. The first fact this site carries about the whole event as *reality* rather than as
// plan: Match status is per-match, Schedule publication is per-event but gates the *plan*, and nothing said
// „nobody is on court and every time below is wrong".
//
// It is a **typed state, not a message** (ADR-0078 rule 1): three facts and no prose — suspended yes/no,
// the set of stopped courts, and an optional resume time. A public string typed
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
 * The courts a suspension stops (ADR-0078 Amendment 2 rule 1) — a **non-empty set of court numbers**,
 * validated against the event's own six.
 *
 * **All six is a total suspension.** This event *is* six courts, so „every court is stopped" and „the event
 * is stopped" are one fact; the copy derives the difference rather than storing it, and there is no second
 * encoding (`null` for „everything") of a state the list already says.
 *
 * Non-empty on the wire, because the empty set is not a suspension — but a *stored* empty list is reachable
 * (a hand-edited row, or a value written before this column existed), and `resolveSuspension` degrades it
 * to „play is happening" rather than trusting the boolean beside it.
 */
export const suspendedCourtsSchema = z
  .array(
    z
      .number()
      .int()
      .refine(court => COURT_NUMBERS.includes(court), { error: 'Diesen Platz gibt es nicht.' })
  )
  .min(1, { error: 'Eine Unterbrechung braucht mindestens einen Platz.' })

/**
 * The wire form: a **discriminated union**, so „not suspended, but a resume time is set" is not
 * representable above the Store. The two columns below it are independent and a hand-edited row can put
 * them in that combination; `resolveSuspension` is where it stops.
 *
 * The union survives the court set rather than being collapsed into it (Amendment 2's rejections): „the
 * suspension *is* the set, empty means play is happening" is tidier on paper and makes „`suspended: false`
 * beside a stale court list" representable again, which is the one thing the union was written to prevent.
 */
export const playSuspensionSchema = z.discriminatedUnion('suspended', [
  z.object({ suspended: z.literal(false) }),
  z.object({ suspended: z.literal(true), resumesAt: resumesAtSchema, courts: suspendedCourtsSchema })
])
export type PlaySuspension = z.infer<typeof playSuspensionSchema>

/** Play is happening — the state a fresh database is in, and the one a lift returns to. */
export const NOT_SUSPENDED: PlaySuspension = { suspended: false }

/**
 * A stopped set as every reader should see it: ascending, no duplicates, and nothing the event does not
 * have. The **empty result is the answer** „this is not a suspension" — the caller decides what to do with
 * it, and both callers do the same thing (`resolveSuspension` below, and the Store on the way out of the
 * row).
 *
 * It is a function rather than a rule spelled twice because it is where the wire's `min(1)` stops being
 * enough: a stored list is not parsed through the schema, so this is the only thing standing between a
 * hand-edited row and a court number nobody has.
 */
export const canonicalCourts = (courts: readonly number[]): number[] => {
  const stopped = new Set(courts)
  return COURT_NUMBERS.filter(court => stopped.has(court))
}

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
 *   a lifted suspension is not a suspension, and **a suspension of no courts is not one either** (ADR-0078
 *   Amendment 2 rule 1). The court set is put back into canonical order on the way through — ascending, no
 *   duplicates, nothing the event does not have — so every reader sees one stable list whatever order it
 *   was written in.
 */
export const resolveSuspension = (state: PlaySuspension, now: number): PlaySuspension => {
  if (!state.suspended) return NOT_SUSPENDED
  const courts = canonicalCourts(state.courts)
  if (courts.length === 0) return NOT_SUSPENDED
  const resumesAt = state.resumesAt !== null && state.resumesAt > now ? state.resumesAt : null
  return { suspended: true, resumesAt, courts }
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
 * Whether a suspension stops the whole event. **Derived, never stored** (ADR-0078 Amendment 2 rule 1): this
 * event *is* six courts, so „every court is stopped" and „the event is stopped" are one fact, and a second
 * encoding of it would be two ways to say the same thing forever.
 *
 * It is what makes `COURT_NUMBERS.length` load-bearing for public copy: a seventh court would silently turn
 * every historical total suspension into a partial one.
 */
const isTotal = (courts: readonly number[]): boolean => courts.length === COURT_NUMBERS.length

/**
 * The stopped courts as a German list: „Platz 4", „Platz 4 und 5", „Platz 3, 4 und 6".
 *
 * „Platz" stays singular in front of the enumeration, the way the grounds say it. This is the first public
 * string in this codebase whose **length varies with data**, which is why it is authored here rather than
 * assembled by a renderer: rule 1 is untouched, and a renderer that concatenated „ und" would be the first
 * one that writes German.
 */
const courtsPhrase = (courts: readonly number[]): string => {
  const numbers = courts.map(String)
  const last = numbers[numbers.length - 1]
  const front = numbers.slice(0, -1)
  return `Platz ${front.length === 0 ? last : `${front.join(', ')} und ${last}`}`
}

/**
 * Which surface is asking. The two say different things because they have different things to explain: the
 * schedule carries the times the suspension moves, the front door carries none (ADR-0078, and the
 * Front-door lead's standing rule — the front door **points**, the schedule owns its content).
 */
export type NoticeSurface = 'schedule' | 'front-door'

/**
 * The band's finished German. Every string is complete; a renderer iterates and never concatenates.
 *
 * Two forms of the same statement, because the band is pinned and therefore read twice (ADR-0078 rule 8, as
 * amended): the **full** form on arrival — headline plus lines — and the **condensed** form once the reader
 * has scrolled past it, which is a single line and has to survive on one row of a 360px phone. The condensed
 * form is authored here rather than derived by the renderer from `lines`, because there is no position that
 * holds the right half: on the front door `lines` is empty whenever no resume time is known, and on the
 * schedule the only line left after the time decays is the one about shifted times, which is the wrong half
 * to keep.
 */
export interface SuspensionNotice {
  headline: string
  lines: string[]
  /** The pinned one-liner. Never uppercased by the renderer — it carries a clock time, and a shouted time reads as an error. */
  condensed: string
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
  const time = resolved.resumesAt === null ? null : formatResumeTime(resolved.resumesAt)
  const resume = time === null ? [] : [`Weiter geht es ca. ${time} Uhr.`]
  const total = isTotal(resolved.courts)
  // The band is **not** conditional on totality (Amendment 2 rule 4): a partial suspension that said
  // nothing here would leave every „ca." on the page below it unexplained, which is the failure rule 4
  // exists to prevent. It names what is stopped instead — and so does the shifted-times line, because under
  // a partial suspension the courts that are playing keep their ordinary times.
  const headline = total
    ? 'Spielbetrieb unterbrochen'
    : `Spielbetrieb auf ${courtsPhrase(resolved.courts)} unterbrochen`
  const shifted = total
    ? 'Alle geplanten Startzeiten verschieben sich.'
    : `Die geplanten Startzeiten auf ${resolved.courts.length === 1 ? 'diesem Platz' : 'diesen Plätzen'} verschieben sich.`
  return {
    headline,
    lines: surface === 'schedule' ? [...resume, shifted] : resume,
    // The front door's condensed bar keeps its „Zum Spielplan" link and gives up the time: the front door
    // **points**, and the time it drops is one tap away on the page it points at. The schedule keeps the
    // time, because it is the page whose every „ca." that time explains — and drops the shifted-times
    // sentence, which the reader has already read on the way past.
    condensed: surface === 'schedule' && time !== null ? `${headline} · weiter ca. ${time} Uhr` : headline
  }
}

/**
 * The courts that are stopped *as read now*, or the empty list when play is happening — the input the
 * Published time's hedge takes (ADR-0078 rule 4 as amended by Amendment 2 rule 4).
 *
 * The hedge stopped being a boolean with that amendment: while courts 1–3 play normally, hedging *their*
 * times asserts something false, so „every not-yet-started Published time hedges" became „every
 * not-yet-started Published time **on a stopped court** hedges". For a total suspension that is the same
 * sentence it always was.
 */
export const suspendedCourts = (state: PlaySuspension, now: number): readonly number[] => {
  const resolved = resolveSuspension(state, now)
  return resolved.suspended ? resolved.courts : []
}

/**
 * What the Ergebnisse row says when the match would start on a court the operator has marked as stopped:
 * „Platz 4 ist als unterbrochen markiert", else nothing (ADR-0078 Amendment 2 rule 5).
 *
 * A **hint, not a block** (ADR-0033 — block the impossible, warn the unwise). Starting there is neither:
 * the court may simply have dried and the operator has not said so yet. So the row states the
 * contradiction in front of the only person who can resolve it and lets them resolve it either way —
 * releasing the court, or starting the match anyway. It deliberately does **not** release the court
 * itself, which is the tempting version and fails exactly the way rule 7 rejects auto-lifting: it would
 * announce, positively and silently, that play has resumed there.
 *
 * The court is the one the match would actually be on — the row's own pick, not its reservation — because
 * that is the court whose state the operator is contradicting.
 */
export const courtStoppedHint = (court: number, stoppedCourts: readonly number[]): string | null =>
  stoppedCourts.includes(court) ? `${courtLabel(court)} ist als unterbrochen markiert` : null

/**
 * The operator's second control (ADR-0078 Amendment 2 rule 3): one court is **released** from a standing
 * suspension, or **stopped again**.
 *
 * A pure transition rather than a rule inside the admin hook, because two of the three cases are the
 * interesting ones and neither is about React:
 *
 * - **Releasing the last stopped court lifts the suspension**, and lifting is the only honest reading —
 *   „suspended, no courts" is not a state (rule 1), and it degrades to this anyway one read later.
 * - **While play is happening nothing happens.** The chips exist only while a suspension stands, so this is
 *   unreachable from the shell; answering it fail-closed is cheaper than inventing a one-court suspension
 *   out of the resting state, which no control asks for.
 *
 * The **one resume time survives** either act (rule 2): releasing a court changes the extent of the
 * suspension, not the promise it carries. The shell switch is untouched by all of this — it still means
 * „alles unterbrechen" and stays one tap.
 */
export const toggleCourt = (state: PlaySuspension, court: number): PlaySuspension => {
  if (!state.suspended) return NOT_SUSPENDED
  const stopped = canonicalCourts(state.courts)
  const courts = canonicalCourts(stopped.includes(court) ? stopped.filter(c => c !== court) : [...stopped, court])
  if (courts.length === 0) return NOT_SUSPENDED
  return { suspended: true, resumesAt: state.resumesAt, courts }
}
