import { Fragment, useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { PHASES, type Phase, type UnderfilledCompetition } from '../../shared'
import { cn } from '@/admin/lib/utils'
import { competitionLabel } from './surfaces/registration-detail'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/admin/ui/alert-dialog'

// The German display names for the operator-controlled phase (ADR-0006, ADR-0027). English
// identifiers on the wire (shared/phase.ts); these are the only place the phase is named for the
// operator, so the shell's toast imports them from here rather than keeping a second copy.
export const PHASE_LABELS: Record<Phase, string> = {
  signup: 'Anmeldung',
  tournament: 'Turnier',
  'post-event': 'Post-Event'
}

interface PhaseStepperProps {
  phase: Phase | null
  onChange: (next: Phase) => void
  // The competitions under their cancellation threshold (ADR-0062), listed in the „Anmeldung schließen"
  // dialog. Pure information: the dialog names them and links to the action, it never cancels one.
  underfilled: UnderfilledCompetition[]
  // Open the competitions surface, where the cancellation lives.
  onGoToCompetitions: () => void
}

// The global phase header (ADR-0019): it both shows where the event stands and sets it. Phases
// before the current one read as done (check), the current one is highlighted, the rest are
// upcoming. Every change — forward or back — goes through an alert-dialog that names the
// consequence (leaving signup freezes the seeding and ends the weekly nuLiga sync, ADR-0010),
// because a misclick has event-wide reach. The phase does not gate the sidebar (ADR-0019).
export const PhaseStepper = ({ phase, onChange, underfilled, onGoToCompetitions }: PhaseStepperProps) => {
  const [pending, setPending] = useState<Phase | null>(null)
  const currentIndex = phase ? PHASES.indexOf(phase) : -1

  const confirmChange = () => {
    if (pending) onChange(pending)
    setPending(null)
  }

  // The consequence of the chosen transition, named in the dialog so the warning describes the
  // actual move (not a single static message). Only two genuine forward transitions exist
  // (ADR-0027): closing signup freezes the seeding; ending the event unlocks the purge —
  // the per-competition draw is no longer a phase. A step backward is flagged as unusual.
  // Backward is a deliberate escape hatch (ADR-0006): it just sets the phase value — the cron
  // re-gates itself and the immutable draw snapshots stand (ADR-0003).
  const consequence = (target: Phase): string => {
    if (currentIndex >= 0 && PHASES.indexOf(target) < currentIndex)
      return 'Rückschritt in eine frühere Phase — nur zur Korrektur eines Versehens. Bereits ausgeloste Konkurrenzen bleiben unverändert.'
    switch (target) {
      case 'tournament':
        return 'Mit dem Verlassen der Anmeldung wird die Setzung eingefroren und die wöchentliche nuLiga-Synchronisierung (LK-Aktualisierung) beendet. Danach werden die Konkurrenzen einzeln ausgelost.'
      case 'post-event':
        return 'Das Turnier ist beendet. Brackets und Spielplan werden schreibgeschützt; die Löschung der Kontaktdaten wird verfügbar.'
      case 'signup':
        return 'Zurück zur Anmeldung.'
    }
  }

  // The cancellation hint (ADR-0062), shown whenever the operator is about to *leave* signup — normally
  // to „Turnier", but the stepper allows the jump straight to „Post-Event" too, and that must not skip
  // the one moment the confirmed count becomes final. The fields under their threshold are named here,
  // where the notice is free and unmissable, and nowhere else. Strictly information: it lists and links,
  // it does not cancel, so the website never runs ahead of a cancellation nobody has spoken yet.
  const showUnderfilled = phase === 'signup' && pending !== null && pending !== 'signup' && underfilled.length > 0

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label="Phase">
      {PHASES.map((p, i) => {
        const done = currentIndex > i
        const current = phase === p
        return (
          <Fragment key={p}>
            {i > 0 && <span className="h-px w-3 shrink-0 bg-border sm:w-6" aria-hidden />}
            <button
              type="button"
              disabled={current}
              aria-current={current ? 'step' : undefined}
              onClick={() => setPending(p)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors',
                'disabled:cursor-default',
                current
                  ? 'border-primary bg-primary text-primary-foreground'
                  : done
                    ? 'text-foreground hover:bg-accent border-border'
                    : 'text-muted-foreground hover:bg-accent border-dashed'
              )}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
                  current ? 'bg-primary-foreground text-primary' : done ? 'bg-foreground text-background' : 'border'
                )}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{PHASE_LABELS[p]}</span>
            </button>
          </Fragment>
        )
      })}

      <AlertDialog open={pending !== null} onOpenChange={open => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Phase auf „{pending ? PHASE_LABELS[pending] : ''}“ ändern?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Phase bestimmt, was öffentlich sichtbar ist. {pending ? consequence(pending) : ''} Dieser Schritt
              sollte bewusst erfolgen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {showUnderfilled && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Zu wenige Anmeldungen</p>
              <ul className="flex flex-col gap-1">
                {underfilled.map(field => (
                  <li key={field.competition} className="flex items-baseline justify-between gap-3">
                    <span>{competitionLabel(field.competition)}</span>
                    <span className="tabular-nums">
                      {field.confirmed} von {field.threshold} bestätigt
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-amber-800">
                Absagen ist ein eigener Schritt: Dieser Dialog sagt nichts ab, er zeigt nur, was zu wenige Anmeldungen
                hat. Die Absage liegt bei den Konkurrenzen — dort erst nach dem Anmeldeschluss.
              </p>
              {/* The link into the cancellation. The competitions surface stays locked during signup („Auslosung
                  startet nach Anmeldeschluss"), so this closes the signup on the way — the same act the dialog's
                  own confirm performs, never the cancellation itself, which stays the operator's separate click. */}
              <button
                type="button"
                onClick={() => {
                  confirmChange()
                  onGoToCompetitions()
                }}
                className="inline-flex items-center gap-1.5 self-start font-medium underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {pending === 'tournament' ? 'Anmeldung schließen' : 'Phase ändern'} und zu den Konkurrenzen
                <ArrowRight className="size-4" />
              </button>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange}>Phase ändern</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
