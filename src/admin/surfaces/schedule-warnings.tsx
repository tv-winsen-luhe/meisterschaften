import { type HardViolation, type SoftViolation } from '../../../shared'
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

// The operator-facing copy for a placement validation outcome (ADR-0033), kept next to the dialog that
// shows it. The structured violations come from the shared validator; only the German lives here.
const hardReason = (v: HardViolation): string => {
  if (v.rule === 'court-taken') return 'Dieser Platz ist zu dieser Zeit bereits belegt.'
  if (v.rule === 'court-window') return 'Dieser Platz hat um diese Zeit kein Flutlicht — das Match würde zu spät enden.'
  return 'Die Runden-Reihenfolge stimmt nicht — dieses Match hängt von einem anderen ab.'
}

const softReason = (v: SoftViolation): string =>
  v.rule === 'player-load'
    ? `Ein Spieler hätte ${v.count} Matches an diesem Tag (mehr als 2).`
    : 'Ein Spieler spielt zwei Matches direkt nacheinander, ohne Pause.'

// Distinct reasons, in input order — two feeders can each block a drop with the same sentence.
const reasons = <V,>(violations: V[], toReason: (v: V) => string): string[] => [...new Set(violations.map(toReason))]

// The single line a blocked drop toasts — every distinct hard reason, joined.
export const hardBlockMessage = (hard: HardViolation[]): string => reasons(hard, hardReason).join(' ')

interface SoftWarningDialogProps {
  // The soft warnings to confirm past, or null when no drop is pending.
  soft: SoftViolation[] | null
  onConfirm: () => void
  onCancel: () => void
}

// The soft-warning override (ADR-0033): the placement is sound but unwise, so the operator — not the
// system — decides. Confirm places it; cancel leaves the match in hand for another cell.
export const SoftWarningDialog = ({ soft, onConfirm, onCancel }: SoftWarningDialogProps) => (
  <AlertDialog open={soft !== null} onOpenChange={open => !open && onCancel()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Trotzdem platzieren?</AlertDialogTitle>
        <AlertDialogDescription>Diese Platzierung ist möglich, aber nicht ideal:</AlertDialogDescription>
      </AlertDialogHeader>
      {soft && (
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          {reasons(soft, softReason).map(reason => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>Trotzdem platzieren</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)
