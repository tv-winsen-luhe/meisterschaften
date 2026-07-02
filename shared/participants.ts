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
  // The strength-redaction decision the server made for this row (ADR-0048), set in the same step that
  // nulls `lk`. `true` ⟺ a protected field whose absolute strength is withheld — so the client renders
  // the flag instead of re-deriving protection from the competition slug, and a redacted `lk: null` can
  // never be confused with a not-yet-synced one („LK folgt"). The relative-rank `seedRank` below is kept
  // either way (ADR-0047), so `redacted` withholds only the LK value, not the placement.
  redacted: z.boolean(),
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
