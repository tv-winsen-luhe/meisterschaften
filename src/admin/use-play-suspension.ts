import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import {
  COURT_NUMBERS,
  courtLabel,
  NOT_SUSPENDED,
  type PlaySuspension,
  suspendedCourts,
  toggleCourt
} from '../../shared'

// The Play suspension seam (ADR-0078), kept out of the admin shell like useCancellation and useSchedule:
// whether play is suspended, on which courts, when it is expected to resume, and the three writes that
// change it — the two global ones, and a single court released or stopped again.
//
// Read once on mount from the public GET /api/phase — the one signal every surface keys off, so the admin
// shows exactly what the public wire carries — and each write applies its **own** known outcome rather than
// re-reading, so a flaky follow-up GET cannot leave the switch showing the wrong state. A failed read leaves
// „play is happening": the same fail-closed default the server takes, because a read that failed is not an
// operator's act.
//
// The resume time is computed **here**, from the operator's „+30" rather than stored as one: an instant is
// what the wire carries (see shared/play-suspension), and the relative thinking belongs in the button.

type Client = ReturnType<typeof hc<AppType>>
// The shell's shared mutation wrapper (401-regate + error/success toast + reload), passed in so this write
// shares its behaviour.
type Mutate = (run: () => Promise<Response>, success: string | null) => Promise<boolean>

/** The quick-taps the switch offers, in minutes. The language of a rain day: „wir schauen in einer halben
 * Stunde nochmal". Each resolves to an absolute instant at the moment it is tapped. */
export const RESUME_OFFSETS_MINUTES = [15, 30, 60] as const

interface PlaySuspensionApi {
  playSuspension: PlaySuspension
  /** The courts the standing suspension stops, canonical and empty while play is happening — the reading
   * the Ergebnisse row's „läuft"-on-a-stopped-court hint takes (ADR-0078 Amendment 2 rule 5). Resolved
   * here, beside the state it reads, so no surface resolves a suspension of its own. */
  stoppedCourts: readonly number[]
  /** Suspend play, optionally naming the minutes until it is expected to resume. */
  suspend: (inMinutes: number | null) => Promise<boolean>
  /** Lift it. Always manual — see ADR-0078 rule 7. */
  resume: () => Promise<boolean>
  /**
   * Release one stopped court, or stop a released one again (ADR-0078 Amendment 2 rule 3) — the second
   * control, beside the switch rather than inside it. Releasing the last stopped court lifts the whole
   * suspension, which is `toggleCourt`'s rule and not this hook's.
   */
  releaseOrStopCourt: (court: number) => Promise<boolean>
}

export const usePlaySuspension = (client: Client, mutate: Mutate): PlaySuspensionApi => {
  const [playSuspension, setPlaySuspension] = useState<PlaySuspension>(NOT_SUSPENDED)
  // The same state as the render reads it, but readable *now* rather than at the next render. The court
  // toggle is this hook's first **relative** write — „the state minus court 3" rather than a whole state
  // named by the operator — so it is the first one for which a render-old value is a wrong answer rather
  // than a stale display.
  const known = useRef<PlaySuspension>(NOT_SUSPENDED)
  const remember = useCallback((next: PlaySuspension) => {
    known.current = next
    setPlaySuspension(next)
  }, [])

  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const res = await client.api.phase.$get()
        if (res.ok && !ignore) remember((await res.json()).playSuspension)
      } catch {
        // ignore — keep „play is happening"
      }
    })()
    return () => {
      ignore = true
    }
  }, [client, remember])

  const write = useCallback(
    async (next: PlaySuspension, success: string) => {
      const ok = await mutate(() => client.api.admin['play-suspension'].$post({ json: next }), success)
      if (ok) remember(next)
      return ok
    },
    [client, mutate, remember]
  )

  // The shell switch means „alles unterbrechen" and writes **every** court (ADR-0078 Amendment 2 rule 3).
  // All six is the total suspension, so this is the same statement it always made; releasing a single court
  // is a second control, and it is deliberately not this one — the fast path stays one tap.
  const suspend = useCallback(
    (inMinutes: number | null) =>
      write(
        {
          suspended: true,
          resumesAt: inMinutes === null ? null : Date.now() + inMinutes * 60_000,
          courts: [...COURT_NUMBERS]
        },
        'Spielbetrieb unterbrochen.'
      ),
    [write]
  )

  const resume = useCallback(() => write(NOT_SUSPENDED, 'Spielbetrieb läuft wieder.'), [write])

  // Only the resume time decays, never the court set, so the clock read here settles nothing this reading
  // depends on — it is the argument `suspendedCourts` takes, and passing the real one keeps this seam
  // honest rather than pretending the state has no time in it.
  const stoppedCourts = useMemo(() => suspendedCourts(playSuspension, Date.now()), [playSuspension])

  // A single court, in either direction. The transition itself is the projection's (`toggleCourt`), so the
  // one rule that could surprise an operator — releasing the last stopped court lifts the suspension — is
  // stated once, tested without React, and merely *said* here: the toast names what actually happened
  // rather than what was tapped.
  //
  // **Queued, and computed from `known.current` rather than from the render's value**, because this is a
  // read-modify-write and two taps in the rain are one gesture: release court 3, then court 4 a moment
  // later. Both would otherwise start from the same six-court state, and the second write would re-stop
  // court 3 — silently, right after a toast said it was playing again. So each toggle waits for the previous
  // one to land and then reads the state that landed. The two absolute writes above need none of this: they
  // name a whole state instead of amending one.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const releaseOrStopCourt = useCallback(
    (court: number) => {
      const run = queue.current.then(() => {
        const next = toggleCourt(known.current, court)
        const success = !next.suspended
          ? 'Spielbetrieb läuft wieder.'
          : next.courts.includes(court)
            ? `${courtLabel(court)} unterbrochen.`
            : `${courtLabel(court)} spielt wieder.`
        return write(next, success)
      })
      // The chain must survive a failed write, or one rejection would strand every later tap.
      queue.current = run.catch(() => undefined)
      return run
    },
    [write]
  )

  return { playSuspension, stoppedCourts, suspend, resume, releaseOrStopCourt }
}
