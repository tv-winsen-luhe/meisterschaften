import { useMemo } from 'react'
import { Shuffle } from 'lucide-react'
import {
  type AdminRegistration,
  byeCount,
  type CompetitionDraw,
  COMPETITION_SLUGS,
  type CompetitionSlug,
  drawBlocker,
  type DrawBlocker,
  DRAW_BLOCKER_REASON,
  drawSize,
  type Match,
  type Phase
} from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Badge } from '@/admin/ui/badge'
import { Button } from '@/admin/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { competitionCapacity, competitionLabel } from './registration-detail'

interface CompetitionsSurfaceProps {
  registrations: AdminRegistration[]
  draws: CompetitionDraw[]
  phase: Phase | null
  // Start the draw for one competition; resolves to whether it succeeded (the shell toasts + reloads).
  onDraw: (competition: CompetitionSlug) => Promise<boolean>
  // True while a draw request is in flight, so the triggered card shows a pending button.
  drawingCompetition: CompetitionSlug | null
}

// The competitions surface (ADR-0027): one card per competition with its draw lifecycle — *not
// drawn* → *drawn* — and the „Jetzt auslosen" action, active once registration is closed
// (`tournament`) and the field is a full, un-drawn bracket (ADR-0025). A drawn field shows its
// bracket. Names are joined from the admin list the shell already holds; the draw carries only ids.
export const CompetitionsSurface = ({
  registrations,
  draws,
  phase,
  onDraw,
  drawingCompetition
}: CompetitionsSurfaceProps) => {
  // Resolve a registration id to a short label once, for the bracket slots and the seeding column.
  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const r of registrations) map.set(r.id, `${r.firstName} ${r.lastName}`.trim())
    return map
  }, [registrations])

  const drawByCompetition = useMemo(() => {
    const map = new Map<string, CompetitionDraw>()
    for (const d of draws) if (d.bracket === 'main') map.set(d.competition, d)
    return map
  }, [draws])

  if (registrations.length === 0) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Shuffle />
          </EmptyMedia>
          <EmptyTitle>Noch nichts auszulosen</EmptyTitle>
          <EmptyDescription>
            Sobald Anmeldungen bestätigt sind und die Anmeldung geschlossen ist, kann hier jede Konkurrenz ausgelost
            werden.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const rows = COMPETITION_SLUGS.map(slug => {
    const confirmed = registrations.filter(r => r.competition === slug && r.status === 'confirmed').length
    const size = drawSize(confirmed)
    const byes = byeCount(confirmed)
    const draw = drawByCompetition.get(slug) ?? null
    // The disabled reason comes from the shared gate the server enforces (ADR-0011) — phase null
    // (not yet loaded) reads as not-yet-tournament, which is the safe "can't draw yet" default.
    const blocker = drawBlocker(phase ?? 'signup', confirmed)
    return {
      slug,
      label: competitionLabel(slug),
      capacity: competitionCapacity(slug),
      confirmed,
      size,
      byes,
      draw,
      blocker
    }
  })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        {rows.map(row => (
          <section key={row.slug} className="bg-card flex flex-col gap-4 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-semibold">{row.label}</span>
                {row.draw ? (
                  <Badge className="border-emerald-300 bg-emerald-50 text-emerald-900">Ausgelost</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Nicht ausgelost
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-sm tabular-nums">
                  {row.confirmed} bestätigt
                  {row.size > 0 && (
                    <>
                      {' · '}
                      {row.size}er-Feld
                      {row.byes > 0 && ` · ${row.byes} FL`}
                    </>
                  )}
                </span>
                {!row.draw && (
                  <DrawAction
                    blocker={row.blocker}
                    pending={drawingCompetition === row.slug}
                    onDraw={() => onDraw(row.slug)}
                  />
                )}
              </div>
            </div>

            {row.draw && <Bracket draw={row.draw} nameById={nameById} />}
          </section>
        ))}
      </div>
    </div>
  )
}

