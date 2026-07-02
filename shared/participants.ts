import { z } from 'zod'
import { clubSchema } from './club'
import { competitionSlug } from './competition'

// The public participant list contract. camelCase is the standard in TS/Zod and
// therefore on the wire; the snake_case D1 columns are translated once, in the
// Drizzle column mapping. This Zod schema is the single source of truth for the
// JSON shape — both the worker (response) and the client (typed `hc`) read it.
export const participantSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  club: clubSchema,
  competition: competitionSlug,
  lk: z.string().nullable(),
  // The provisional seed number (1..seedCount), or null when unseeded / below the draw floor. Computed
  // by LK per competition, independent of the list order (ADR-0047), so the pre-draw preview places the
  // LK-strongest on the seed lines. For a protected Challenger field it is the *only* strength signal on
  // the wire — the relative-rank structural signal (ADR-0044); the LK value stays redacted, and the seed
  // number itself is not rendered for that field.
  seedRank: z.number().int().positive().nullable()
})

export const participantsResponseSchema = z.object({
  enabled: z.boolean(),
  participants: z.array(participantSchema)
})

export type Participant = z.infer<typeof participantSchema>
export type ParticipantsResponse = z.infer<typeof participantsResponseSchema>
