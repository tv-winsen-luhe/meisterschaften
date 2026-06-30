import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronRight, MonitorX, RotateCw } from 'lucide-react'
import { type CompetitionSlug, type PublicRevealStep } from '../../shared'
import { type RevealRead } from './use-reveal'
import { createReveal } from './reveal-controller'
import { DrawBracket, EASE, playerName } from './draw-bracket'
import { competitionLabel } from './surfaces/registration-detail'

// The large-screen draw show (ADR-0002/0003, issue #71): the operator-paced, beamer-projected reveal of
// one competition's main bracket. It is *pure playback* of the reveal sequence — it reads the operator's
// full reveal (GET /api/admin/draw/reveal, the un-redacted sibling of the off-site bracket's feed, sliced
// to the cursor on the server so the unrevealed tail never reaches the beamer; a Challenger field keeps its
// LK + seed here, ADR-0044) and moves the cursor through the admin advance endpoint. It never re-rolls
// (ADR-0003): a reload re-reads the persisted cursor and resumes where it stood.
//
// It escapes the admin chrome on purpose — a full-screen, high-contrast, large-typography stage so the
// projector reads from across the hall, with a `motion` reveal on each lot and the just-drawn lot held up
// as the focus. The bracket fills in behind it as context; the announce band is the act.

// `back` stays in the wire contract but the show never sends it — the reveal is forward-only (a lot,
// once shown, is shown, and the public bracket mirrors the cursor, so stepping back would un-reveal it).
type Direction = 'forward' | 'back'

interface DrawShowProps {
  competition: CompetitionSlug
  // Read the current reveal for this competition (present / absent / transient error) — the show keeps its
  // last good reveal on a transient error rather than blanking the beamer.
  onLoad: (competition: CompetitionSlug) => Promise<RevealRead>
  // Move the cursor one lot; resolves to whether it took (the show then re-reads to pick up the new lot).
  onAdvance: (competition: CompetitionSlug, direction: Direction) => Promise<boolean>
  onExit: () => void
}

