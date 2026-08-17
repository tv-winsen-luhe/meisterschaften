import { useCallback, useEffect, useMemo, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import {
  isCancelledCompetition,
  isUnseededCompetition,
  resolveSocialMixerBlock,
  SOCIAL_MIXER_DEFAULT_PLACEMENT,
  type AdminRegistration,
  type CompetitionSlug,
  type SocialMixerBlock,
  type SocialMixerPlacement
} from '../../shared'

// The Social mixer block's seam (ADR-0064), kept out of the admin shell like useCancellation and
// useSchedule: where the operator has put the block, the move that relocates it, and the **resolved**
// block every schedule surface reads.
//
// The placement is read once on mount from the public GET /api/phase — the one signal every surface
// already keys off (ADR-0048) — and the move applies its own known outcome rather than re-reading, so a
// flaky follow-up GET cannot leave the grid shading a cell the block has left. A failed read keeps the
// planned placement, the same fail-safe the server's reader takes.

type Client = ReturnType<typeof hc<AppType>>
// The shell's shared mutation wrapper (401-regate + error/success toast + reload), passed in so this
// write shares its behaviour — including surfacing the server's refusal of an out-of-window start.
type Mutate = (run: () => Promise<Response>, success: string | null) => Promise<boolean>

interface SocialMixerApi {
  // Where the block sits — the dialog's current value.
  socialMixerPlacement: SocialMixerPlacement
  // The block as every surface reads it: courts sized by the confirmed head-count, or `null` when the
  // mixer is cancelled and there is nothing reserved at all (ADR-0062).
  socialMixerBlock: SocialMixerBlock | null
  // The mixer's confirmed entries — the number the court count derives from, shown in the dialog so a
  // shading that moves on its own does not read as a bug.
  confirmedEntries: number
  // Move the block; resolves to whether the write took.
  moveSocialMixerBlock: (placement: SocialMixerPlacement) => Promise<boolean>
}

export const useSocialMixer = (
  client: Client,
  mutate: Mutate,
  registrations: AdminRegistration[],
  cancelledCompetitions: readonly CompetitionSlug[]
): SocialMixerApi => {
  const [socialMixerPlacement, setPlacement] = useState<SocialMixerPlacement>(SOCIAL_MIXER_DEFAULT_PLACEMENT)

  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const res = await client.api.phase.$get()
        if (res.ok && !ignore) setPlacement((await res.json()).socialMixerPlacement)
      } catch {
        // ignore — keep the planned placement
      }
    })()
    return () => {
      ignore = true
    }
  }, [client])

  const moveSocialMixerBlock = useCallback(
    async (placement: SocialMixerPlacement) => {
      const ok = await mutate(
        () => client.api.admin['social-mixer-block'].$post({ json: placement }),
        'Doppel-Block verschoben.'
      )
      if (ok) setPlacement(placement)
      return ok
    },
    [client, mutate]
  )

  // The head-count the courts follow: confirmed entries in the unseeded field, from the same admin list
  // every other surface reads. Live, never frozen — while signup is open the block is a planning figure
  // that should track reality (ADR-0064 §1).
  const confirmedEntries = useMemo(
    () => registrations.filter(r => r.status === 'confirmed' && isUnseededCompetition(r.competition)).length,
    [registrations]
  )

  const socialMixerBlock = useMemo(
    () =>
      resolveSocialMixerBlock({
        ...socialMixerPlacement,
        confirmed: confirmedEntries,
        cancelled: isCancelledCompetition(cancelledCompetitions, 'womens-social')
      }),
    [socialMixerPlacement, confirmedEntries, cancelledCompetitions]
  )

  return { socialMixerPlacement, socialMixerBlock, confirmedEntries, moveSocialMixerBlock }
}
