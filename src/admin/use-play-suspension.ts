import { useCallback, useEffect, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import { COURT_NUMBERS, NOT_SUSPENDED, type PlaySuspension } from '../../shared'

// The Play suspension seam (ADR-0078), kept out of the admin shell like useCancellation and useSchedule:
// whether play is suspended, when it is expected to resume, and the two writes that change it.
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
  /** Suspend play, optionally naming the minutes until it is expected to resume. */
  suspend: (inMinutes: number | null) => Promise<boolean>
  /** Lift it. Always manual — see ADR-0078 rule 7. */
  resume: () => Promise<boolean>
}

export const usePlaySuspension = (client: Client, mutate: Mutate): PlaySuspensionApi => {
  const [playSuspension, setPlaySuspension] = useState<PlaySuspension>(NOT_SUSPENDED)

  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const res = await client.api.phase.$get()
        if (res.ok && !ignore) setPlaySuspension((await res.json()).playSuspension)
      } catch {
        // ignore — keep „play is happening"
      }
    })()
    return () => {
      ignore = true
    }
  }, [client])

  const write = useCallback(
    async (next: PlaySuspension, success: string) => {
      const ok = await mutate(() => client.api.admin['play-suspension'].$post({ json: next }), success)
      if (ok) setPlaySuspension(next)
      return ok
    },
    [client, mutate]
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

  return { playSuspension, suspend, resume }
}
