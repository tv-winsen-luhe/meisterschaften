import { type AdminRegistration } from '../../../shared'
import { Button } from '@/admin/ui/button'
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

interface DetailActionsProps {
  reg: AdminRegistration
  isConfirmed: boolean
  isCancelled: boolean
  blocked: boolean
  blockedReason: string | null
  onSubmit: () => void
  onCancel: (id: number) => void
  onDelete: (reg: AdminRegistration) => void
}

// The pinned action bar of the detail panel: Bestätigen/Speichern, Absagen, Löschen. Absagen and
// Löschen each own their confirmation AlertDialog (ADR-0019), so the surface's handlers just run the
// mutation. Cancelled rows show only Löschen. Aligned to the panel's measured column (ADR-0023).
export const DetailActions = ({
  reg,
  isConfirmed,
  isCancelled,
  blocked,
  blockedReason,
  onSubmit,
  onCancel,
  onDelete
}: DetailActionsProps) => (
  <div className="bg-background border-t p-4">
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2">
      {!isCancelled && (
        <Button className="max-[560px]:flex-1" disabled={blocked} title={blockedReason ?? undefined} onClick={onSubmit}>
          {isConfirmed ? 'Speichern' : 'Bestätigen'}
        </Button>
      )}
      {!isCancelled && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="max-[560px]:flex-1">
              Absagen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Anmeldung von {reg.firstName} {reg.lastName} absagen?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Der Eintrag wird abgemeldet und aus der öffentlichen Liste sowie der Auslosung entfernt. Eine erneute
                Teilnahme erfolgt über eine neue Anmeldung.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction onClick={() => onCancel(reg.id)}>Absagen</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive ml-auto hover:text-white max-[560px]:flex-1"
            title="Anmeldung dauerhaft löschen"
          >
            Löschen
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Anmeldung von {reg.firstName} {reg.lastName} löschen?
            </AlertDialogTitle>
            <AlertDialogDescription>Dieser Eintrag wird endgültig aus der Datenbank entfernt.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => onDelete(reg)}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </div>
)
