import { useMemo } from 'react'
import { MonitorPlay, Shuffle } from 'lucide-react'
import {
  type AdminRegistration,
  byeCount,
  type CompetitionDraw,
  COMPETITION_SLUGS,
  type CompetitionSlug,
  type ConsolationBlocker,
  CONSOLATION_BLOCKER_REASON,
  consolationBlocker,
  drawBlocker,
  type DrawBlocker,
  DRAW_BLOCKER_REASON,
  drawSize,
  hasConsolationBracket,
  isDrawStageLocked,
  isFullyRevealed,
  isUnseededCompetition,
  type Match,
  type Phase,
  roundLabel
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
  // Enter the full-screen Auslosung for a competition (issue #71): „Jetzt auslosen" starts it, and this
  // re-enters one still running („Auslosung fortsetzen"); the shell takes over the screen for the beamer.
  onStartShow: (competition: CompetitionSlug) => void
  // Draw the consolation bracket for one competition (de: „Nebenrunde auslosen", ADR-0004); resolves to
  // whether it succeeded (the shell toasts + reloads). Enabled only once every first match is decided.
  onDrawConsolation: (competition: CompetitionSlug) => Promise<boolean>
  // True while a consolation draw is in flight, so the triggered card shows a pending button.
  drawingConsolation: CompetitionSlug | null
}