// A thin renderer over the reveal controller (reveal-controller.ts): the controller owns the retry/stale
// read loop, the double-fire guard, and the status reducer; the component binds the competition into the
// controller's two server seams and paints the state it exposes. Resume-on-open and the keydown wiring
// (presenter remote → forward, Escape → exit) are the only React concerns left here.
export const DrawShow = ({ competition, onLoad, onAdvance, onExit }: DrawShowProps) => {
  const reduce = useReducedMotion()
  const reveal = useMemo(
    () => createReveal({ load: () => onLoad(competition), advance: direction => onAdvance(competition, direction) }),
    [competition, onLoad, onAdvance]
  )
  const { phase, draw, current, cursor, total, complete, canAdvance } = useSyncExternalStore(
    reveal.subscribe,
    reveal.getState
  )

  // Resume from the persisted cursor on open (and after a reload) — playback only, never starting the draw.
  useEffect(() => {
    void reveal.refresh()
  }, [reveal])

  // Beamer ergonomics: drive the show from a presenter remote / keyboard — forward on the keys a clicker
  // sends (Right / Space / PageDown), and Escape to leave. The controller's guard makes a held key safe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        void reveal.step()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reveal, onExit])

  if (phase === 'loading') {
    return (
      <Stage>
        <div className="flex flex-1 items-center justify-center text-[#525252]">Lädt …</div>
      </Stage>
    )
  }

  // Nothing to play: a genuinely un-drawn field, or an initial read that never landed (retry available).
  if (!draw) {
    const failed = phase === 'error'
    return (
      <Stage>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="text-xl text-[#0c1e3a]/70">
            {failed ? 'Die Auslosung konnte nicht geladen werden.' : 'Diese Konkurrenz ist noch nicht ausgelost.'}
          </p>
          <div className="flex gap-3">
            {failed && (
              <button
                onClick={() => void reveal.refresh()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0c1e3a] px-5 py-2.5 font-semibold text-white hover:bg-[#0c1e3a]/90"
              >
                <RotateCw className="size-4" />
                Erneut versuchen
              </button>
            )}
            <button
              onClick={onExit}
              className="rounded-lg border border-[#0c1e3a]/25 px-5 py-2.5 font-semibold text-[#0c1e3a] hover:bg-[#0c1e3a]/5"
            >
              Schließen
            </button>
          </div>
        </div>
      </Stage>
    )
  }

  const { size, steps } = draw
  // A stale reveal is the last good one on screen after a failed refresh: paused until it re-reads, so the
  // cursor can't be advanced past a lot the operator never saw. The banner offers the manual re-read; the
  // controller blocks advancing (canAdvance is false) until a clean re-read lands.
  const stale = phase === 'stale'

  return (
    <Stage>
      {/* Top bar: the club mark, which field, how far the reveal stands, and the way out. */}
      <div className="flex items-center justify-between gap-4 border-b border-[#0c1e3a]/10 px-8 py-5">
        <div className="flex items-center gap-4">
          {/* Club branding on the beamer: the full emblem (the navy ring text is decorative at this size). */}
          <img src="/club-logos/tv-winsen.svg" alt="TV Winsen" width={48} height={48} className="size-12 shrink-0" />
          <div className="h-9 w-px bg-[#0c1e3a]/15" />
          <div>
            <div className="text-[11px] font-bold tracking-[0.22em] text-[#c2673b] uppercase">Auslosung</div>
            <div className="text-2xl font-bold text-[#0c1e3a]">{competitionLabel(competition)}</div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-[#0c1e3a]/45 uppercase">
              {complete ? 'Komplett' : 'Schritt'}
            </div>
            <div className="text-2xl font-bold text-[#0c1e3a] tabular-nums">
              {cursor} <span className="text-[#0c1e3a]/35">/ {total}</span>
            </div>
          </div>
          <button
            onClick={onExit}
            className="inline-flex items-center gap-2 rounded-lg border border-[#0c1e3a]/20 px-4 py-2 text-sm font-semibold text-[#0c1e3a]/70 transition-colors hover:bg-[#0c1e3a]/5 hover:text-[#0c1e3a]"
          >
            <MonitorX className="size-4" />
            Beenden
          </button>
        </div>
      </div>

      {/* The announce band — the act, and it leads: the big name lands first, then the bracket line fills in
          behind it (DrawBracket delays its reveal). The previous lot clears with a quick exit so the new
          name comes up cleanly (no two names overlapping), well before the line fills. */}
      <div
        className="relative flex min-h-44 shrink-0 items-center justify-center px-6"
        aria-live="polite"
        aria-atomic="true"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={cursor}
            initial={reduce ? false : { opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduce
                ? { opacity: 0, transition: { duration: 0 } }
                : { opacity: 0, y: -14, scale: 0.98, transition: { duration: 0.14, ease: 'easeIn' } }
            }
            transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
            className="flex flex-col items-center text-center"
          >
            <Announce step={current} cursor={cursor} complete={complete} />
          </motion.div>
        </AnimatePresence>
      </div>

      <DrawBracket size={size} steps={steps} currentPosition={current?.position ?? null} reduce={!!reduce} />

      {/* A stale reveal pauses the controls; the operator re-reads to resync before revealing the next lot. */}
      {stale && (
        <div className="mx-auto mb-1 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
          Anzeige veraltet — Verbindung unterbrochen.
          <button
            onClick={() => void reveal.refresh()}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1 font-semibold text-white hover:bg-amber-600"
          >
            <RotateCw className="size-3.5" />
            Erneut laden
          </button>
        </div>
      )}

      {/* Controls: the operator paces the show one lot at a time — forward only (a revealed lot is
          revealed; the public bracket mirrors the cursor, so there is no stepping back). */}
      <div className="flex items-center justify-center border-t border-[#0c1e3a]/10 px-8 py-6">
        <button
          onClick={() => void reveal.step()}
          disabled={!canAdvance}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0c1e3a] px-8 py-3.5 text-base font-bold text-white transition-colors hover:bg-[#0c1e3a]/90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {complete ? 'Auslosung komplett' : 'Weiter'}
          {!complete && <ChevronRight className="size-5" />}
        </button>
      </div>
    </Stage>
  )
}

interface ChildrenProps {
  children: React.ReactNode
}

// The full-screen stage that replaces the admin chrome while the Auslosung runs — white in the club's
// palette so it stays readable on a beamer in a sunlit hall (a dark stage washes out).
const Stage = ({ children }: ChildrenProps) => (
  <div
    role="dialog"
    aria-label="Auslosung"
    className="fixed inset-0 z-50 flex flex-col bg-white text-[#0c1e3a] select-none"
  >
    {children}
  </div>
)

interface AnnounceProps {
  step: PublicRevealStep | null
  cursor: number
  complete: boolean
}
// The held-up lot, in large type: an eyebrow naming the kind of lot, the name (or „Freilos"), and a sub
// line with the LK and where it landed. Before the first lot it invites the operator to begin.
const Announce = ({ step, cursor, complete }: AnnounceProps) => {
  if (cursor === 0 || !step) {
    return <p className="text-2xl font-semibold text-[#525252]">Bereit — „Weiter“ enthüllt den ersten Schritt.</p>
  }

  const position = step.position + 1 // 1-based for the audience

  if (step.kind === 'bye') {
    // A bye line is empty; if it carries a player (a seed's freed line), name who walks through.
    return step.player ? (
      <>
        <Eyebrow>Freilos</Eyebrow>
        <Name>{playerName(step.player)}</Name>
        <Sub>kommt kampflos eine Runde weiter</Sub>
      </>
    ) : (
      <>
        <Eyebrow>Freilos</Eyebrow>
        <Name>Freilos</Name>
        <Sub>Position {position} bleibt frei</Sub>
      </>
    )
  }

  const seeded = step.kind === 'seed-fixed' || step.kind === 'seed-lot'
  return (
    <>
      <Eyebrow>{seeded ? `Gesetzt · Nr. ${step.seed}` : 'Gezogen'}</Eyebrow>
      <Name>{step.player ? playerName(step.player) : '—'}</Name>
      <Sub>
        {/* LK is data — blue here as in the bracket, so the hero carries the same navy/clay/blue palette. */}
        {step.player?.lk && <span className="text-[#199cf9]">LK {step.player.lk}</span>}
        {step.player?.lk && ' · '}
        {complete ? 'Auslosung komplett' : `Position ${position}`}
      </Sub>
    </>
  )
}

const Eyebrow = ({ children }: ChildrenProps) => (
  <span className="mb-2 text-sm font-bold tracking-[0.22em] text-[#c2673b] uppercase">{children}</span>
)
const Name = ({ children }: ChildrenProps) => (
  <span className="max-w-5xl text-5xl leading-tight font-black text-[#0c1e3a] sm:text-6xl">{children}</span>
)
const Sub = ({ children }: ChildrenProps) => (
  <span className="mt-3 text-lg font-medium text-[#525252] tabular-nums">{children}</span>
)
