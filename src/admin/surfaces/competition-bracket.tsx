import { useMemo } from 'react'
import { type CompetitionDraw, type Match, roundLabel } from '../../../shared'
import { cn } from '@/admin/lib/utils'

// The competitions surface's read-only bracket (ADR-0025), split out so the surface itself stays the
// lifecycle cockpit. Shown only once a draw is fully revealed — while the reveal runs the card withholds
// it, so projecting the admin can never spoil the show.

interface BracketProps {
  draw: CompetitionDraw
  nameById: Map<number, string>
}
// A read-only bracket: one column per round, the round-1 matches carrying the drawn players (with
// their seed number) and later rounds showing the implicit feeders as not-yet-decided slots. Mirrors
// the public preview's column layout (tournament-draw.astro) but reads the persisted `matches`.
export const Bracket = ({ draw, nameById }: BracketProps) => {
  const seedByPlayer = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of draw.seeding) map.set(s.playerId, s.seed)
    return map
  }, [draw.seeding])

  const totalRounds = Math.log2(draw.size)
  const byRound = useMemo(() => {
    const rounds: Match[][] = Array.from({ length: totalRounds }, () => [])
    // The third-place playoff shares the final's round but is a separate placement match, not a KO-tree
    // node — excluded here so the final column shows the final alone, not a phantom second box (#90).
    for (const m of draw.matches) if (!m.thirdPlace) rounds[m.round - 1]?.push(m)
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
                {roundLabel({ bracket: 'main', round, totalRounds })}
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
