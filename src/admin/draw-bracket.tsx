import { useMemo } from 'react'
import { motion } from 'motion/react'
import {
  bracketStructure,
  type ByeWinner,
  type PlayerDisplay,
  type PublicRevealStep,
  revealedBracket
} from '../../shared'
import { cn } from '@/admin/lib/utils'
import { roundLabel } from '@/admin/lib/bracket'

// The bracket the draw show fills in behind the announce band (issue #71). Pure playback of the revealed
// reveal steps: round 1 plays each drawn line, round 2 shows a bye winner already advanced, everything
// deeper is an undecided feeder. Shape comes from the shared bracketStructure (ADR-0025), so the show
// can't drift from the public bracket; the focus line carries the highlight and the `motion` reveal.

export const playerName = (player: PlayerDisplay): string => `${player.firstName} ${player.lastName}`.trim()

// An easeOutExpo-ish curve: a lot snaps in fast then settles — reads as a reveal, not a slide. Shared by
// the bracket's per-line reveal and the announce band so both move on the same timing.
export const EASE = [0.16, 1, 0.3, 1] as const

interface DrawBracketProps {
  size: number
  steps: PublicRevealStep[]
  // The line in focus (the last revealed) — it carries the highlight ring; null before the first lot.
  currentPosition: number | null
  reduce: boolean
}

