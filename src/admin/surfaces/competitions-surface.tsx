import { useMemo } from 'react'
import { CalendarX2, MonitorPlay, Shuffle, Undo2 } from 'lucide-react'
import {
  type AdminRegistration,
  byeCount,
  type CompetitionDraw,
  COMPETITION_SLUGS,
  type CompetitionSlug,
  isCancelledCompetition,
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
  type Phase
} from '../../../shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/admin/ui/alert-dialog'
import { Badge } from '@/admin/ui/badge'
import { Button } from '@/admin/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { Bracket } from './competition-bracket'
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
  // The competitions the operator has cancelled (ADR-0062) — read from GET /api/phase, the one signal
  // every surface keys off, so this card marks exactly what the public wire withholds.
  cancelledCompetitions: CompetitionSlug[]
  // Cancel a competition or take the cancellation back. The card owns the confirm dialog (on the cancel
  // only), so this just performs the mutation.
  onSetCancelled: (competition: CompetitionSlug, cancelled: boolean) => void
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
  drawingConsolation,
  cancelledCompetitions,
  onSetCancelled
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

  // Every competition the event offers gets a card — the unseeded Social mixer (ADR-0051) included, even
  // though it is never drawn (no draw controls below): it can still be cancelled, and cancelling it is the
  // case ADR-0062 was written for. The worker's `Unseeded` draw guard stays the fail-closed backstop.
  const rows = COMPETITION_SLUGS.map(slug => {
    const unseeded = isUnseededCompetition(slug)
    const confirmed = registrations.filter(r => r.competition === slug && r.status === 'confirmed').length
    const size = unseeded ? 0 : drawSize(confirmed)
    const byes = byeCount(confirmed)
    const draw = drawByCompetition.get(slug) ?? null
    const cancelled = isCancelledCompetition(cancelledCompetitions, slug)
    // The disabled reason comes from the shared gate the server enforces (ADR-0011) — phase null
    // (not yet loaded) reads as not-yet-tournament, which is the safe "can't draw yet" default. The
    // cancellation goes in as the third input, so a cancelled field's button carries *its* reason
    // („abgesagt"), not the too-few one it usually also trips (ADR-0062).
    const blocker = drawBlocker(phase ?? 'signup', confirmed, cancelled)
    return {
      slug,
      label: competitionLabel(slug),
      capacity: competitionCapacity(slug),
      confirmed,
      size,
      byes,
      draw,
      blocker,
      unseeded,
      cancelled
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
                {/* The cancellation marker (ADR-0062). It sits *beside* the lifecycle badge, not instead
                    of it: the admin is the record, so it keeps saying what the field's draw state is. */}
                {row.cancelled && <Badge className="border-red-300 bg-red-50 text-red-900">Abgesagt</Badge>}
                {row.unseeded ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    Wird nicht ausgelost
                  </Badge>
                ) : !row.draw ? (
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
                  {/* The would-be-draw chip only while a draw is still on the table: not when the size is
                      itself the reason it is blocked (too-few / unsupported-size), which would advertise a
                      „4er-Feld" next to a disabled „too few" button (ADR-0034), and not for a cancelled
                      field, whose draw is off for good (ADR-0062). A forming field in signup still shows
                      it — „not-tournament" is a deadline, not a verdict on the field. */}
                  {row.size > 0 && (row.blocker === null || row.blocker === 'not-tournament') && (
                    <>
                      {' · '}
                      {row.size}er-Feld
                      {row.byes > 0 && ` · ${row.byes} FL`}
                    </>
                  )}
                  {row.draw && !isFullyRevealed(row.draw) && ` · ${row.draw.cursor}/${row.draw.total} enthüllt`}
                </span>
                {/* No draw trigger on an unseeded field — it is never drawn at all (ADR-0051), so an
                    always-disabled button would only add noise. A cancelled field *does* keep the
                    button, disabled with the gate's „abgesagt" reason (ADR-0062): the draw is a step
                    the operator would otherwise expect here, so it says why it is off rather than
                    vanishing. The server refuses it through the same gate. */}
                {row.unseeded ? null : !row.draw ? (
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
                <CancelAction
                  label={row.label}
                  cancelled={row.cancelled}
                  onToggle={next => onSetCancelled(row.slug, next)}
                />
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

interface CancelActionProps {
  label: string
  cancelled: boolean
  onToggle: (cancelled: boolean) => void
}
// „Absagen" / „Absage zurücknehmen" (ADR-0062). The friction sits **only** on the cancel: the expensive
// half of that act is social — the operator telephones everyone in the field — while taking it back
// materializes nothing and costs a click. The competition and its registrations stay visible either way;
// the admin is the record, not the stage.
const CancelAction = ({ label, cancelled, onToggle }: CancelActionProps) =>
  cancelled ? (
    <Button size="sm" variant="outline" onClick={() => onToggle(false)}>
      <Undo2 className="size-4" />
      Absage zurücknehmen
    </Button>
  ) : (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarX2 className="size-4" />
          Absagen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label} absagen?</AlertDialogTitle>
          <AlertDialogDescription>
            Die Konkurrenz verschwindet aus der öffentlichen Teilnehmerliste. Die Anmeldungen bleiben unverändert
            erhalten und hier sichtbar; die Absage bei den Angemeldeten selbst läuft per Anruf. Jederzeit
            zurückzunehmen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={() => onToggle(true)}>Absagen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
