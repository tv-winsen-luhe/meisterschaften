import { useCallback } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import type { MatchStatus } from '../../shared'
import type { ResultPayload } from './surfaces/results-surface'

// The result-entry seams (ADR-0032, ADR-0026), kept out of the admin shell like useSchedule/useReveal: the
// live status transition (with the actual court) and the result write that advances the bracket. Both route
// through the shell's shared `mutate` wrapper, so they inherit its 401-regate + error toast + reload — the
// success reload re-fetches the draws, so the bracket reflects the new result/status.

type Client = ReturnType<typeof hc<AppType>>
// The shell's shared mutation wrapper (401-regate + error/optional-success toast + reload). `null` success
// is the deliberate silence for self-evident edits (a status flip the list already shows).
type Mutate = (run: () => Promise<Response>, success: string | null) => Promise<boolean>

interface ResultsApi {
  // Move a match's live status (ADR-0032): „läuft" captures the actual court (may differ from the planned
  // one), „beendet" follows result entry. Silent on success — the Ergebnisse list reflects it on reload.
  setMatchStatus: (id: number, status: MatchStatus, liveCourt?: number) => Promise<boolean>
  // Record (or correct) a completed result (CONTEXT: Advancement): the winner advances, a semifinal loser
  // drops to the third-place playoff, a winner change cascade-clears downstream — all server-side.
  recordResult: (id: number, payload: ResultPayload) => Promise<boolean>
}

export const useResults = (client: Client, mutate: Mutate): ResultsApi => {
  const setMatchStatus = useCallback(
    (id: number, status: MatchStatus, liveCourt?: number) =>
      mutate(
        () =>
          client.api.admin.match.status.$post({
            json: { id, status, ...(liveCourt !== undefined ? { liveCourt } : {}) }
          }),
        null
      ),
    [client, mutate]
  )

  const recordResult = useCallback(
    (id: number, payload: ResultPayload) =>
      mutate(() => client.api.admin.match.result.$post({ json: { id, ...payload } }), 'Ergebnis gespeichert.'),
    [client, mutate]
  )

  return { setMatchStatus, recordResult }
}
