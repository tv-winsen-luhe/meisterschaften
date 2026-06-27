import { useState, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert, Undo2, UserRoundCheck } from 'lucide-react'
import { type CompetitionDraw, type CompetitionSlug } from '../../../shared'
import { Button } from '@/admin/ui/button'
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
import { competitionLabel } from './registration-detail'

interface DebugSurfaceProps {
  // The drawn competitions (main bracket), so undraw is offered only where there is a draw to tear
  // down, and readmit can warn that a draw still stands.
  draws: CompetitionDraw[]
  onUndraw: (competition: CompetitionSlug) => Promise<boolean>
  onReadmit: () => Promise<boolean>
  onBackToSignup: () => Promise<boolean>
}

// The debug-only reset surface (ADR-0029). It exists at all only when the RESET_ENABLED flag is on
// (the shell gates the nav entry on it; the server is the authority). The three levers reverse the
// forward transitions the model otherwise treats as final — so every action is destructive and goes
// through an AlertDialog that names exactly what it tears down. This is not an operator feature; it
// is the rehearsal tool that winds the event back during the pre-launch test phase.
export const DebugSurface = ({ draws, onUndraw, onReadmit, onBackToSignup }: DebugSurfaceProps) => {
  // The undraw list shows the drawn main brackets (what „Jetzt auslosen" produces today). The readmit
  // guard, though, mirrors the server's: it refuses while *any* draw exists across all brackets
  // (drawStore.listDraws), so hasDraws counts every bracket — otherwise the button could be enabled
  // here yet 409 on the server once consolation draws are wired up.
  const drawn = draws.filter(d => d.bracket === 'main')
  const hasDraws = draws.length > 0

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Debug — nur zum Testen</p>
            <p className="text-amber-800">
              Diese Aktionen setzen das Turnier zurück und löschen Daten unwiderruflich. Sie sind nur sichtbar, weil der
              Reset in dieser Umgebung aktiviert ist, und werden vor dem echten Event abgeschaltet.
            </p>
          </div>
        </div>

        {/* Undraw — per competition (reverses „Jetzt auslosen"). */}
        <section className="bg-card flex flex-col gap-4 rounded-xl border p-4">
          <div>
            <h2 className="font-semibold">Auslosung zurücksetzen</h2>
            <p className="text-muted-foreground text-sm">
              Löscht die Auslosung und alle Spiele einer Konkurrenz. Die Konkurrenz kann danach neu ausgelost werden.
            </p>
          </div>
          {hasDraws ? (
            <ul className="flex flex-col gap-2">
              {drawn.map(d => (
                <li key={d.competition} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <span className="text-sm font-medium">{competitionLabel(d.competition)}</span>
                  <ConfirmButton
                    title={`Auslosung „${competitionLabel(d.competition)}“ zurücksetzen?`}
                    description="Die Auslosung und alle Spiele dieser Konkurrenz werden gelöscht. Bereits eingetragene Ergebnisse gehen verloren."
                    confirmLabel="Zurücksetzen"
                    onConfirm={() => onUndraw(d.competition)}
                    variant="outline"
                    size="sm"
                  >
                    <Undo2 className="size-4" />
                    Zurücksetzen
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Keine ausgelosten Konkurrenzen.</p>
          )}
        </section>

        {/* Readmit — global (reverses confirm). Guarded server-side while a draw exists; mirror that
            here as a disabled affordance so the operator sees the reason before clicking. */}
        <section className="bg-card flex flex-col gap-4 rounded-xl border p-4">
          <div>
            <h2 className="font-semibold">Spieler neu zulassen</h2>
            <p className="text-muted-foreground text-sm">
              Setzt alle bestätigten Anmeldungen zurück auf „neu“, sodass jede erneut bestätigt werden muss. Neue und
              abgemeldete Anmeldungen bleiben unverändert.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ConfirmButton
              title="Alle bestätigten Anmeldungen zurück auf „neu“?"
              description="Jede bestätigte Anmeldung muss danach erneut bestätigt werden. Abmeldungen bleiben Abmeldungen."
              confirmLabel="Neu zulassen"
              onConfirm={onReadmit}
              variant="outline"
              size="sm"
              disabled={hasDraws}
            >
              <UserRoundCheck className="size-4" />
              Alle neu zulassen
            </ConfirmButton>
            {hasDraws && <span className="text-muted-foreground text-sm">Erst alle Auslosungen zurücksetzen.</span>}
          </div>
        </section>

        {/* Back to signup — global (reverses the phase, cascading an undraw of all). */}
        <section className="bg-card flex flex-col gap-4 rounded-xl border p-4">
          <div>
            <h2 className="font-semibold">Zurück zur Anmeldung</h2>
            <p className="text-muted-foreground text-sm">
              Setzt die Phase zurück auf „Anmeldung“ und löscht dabei alle Auslosungen. Die Anmeldungen selbst bleiben
              unverändert (bestätigt bleibt bestätigt).
            </p>
          </div>
          <div>
            <ConfirmButton
              title="Zurück zur Anmeldungsphase?"
              description="Alle Auslosungen und Spiele werden gelöscht und die Phase wird auf „Anmeldung“ gesetzt. Die Anmeldungen bleiben erhalten."
              confirmLabel="Zurück zur Anmeldung"
              onConfirm={onBackToSignup}
              variant="outline"
              size="sm"
            >
              <RotateCcw className="size-4" />
              Zurück zur Anmeldung
            </ConfirmButton>
          </div>
        </section>
      </div>
    </div>
  )
}

interface ConfirmButtonProps {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => Promise<boolean>
  children: ReactNode
  variant?: 'outline' | 'destructive'
  size?: 'sm' | 'default'
  disabled?: boolean
}

// A button whose click opens an AlertDialog; the action fires only on confirm. The shell's mutate()
// owns the toast + reload, so onConfirm just performs the request and resolves to its success.
const ConfirmButton = ({
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
  variant = 'outline',
  size = 'sm',
  disabled
}: ConfirmButtonProps) => {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const run = async () => {
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
      setOpen(false)
    }
  }

  return (
    <>
      <Button variant={variant} size={size} disabled={disabled || pending} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <AlertDialog open={open} onOpenChange={o => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Abbrechen</AlertDialogCancel>
            {/* Disabled while in-flight: run() calls preventDefault to keep the dialog open during the
                await, so without this a fast second click would fire the reset twice. */}
            <AlertDialogAction
              disabled={pending}
              onClick={e => {
                e.preventDefault()
                run()
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
