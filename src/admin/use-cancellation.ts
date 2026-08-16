import { useCallback, useEffect, useMemo, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import {
  type AdminRegistration,
  type CompetitionSlug,
  type UnderfilledCompetition,
  underfilledCompetitions
} from '../../shared'

// The competition-cancellation seam (ADR-0062), kept out of the admin shell like useSchedule: which
// competitions the operator has cancelled, and the toggle that cancels one or takes it back.
//
// The set is read once on mount from the public GET /api/phase — the one signal every surface keys off,
// so the admin marks exactly what the public wire withholds — and each write applies its **own** known
// outcome rather than re-reading, so a flaky follow-up GET cannot leave a card showing the wrong state.
// A failed read leaves the empty set: nothing marked „abgesagt", which is the fail-closed default the
// server takes too (a read that failed is not an operator's act).

type Client = ReturnType<typeof hc<AppType>>
// The shell's shared mutation wrapper (401-regate + error/success toast + reload), passed in so this
// write shares its behaviour — including surfacing the server's refusal for an already-drawn field.
type Mutate = (run: () => Promise<Response>, success: string | null) => Promise<boolean>

interface CancellationApi {
  cancelledCompetitions: CompetitionSlug[]
  // Cancel one competition, or take the cancellation back; resolves to whether the write took.
  setCompetitionCancelled: (competition: CompetitionSlug, cancelled: boolean) => Promise<boolean>
  // The competitions under their threshold, for the „Anmeldung schließen" dialog's hint. The advisory
  // half of the seam: it names what is worth cancelling, and cancels nothing.
  underfilled: UnderfilledCompetition[]
}

export const useCancellation = (
  client: Client,
  mutate: Mutate,
  registrations: AdminRegistration[]
): CancellationApi => {
  const [cancelledCompetitions, setCancelled] = useState<CompetitionSlug[]>([])

  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const res = await client.api.phase.$get()
        if (res.ok && !ignore) setCancelled((await res.json()).cancelledCompetitions)
      } catch {
        // ignore — keep the empty set
      }
    })()
    return () => {
      ignore = true
    }
  }, [client])

  // The card owns the confirmation dialog — on the cancel only, because the expensive half of that act is
  // the phone call, not the click. The server refuses to cancel a drawn field (draw reset first,
  // ADR-0029); that reason arrives as the error toast `mutate` already shows.
  const setCompetitionCancelled = useCallback(
    async (competition: CompetitionSlug, cancelled: boolean) => {
      const ok = await mutate(
        () => client.api.admin.competition.cancel.$post({ json: { competition, cancelled } }),
        cancelled ? 'Konkurrenz abgesagt.' : 'Absage zurückgenommen.'
      )
      if (ok)
        setCancelled(prev => {
          const without = prev.filter(c => c !== competition)
          return cancelled ? [...without, competition] : without
        })
      return ok
    },
    [client, mutate]
  )

  // The threshold hint (ADR-0062), derived from the same admin list every surface reads: the confirmed
  // count is the number the decision hangs on, and the already-cancelled fields drop out of the advice.
  const underfilled = useMemo(() => {
    const confirmed: Partial<Record<CompetitionSlug, number>> = {}
    for (const reg of registrations)
      if (reg.status === 'confirmed') confirmed[reg.competition] = (confirmed[reg.competition] ?? 0) + 1
    return underfilledCompetitions(confirmed, cancelledCompetitions)
  }, [registrations, cancelledCompetitions])

  return { cancelledCompetitions, setCompetitionCancelled, underfilled }
}
