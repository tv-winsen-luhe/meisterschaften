import { useCallback } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import type { MatchStatus } from '../../shared'
import type { ResultPayload } from './surfaces/results-surface'
import type { SetWrite } from './surfaces/result-save'

// The result-entry seams (ADR-0032, ADR-0026), kept out of the admin shell like useSchedule/useReveal: the
// live status transition (with the actual court) and the result write that advances the bracket. Both route
// through the shell's shared `mutate` wrapper, so they inherit its 401-regate + error toast + reload — the
// success reload re-fetches the draws, so the bracket reflects the new result/status.

type Client = ReturnType<typeof hc<AppType>>
// The shell's shared mutation wrapper (401-regate + error/optional-success toast + reload). `null` success
// is the deliberate silence for self-evident edits (a status flip the list already shows).
type Mutate = (run: () => Promise<Response>, success: string | null) => Promise<boolean>

interface ResultsApi {
  // Move a match's live status (ADR-0032), or restate the court it is on: „läuft" carries the actual court
  // (which may differ from the planned one, and may move again while it runs — ADR-0079 rule 1), „geplant"
  // clears it, „beendet" follows result entry. Silent on success — the Ergebnisse list reflects it on reload.
  setMatchStatus: (id: number, status: MatchStatus, liveCourt?: number) => Promise<boolean>
  // Record (or correct) a completed result (CONTEXT: Advancement): the winner advances, a semifinal loser
  // drops to the third-place playoff, a winner change cascade-clears downstream — all server-side.
  recordResult: (id: number, payload: ResultPayload) => Promise<boolean>
  // Save a running match's Zwischenstand (ADR-0032, Amendment 2026-08-20): one /match/set call per changed
  // set, at most three — there is no batch endpoint for three integer pairs (ADR-0021). Sequential and
  // fail-fast: the first rejected set stops the run and its response carries the message the toast shows,
  // so a bad set never hides behind a later good one. It resolves no match — no winner, no advancement, no
  // status move (only the operator knows the actual court, so „läuft" stays their explicit act).
  saveSets: (id: number, writes: SetWrite[]) => Promise<boolean>
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

  const saveSets = useCallback(
    async (id: number, writes: SetWrite[]) => {
      // Nothing changed ⇒ nothing to send. The drawer already withholds the save in that state; this keeps
      // the loop below total (it has a first write to start from) rather than resting on that.
      if (writes.length === 0) return true
      const send = ({ set, score }: SetWrite) => client.api.admin.match.set.$post({ json: { id, set, score } })
      return mutate(async () => {
        let res = await send(writes[0])
        for (const write of writes.slice(1)) {
          if (!res.ok) break // fail fast: the first rejected set is the response `mutate` reports
          res = await send(write)
        }
        return res
      }, 'Zwischenstand gespeichert.')
    },
    [client, mutate]
  )

  return { setMatchStatus, recordResult, saveSets }
}