// The competitions surface (ADR-0027): one card per competition with its lifecycle — *nicht ausgelost* →
// *Auslosung läuft* (still revealing) → *ausgelost* (fully revealed — isFullyRevealed). „Jetzt
// auslosen" starts the Auslosung (active once registration is closed — `tournament` — and the field is a
// full, un-drawn bracket, ADR-0025) and jumps straight into the full-screen reveal; while it runs the
// bracket is withheld (no spoiler) and „Auslosung fortsetzen" re-enters it; only when it finishes does the
// bracket show — and it can no longer be re-opened. Names are joined from the admin list the shell holds.
export const CompetitionsSurface = ({
  registrations,
  draws,
  phase,
  onDraw,
  drawingCompetition,
  onStartShow,
  onDrawConsolation,
  drawingConsolation
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

  // The competitions whose consolation bracket is already drawn — so the card shows „Nebenrunde ausgelost"
  // instead of the trigger (the gate's `consolationExists`, ADR-0004).
  const consolationDrawn = useMemo(() => {
    const set = new Set<string>()
    for (const d of draws) if (d.bracket === 'consolation') set.add(d.competition)
    return set
  }, [draws])

  // The pre-draw lock (isDrawStageLocked, see its rationale): in `signup` with nothing drawn the surface
  // shows a calm "not yet" panel instead of cards with disabled „Jetzt auslosen" buttons. `hasDraws` is
  // the main-bracket presence the cards below consume (drawByCompetition), so the gate and the cards can
  // never disagree on "is there a draw". The sidebar keeps the tab enabled (it answers „where am I", not
  // „is it time" — ADR-0019); this panel answers the latter.
  if (isDrawStageLocked(phase, drawByCompetition.size > 0)) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Shuffle />
          </EmptyMedia>
          <EmptyTitle>Auslosung startet nach Anmeldeschluss</EmptyTitle>
          <EmptyDescription>
            Während der Anmeldung wird noch nicht ausgelost. Sobald die Anmeldung geschlossen ist (Phase „Turnier"),
            kann hier jede Konkurrenz ausgelost werden. Bis dahin: Anmeldungen bestätigen, Setzliste prüfen.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (registrations.length === 0) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Shuffle />
          </EmptyMedia>
          <EmptyTitle>Noch nichts auszulosen</EmptyTitle>
          {/* Reached only past signup (the pre-draw lock above owns that message) with no registrations
              yet — so this speaks only to the missing entries, not to a registration close already done. */}
          <EmptyDescription>
            Sobald Anmeldungen bestätigt sind, kann hier jede Konkurrenz ausgelost werden.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // An unseeded field (Social mixer, ADR-0051) is never drawn — signup-only, no bracket — so it is
  // absent from the draw cockpit (the worker's `Unseeded` guard is the fail-closed backstop below it).
  const rows = COMPETITION_SLUGS.filter(slug => !isUnseededCompetition(slug)).map(slug => {
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
                {!row.draw ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    Nicht ausgelost
                  </Badge>
                ) : !isFullyRevealed(row.draw) ? (
                  <Badge className="border-amber-300 bg-amber-50 text-amber-900">Auslosung läuft</Badge>
                ) : (
                  <Badge className="border-emerald-300 bg-emerald-50 text-emerald-900">Ausgelost</Badge>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-sm tabular-nums">
                  {row.confirmed} bestätigt
                  {/* The would-be-draw chip only when the size isn't itself the reason the draw is blocked
                      (too-few / unsupported-size) — otherwise it would advertise a „4er-Feld" next to a
                      disabled „too few" button (ADR-0034). A forming field in signup still shows it. */}
                  {row.size > 0 && row.blocker !== 'too-few' && row.blocker !== 'unsupported-size' && (
                    <>
                      {' · '}
                      {row.size}er-Feld
                      {row.byes > 0 && ` · ${row.byes} FL`}
                    </>
                  )}
                  {row.draw && !isFullyRevealed(row.draw) && ` · ${row.draw.cursor}/${row.draw.total} enthüllt`}
                </span>
                {!row.draw ? (
                  <DrawAction
                    blocker={row.blocker}
                    pending={drawingCompetition === row.slug}
                    onDraw={() => onDraw(row.slug)}
                  />
                ) : !isFullyRevealed(row.draw) ? (
                  // Still running: re-enter the reveal where it stood. Gone once it is fully revealed —
                  // the draw is a one-time act, not a replayable show.
                  <Button size="sm" variant="outline" onClick={() => onStartShow(row.slug)}>
                    <MonitorPlay className="size-4" />
                    Auslosung fortsetzen
                  </Button>
                ) : null}
                {/* The consolation trigger (ADR-0004) surfaces only once the main draw is fully revealed and
                    the field is large enough to carry a Nebenrunde (size ≥ 8) — a 4-field's third-place match
                    is its consolation. Once drawn, a badge replaces the button. */}
                {row.draw &&
                  isFullyRevealed(row.draw) &&
                  hasConsolationBracket(row.draw.size) &&
                  (consolationDrawn.has(row.slug) ? (
                    <Badge className="border-emerald-300 bg-emerald-50 text-emerald-900">Nebenrunde ausgelost</Badge>
                  ) : (
                    <ConsolationAction
                      blocker={consolationBlocker({ size: row.draw.size, matches: row.draw.matches }, false)}
                      pending={drawingConsolation === row.slug}
                      onDraw={() => onDrawConsolation(row.slug)}
                    />
                  ))}
              </div>
            </div>

            {/* The draw *is* the reveal: the bracket appears only once it is fully revealed, so projecting
                the admin while it runs can't spoil it. While it runs, just say so. */}
            {row.draw &&
              (isFullyRevealed(row.draw) ? (
                <Bracket draw={row.draw} nameById={nameById} />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Das Tableau erscheint, sobald die Auslosung abgeschlossen ist.
                </p>
              ))}
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

interface ConsolationActionProps {
  blocker: ConsolationBlocker | null
  pending: boolean
  onDraw: () => void
}
// The „Nebenrunde auslosen" button (ADR-0004). Like „Jetzt auslosen" it carries its disabled reason as a
// native title tooltip — the shared reason the server returns — so affordance and authority can't drift
// (ADR-0011). Until every first match is decided it reads „Erst wenn alle ersten Spiele entschieden sind."
const ConsolationAction = ({ blocker, pending, onDraw }: ConsolationActionProps) => (
  <Button
    size="sm"
    variant="outline"
    onClick={onDraw}
    disabled={blocker !== null || pending}
    title={blocker ? CONSOLATION_BLOCKER_REASON[blocker] : undefined}
  >
    <Shuffle className="size-4" />
    {pending ? 'Lost aus …' : 'Nebenrunde auslosen'}
  </Button>
)

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
