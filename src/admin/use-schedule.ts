import { useCallback, useEffect, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import type { Placement } from '../../shared'

// The schedule write seams (ADR-0041, ADR-0005), kept out of the admin shell like useReveal: the place/move
// write, the published flag, and the publish/reset actions. The initial flag is read once on mount from the
// lightweight operator endpoint; each action sets it **deterministically** from its own outcome (publish ⇒
// true, reset ⇒ false) rather than re-reading, so a flaky follow-up GET can never leave the control showing
// the wrong state after a write that did take.

type Client = ReturnType<typeof hc<AppType>>
// The shell's shared mutation wrapper (401-regate + error/optional-success toast + reload), passed in so the
// schedule writes share its behaviour. `null` success is the deliberate silence for a place/move the grid
// already shows (#139); publish/reset fire exactly one confirmation toast.
type Mutate = (run: () => Promise<Response>, success: string | null) => Promise<boolean>

interface ScheduleApi {
  // Place a match into a cell, move it, or clear it back to the backlog (null) — silent on success (#139).
  placeMatch: (id: number, placement: Placement | null) => Promise<boolean>
  // Whether the planned schedule is currently published.
  published: boolean
  // Reveal the whole planned schedule, or wipe placements back to the backlog (auto-unpublishing). Each
  // resolves to whether the write took; on success the flag is set from the known outcome.
  publishSchedule: () => Promise<boolean>
  resetSchedule: () => Promise<boolean>
}

export const useSchedule = (client: Client, mutate: Mutate): ScheduleApi => {
  const [published, setPublished] = useState(false)

  // Initial state, once on mount — best-effort: a failed read leaves the default (unpublished), the safe
  // framing. `ignore` guards against a set after unmount.
  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const res = await client.api.admin.schedule.$get()
        if (res.ok && !ignore) setPublished((await res.json()).published)
      } catch {
        // ignore — keep the default
      }
    })()
    return () => {
      ignore = true
    }
  }, [client])

  const publishSchedule = useCallback(async () => {
    const ok = await mutate(() => client.api.admin.schedule.publish.$post(), 'Spielplan veröffentlicht.')
    if (ok) setPublished(true)
    return ok
  }, [client, mutate])

  const resetSchedule = useCallback(async () => {
    const ok = await mutate(() => client.api.admin.schedule.reset.$post(), 'Spielplan zurückgesetzt.')
    if (ok) setPublished(false)
    return ok
  }, [client, mutate])

  // Place a match on the grid, move it, or clear it back to the backlog (null). Silent on success — the
  // grid already shows the move (#139); the success reload re-fetches the draws (matches carry placement).
  const placeMatch = useCallback(
    (id: number, placement: Placement | null) =>
      mutate(() => client.api.admin.match.place.$post({ json: { id, placement } }), null),
    [client, mutate]
  )

  return { placeMatch, published, publishSchedule, resetSchedule }
}
