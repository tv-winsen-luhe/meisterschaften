import { useCallback, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import type { CompetitionSlug } from '../../shared'

// The draw seams (ADR-0025, ADR-0004), kept out of the admin shell like useResults/useSchedule/useReveal:
// the main draw („Jetzt auslosen") and the consolation draw („Nebenrunde auslosen"). Both route through the
// shell's shared `mutate` (401-regate + error/success toast + reload — the reload re-fetches the draws, so
// the brackets reflect the new state) and each owns a pending flag that drives its card button and guards a
// double-fire. Only the main draw hands off to the beamer show; the consolation is published directly.

type Client = ReturnType<typeof hc<AppType>>
type Mutate = (run: () => Promise<Response>, success: string | null) => Promise<boolean>

interface DrawApi {
  // Start the main draw (ADR-0025); on success the large-screen show opens straight away (onMainDrawn) —
  // the live flow is „auslosen, dann enthüllen", so the operator goes from the button to the beamer.
  drawCompetition: (competition: CompetitionSlug) => Promise<boolean>
  // The competition a main draw is running for (its card shows a pending button), or null.
  drawingCompetition: CompetitionSlug | null
  // Draw the consolation bracket (de: „Nebenrunde auslosen", ADR-0004) — published directly, no beamer.
  drawConsolation: (competition: CompetitionSlug) => Promise<boolean>
  // The competition a consolation draw is running for, or null.
  drawingConsolation: CompetitionSlug | null
}

// `onMainDrawn` opens the beamer show for a freshly-drawn field (the shell owns that screen state).
export const useDraw = (
  client: Client,
  mutate: Mutate,
  onMainDrawn: (competition: CompetitionSlug) => void
): DrawApi => {
  const [drawingCompetition, setDrawingCompetition] = useState<CompetitionSlug | null>(null)
  const [drawingConsolation, setDrawingConsolation] = useState<CompetitionSlug | null>(null)

  const drawCompetition = useCallback(
    async (competition: CompetitionSlug): Promise<boolean> => {
      setDrawingCompetition(competition)
      try {
        const ok = await mutate(() => client.api.admin.draw.$post({ json: { competition } }), 'Konkurrenz ausgelost.')
        if (ok) onMainDrawn(competition)
        return ok
      } finally {
        setDrawingCompetition(null)
      }
    },
    [client, mutate, onMainDrawn]
  )

  const drawConsolation = useCallback(
    async (competition: CompetitionSlug): Promise<boolean> => {
      setDrawingConsolation(competition)
      try {
        return await mutate(
          () => client.api.admin.draw.consolation.$post({ json: { competition } }),
          'Nebenrunde ausgelost.'
        )
      } finally {
        setDrawingConsolation(null)
      }
    },
    [client, mutate]
  )

  return { drawCompetition, drawingCompetition, drawConsolation, drawingConsolation }
}
