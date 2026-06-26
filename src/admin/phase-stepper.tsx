import { Fragment, useState } from 'react'
import { Check } from 'lucide-react'
import { PHASES, type Phase } from '../../shared'
import { cn } from '@/admin/lib/utils'
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

// The German display names for the operator-controlled phase (ADR-0006). English identifiers on
// the wire (shared/phase.ts); these are the only place the phase is named for the operator, so the
// shell's toast imports them from here rather than keeping a second copy.
export const PHASE_LABELS: Record<Phase, string> = {
  signup: 'Anmeldung',
  draw: 'Auslosung',
  live: 'Live',
  'post-event': 'Post-Event'
}

interface PhaseStepperProps {
  phase: Phase | null
  onChange: (next: Phase) => void
}

// The global phase header (ADR-0019): it both shows where the event stands and sets it. Phases
// before the current one read as done (check), the current one is highlighted, the rest are
// upcoming. Every change — forward or back — goes through an alert-dialog that names the
// consequence (leaving Anmeldung freezes the Setzung and ends the weekly nuLiga sync, ADR-0010),
// because a misclick has event-wide reach. The phase does not gate the sidebar (ADR-0019).
export const PhaseStepper = ({ phase, onChange }: PhaseStepperProps) => {
  const [pending, setPending] = useState<Phase | null>(null)
  const currentIndex = phase ? PHASES.indexOf(phase) : -1

  const confirmChange = () => {
    if (pending) onChange(pending)
    setPending(null)
  }

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
              Die Phase bestimmt, was öffentlich sichtbar ist. Mit dem Verlassen der Anmeldung wird die Setzung
              eingefroren und die wöchentliche nuLiga-Synchronisierung (LK-Aktualisierung) beendet. Dieser Schritt
              sollte bewusst erfolgen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange}>Phase ändern</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