export const DrawBracket = ({ size, steps, currentPosition, reduce }: DrawBracketProps) => {
  // The revealed bracket: round-1 lines by position and the round-2 bye-winners (§31). One shared
  // interpretation the public live bracket renders too (CONTEXT: Revealed bracket); the cells below add
  // only the focus highlight and the `motion` reveal.
  const { lines, byeWinners } = useMemo(() => revealedBracket(size, steps), [size, steps])

  const totalRounds = bracketStructure(size).rounds

  // The whole bracket fits the available height (no scroll, ADR — a beamer can't be scrolled): every
  // round's matches flex to fill the column, and each slot flexes within its match, so a 16-line round one
  // shrinks the lines to fit rather than overflowing and clipping the top/bottom seeds off-screen.
  return (
    <div className="flex flex-1 items-stretch justify-center overflow-hidden px-8 pb-4">
      <div className="flex items-stretch gap-10">
        {Array.from({ length: totalRounds }, (_, r) => {
          const round = r + 1
          const matchCount = size / 2 ** round
          return (
            <div key={round} className="flex w-56 shrink-0 flex-col">
              <div className="mb-3 flex items-center justify-between border-b border-[#0c1e3a]/15 pb-2 text-[11px] font-bold tracking-[0.14em] text-[#0c1e3a] uppercase">
                <span>{roundLabel(round, totalRounds)}</span>
                <span className="text-[#0c1e3a]/35 tabular-nums">{matchCount}</span>
              </div>
              {/* Space *between* matches (gap-3) wider than the gap *within* a match (gap-1) groups each
                  pair and keeps the lines off each other — they fill the column, they don't glue to it. */}
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                {Array.from({ length: matchCount }, (_, m) => (
                  <div key={m} className="flex min-h-0 flex-1 flex-col justify-center gap-1">
                    <Cell
                      round={round}
                      slotIndex={2 * m}
                      lines={lines}
                      byeWinners={byeWinners}
                      currentPosition={currentPosition}
                      reduce={reduce}
                    />
                    <Cell
                      round={round}
                      slotIndex={2 * m + 1}
                      lines={lines}
                      byeWinners={byeWinners}
                      currentPosition={currentPosition}
                      reduce={reduce}
                    />
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

interface CellProps {
  round: number
  slotIndex: number
  lines: (PublicRevealStep | undefined)[]
  byeWinners: (ByeWinner | null)[]
  currentPosition: number | null
  reduce: boolean
}
// Each cell flexes to fill its match (capped, so a small field's lines don't balloon) and the slot fills
// the cell — the frame the round-1 reveal, the byes, and the feeders all share so the column never
// overflows.
const FRAME = 'flex min-h-0 max-h-14 flex-1'

// One bracket slot. Round 1 plays the revealed line (a player, a bye, or a „?" not yet drawn); round 2
// shows a bye winner already advanced; everything deeper is an undecided feeder („?"). The round-1 line
// at the focus position carries the highlight and the `motion` reveal that the announce band mirrors.
const Cell = ({ round, slotIndex, lines, byeWinners, currentPosition, reduce }: CellProps) => {
  if (round === 1) {
    const step = lines[slotIndex]
    if (!step)
      return (
        <div className={FRAME}>
          <Tbd />
        </div>
      )
    const isCurrent = slotIndex === currentPosition
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.82, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        // Delayed so the announce band's big name lands first, then this line fills in behind it.
        transition={{ duration: reduce ? 0 : 0.4, ease: EASE, delay: reduce ? 0 : 0.42 }}
        className={cn(
          FRAME,
          'rounded-lg transition-shadow duration-500',
          // The signature: the just-drawn line is „marked" in neon (the slot fills neon), ringed in navy.
          isCurrent && 'shadow-[0_0_34px_-6px_rgba(206,255,0,0.95)] ring-2 ring-[#0c1e3a]'
        )}
      >
        {step.kind === 'bye' ? (
          <Bye active={isCurrent} />
        ) : (
          <PlayerSlot player={step.player} seed={step.seed} active={isCurrent} />
        )}
      </motion.div>
    )
  }

  const winner = round === 2 ? byeWinners[slotIndex] : null
  return <div className={FRAME}>{winner ? <PlayerSlot player={winner.player} seed={winner.seed} /> : <Tbd />}</div>
}

const Tbd = () => (
  <div className="flex h-full min-h-0 w-full items-center justify-center rounded-lg border-2 border-dashed border-[#0c1e3a]/20 text-lg font-bold text-[#0c1e3a]/30">
    ?
  </div>
)

// `active` is the focus line — the one the announce band is naming — given the neon „marker" fill.
interface ActiveProps {
  active?: boolean
}
const Bye = ({ active }: ActiveProps) => (
  <div
    className={cn(
      'flex h-full min-h-0 w-full items-center justify-center rounded-lg border-2 border-dashed text-xs font-semibold tracking-wide',
      active
        ? 'border-[#0c1e3a] bg-[#ceff00] text-[#0c1e3a]'
        : 'border-[#0c1e3a]/20 bg-[#0c1e3a]/[0.03] text-[#0c1e3a]/45'
    )}
  >
    Freilos
  </div>
)

interface PlayerSlotProps {
  player: PlayerDisplay | null
  seed: number | null
  active?: boolean
}
const PlayerSlot = ({ player, seed, active }: PlayerSlotProps) => (
  <div
    className={cn(
      'flex h-full min-h-0 w-full items-center gap-2.5 rounded-lg border-[1.5px] bg-white px-3 text-[#0c1e3a]',
      active ? 'border-[#0c1e3a] bg-[#ceff00]' : seed !== null ? 'border-[#0c1e3a]/70' : 'border-[#0c1e3a]/15'
    )}
  >
    {seed !== null && (
      <span
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0c1e3a] text-[11px] font-bold text-white tabular-nums"
        title={`An ${seed} gesetzt`}
      >
        {seed}
      </span>
    )}
    <span className="flex-1 truncate text-base font-bold">{player ? playerName(player) : '—'}</span>
    {player && (
      // LK is data — blue — except on the neon marker, where navy keeps it legible.
      <span
        className={cn('shrink-0 text-xs font-semibold tabular-nums', active ? 'text-[#0c1e3a]/70' : 'text-[#199cf9]')}
      >
        {player.lk ? `LK ${player.lk}` : 'LK folgt'}
      </span>
    )}
  </div>
)