interface DrawActionProps {
  blocker: DrawBlocker | null
  pending: boolean
  onDraw: () => void
}
// The „Jetzt auslosen" button with its disabled reason. Disabled carries the hint as a native
// title tooltip so the operator knows *why* it cannot run — the reason text is the shared one the
// server returns, so affordance and authority can't drift (ADR-0011).
const DrawAction = ({ blocker, pending, onDraw }: DrawActionProps) => (
  <Button
    size="sm"
    onClick={onDraw}
    disabled={blocker !== null || pending}
    title={blocker ? DRAW_BLOCKER_REASON[blocker] : undefined}
  >
    <Shuffle className="size-4" />
    {pending ? 'Lost aus …' : 'Jetzt auslosen'}
  </Button>
)

// Round labels from the back: the last round is the Finale, then Halbfinale, Viertelfinale,
// Achtelfinale. Covers our 8- and 16-draws; a deeper field falls back to "Runde N".
const ROUND_LABELS_FROM_END = ['Finale', 'Halbfinale', 'Viertelfinale', 'Achtelfinale']
const roundLabel = (round: number, totalRounds: number): string =>
  ROUND_LABELS_FROM_END[totalRounds - round] ?? `Runde ${round}`

interface BracketProps {
  draw: CompetitionDraw
  nameById: Map<number, string>
}
// A read-only bracket: one column per round, the round-1 matches carrying the drawn players (with
// their seed number) and later rounds showing the implicit feeders as not-yet-decided slots. Mirrors
// the public preview's column layout (tournament-draw.astro) but reads the persisted `matches`.
const Bracket = ({ draw, nameById }: BracketProps) => {
  const seedByPlayer = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of draw.seeding) map.set(s.playerId, s.seed)
    return map
  }, [draw.seeding])

  const totalRounds = Math.log2(draw.size)
  const byRound = useMemo(() => {
    const rounds: Match[][] = Array.from({ length: totalRounds }, () => [])
    for (const m of draw.matches) rounds[m.round - 1]?.push(m)
    for (const r of rounds) r.sort((a, b) => a.position - b.position)
    return rounds
  }, [draw.matches, totalRounds])

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-min items-stretch gap-6">
        {byRound.map((roundMatches, i) => {
          const round = i + 1
          return (
            <div key={round} className="flex w-44 shrink-0 flex-col">
              <div className="text-muted-foreground mb-2 border-b pb-1 text-xs font-semibold tracking-[0.08em] uppercase">
                {roundLabel(round, totalRounds)}
              </div>
              <div className="flex flex-1 flex-col justify-around gap-2">
                {roundMatches.map(m => (
                  <div key={m.id} className="flex flex-col gap-px">
                    <Slot regId={m.slot1RegId} round={round} nameById={nameById} seedByPlayer={seedByPlayer} />
                    <Slot regId={m.slot2RegId} round={round} nameById={nameById} seedByPlayer={seedByPlayer} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface SlotProps {
  regId: number | null
  round: number
  nameById: Map<number, string>
  seedByPlayer: Map<number, number>
}
// One bracket slot: a drawn player (round 1) with their seed badge, or an empty feeder — a bye
// ("Freilos") in round 1, otherwise a winner ("Sieger") placeholder for a not-yet-played match (ADR-0025).
const Slot = ({ regId, round, nameById, seedByPlayer }: SlotProps) => {
  if (regId === null) {
    return (
      <div className="text-muted-foreground bg-muted/40 flex min-h-8 items-center rounded border border-dashed px-2 text-xs">
        {round === 1 ? 'Freilos' : 'Sieger'}
      </div>
    )
  }
  const seed = seedByPlayer.get(regId)
  return (
    <div className="bg-background flex min-h-8 items-center gap-2 rounded border px-2 text-sm">
      {seed !== undefined && (
        <span
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
            'bg-foreground text-background'
          )}
          title={`An ${seed} gesetzt`}
        >
          {seed}
        </span>
      )}
      <span className="truncate">{nameById.get(regId) ?? `#${regId}`}</span>
    </div>
  )
}
