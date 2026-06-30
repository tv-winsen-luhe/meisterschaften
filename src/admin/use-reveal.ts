import { useCallback } from 'react'
import { hc } from 'hono/client'
import { toast } from 'sonner'
import type { AppType } from '../../worker/app'
import type { CompetitionSlug, PublicDraw } from '../../shared'
import { errorMessage, isAuthRedirect } from './lib/api'

// The draw show's two server seams (issue #71), kept out of the admin shell: reading one competition's
// reveal and moving its cursor. Both are *pure playback* of what the precompute already wrote (ADR-0003) —
// the read never sees past the cursor (the server slices it), the advance never re-rolls.
//
// The read goes through the admin-only GET /api/admin/draw/reveal (under Access), not the public GET
// /api/draw: the beamer needs the **full** reveal (a Challenger field keeps its LK + seed to run the
// draw, ADR-0024), while the public wire redacts that protected strength (ADR-0044). Same cursor-
// sliced shape, so this is the un-redacted sibling of the off-site bracket's feed.

type Client = ReturnType<typeof hc<AppType>>

// A reveal read, kept distinct so the caller can tell a genuinely un-drawn field (`absent`) from a
// transient read failure (`error`) — collapsing both to null is what would otherwise show „not drawn" for
// a drawn field, or freeze the show's cursor mid-reveal (the show retries `error`, never `absent`).
export type RevealRead = { status: 'ok'; draw: PublicDraw } | { status: 'absent' } | { status: 'error' }

interface RevealApi {
  // Read the current reveal for one competition: present (`ok`), genuinely not drawn (`absent`), or a
  // transient failure (`error`) the caller can retry.
  loadReveal: (competition: CompetitionSlug) => Promise<RevealRead>
  // Move the reveal cursor one lot; resolves to whether it took. Regated on an Access redirect, toasts a
  // genuine error — but no success toast/reload (per-lot noise on the beamer); the show re-reads itself.
  advanceReveal: (competition: CompetitionSlug, direction: 'forward' | 'back') => Promise<boolean>
}

export const useReveal = (client: Client): RevealApi => {
  // The show reads the operator's full reveal (GET /api/admin/draw/reveal, the un-redacted sibling of the
  // off-site bracket's feed — already cursor-sliced server-side) and picks out this competition. Because
  // this read is now behind Access (unlike the public /api/draw it used to poll), an expired session must
  // be regated like advanceReveal — reload to re-auth rather than swallow the opaque redirect as a
  // retryable `error`, which would freeze the beamer on a stale frame. A non-OK/thrown read is `error`
  // (retryable); a clean read that simply does not list the field is `absent` (genuinely not drawn).
  const loadReveal = useCallback(
    async (competition: CompetitionSlug): Promise<RevealRead> => {
      try {
        const res = await client.api.admin.draw.reveal.$get()
        if (isAuthRedirect(res)) {
          location.reload()
          return { status: 'error' }
        }
        if (!res.ok) return { status: 'error' }
        const { draws } = await res.json()
        const draw = draws.find(d => d.competition === competition)
        return draw ? { status: 'ok', draw } : { status: 'absent' }
      } catch {
        return { status: 'error' }
      }
    },
    [client]
  )

  const advanceReveal = useCallback(
    async (competition: CompetitionSlug, direction: 'forward' | 'back'): Promise<boolean> => {
      try {
        const res = await client.api.admin.draw.advance.$post({ json: { competition, direction } })
        if (isAuthRedirect(res)) {
          location.reload()
          return false
        }
        if (!res.ok) {
          toast.error(await errorMessage(res))
          return false
        }
        return true
      } catch {
        toast.error('Aktion fehlgeschlagen.')
        return false
      }
    },
    [client]
  )

  return { loadReveal, advanceReveal }
}
