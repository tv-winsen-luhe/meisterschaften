import {
  type HardViolation,
  SCHEDULE,
  socialMixerBlockTime,
  type SocialMixerBlock,
  type SoftViolation
} from '../../../shared'
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
  if (v.rule === 'player-overlap') return 'Ein Spieler stünde zur selben Zeit in einem anderen Match.'
  return 'Die Runden-Reihenfolge stimmt nicht — dieses Match hängt von einem anderen ab.'
}

// „4, 5 und 6" — the reserved courts read as German prose rather than a bare array. Off the resolved
// block, so the sentence names the courts the head-count actually earned (ADR-0064).
const courtList = (block: SocialMixerBlock) => block.courts.join(', ').replace(/, (\d+)$/, ' und $1')

// The block is passed in because the warning names its time and courts, and both move: the operator may
// relocate the block and its courts follow the confirmed entries. Only a placement *into* a block raises
// this violation, so `null` here is unreachable in practice — it degrades to the reason without the
// specifics rather than inventing a time.
const softReason = (v: SoftViolation, socialMixerBlock: SocialMixerBlock | null): string => {
  if (v.rule === 'player-load') return `Ein Spieler hätte ${v.count} Matches an diesem Tag (mehr als 2).`
  if (v.rule === 'short-rest')
    return `Ein Spieler hätte weniger als ${SCHEDULE.minRestMinutes} Minuten Pause zwischen zwei Matches.`
  if (v.rule === 'social-mixer-block')
    return socialMixerBlock
      ? `Für das Damen Doppel reserviert (${socialMixerBlockTime(socialMixerBlock)} Uhr, Platz ${courtList(socialMixerBlock)}).`
      : 'Für das Damen Doppel reserviert.'
  return 'Halbfinale und Finale gehören auf den Finaltag (Sonntag).'
}

// Distinct reasons, in input order — two feeders can each block a drop with the same sentence.
const reasons = <V,>(violations: V[], toReason: (v: V) => string): string[] => [...new Set(violations.map(toReason))]

// The single line a blocked drop toasts — every distinct hard reason, joined.
export const hardBlockMessage = (hard: HardViolation[]): string => reasons(hard, hardReason).join(' ')

interface SoftWarningDialogProps {
  // The soft warnings to confirm past, or null when no drop is pending.
  soft: SoftViolation[] | null
  // The mixer's resolved block, whose time and courts the reservation warning names (ADR-0064).
  socialMixerBlock: SocialMixerBlock | null
  onConfirm: () => void
  onCancel: () => void
}

// The soft-warning override (ADR-0033): the placement is sound but unwise, so the operator — not the
// system — decides. Confirm places it; cancel leaves the match in hand for another cell.
export const SoftWarningDialog = ({ soft, socialMixerBlock, onConfirm, onCancel }: SoftWarningDialogProps) => (
  <AlertDialog open={soft !== null} onOpenChange={open => !open && onCancel()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Trotzdem platzieren?</AlertDialogTitle>
        <AlertDialogDescription>Diese Platzierung ist möglich, aber nicht ideal:</AlertDialogDescription>
      </AlertDialogHeader>
      {soft && (
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          {reasons(soft, v => softReason(v, socialMixerBlock)).map(reason => (
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
