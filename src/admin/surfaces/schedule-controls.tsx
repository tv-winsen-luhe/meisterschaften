import { useState } from 'react'
import { CalendarClock, CheckCircle2, RotateCcw, Sparkles } from 'lucide-react'
import {
  DAY_INDICES,
  slotTime,
  socialMixerStartSlots,
  type SocialMixerBlock,
  type SocialMixerPlacement
} from '../../../shared'
import { socialMixerWhenAndWhere, tournament } from '@/data/tournament'
import { NativeSelect } from '@/admin/ui/native-select'
import { Label } from '@/admin/ui/label'
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
import { Button } from '@/admin/ui/button'

// The schedule-lifecycle controls (ADR-0041): auto-suggest, publish, and reset, kept beside the grid. The
// surface (schedule-surface.tsx) owns the state and the server calls. „Veröffentlichen" reveals the whole
// plan at once; once published a „Veröffentlicht" marker replaces the button — there is no manual
// unpublish, only „Zurücksetzen" flips it back. Reset is confirm-guarded, and the confirm *escalates* its
// warning when a match is already running/done (the public plan goes dark until re-published, but those
// matches keep their court — reset only un-places `planned` ones). Publishing with a non-empty backlog is
// likewise confirm-guarded, naming the unplaced count — a client-side warn only (#156, ADR-0041); the
// server publish endpoint stays ungated so a genuinely unplaceable match can never become unpublishable.

interface ScheduleControlsProps {
  published: boolean
  // How many matches are still in the „Nicht geplant" backlog. Non-zero shows the „Vorschlag" button and
  // turns „Veröffentlichen" into a confirm that names the count (#156); zero keeps publish a single click.
  backlogCount: number
  suggesting: boolean
  // Whether any match is already running/done — escalates the reset confirm copy (ADR-0041).
  hasLiveMatches: boolean
  onSuggest: () => void
  onPublish: () => void
  onReset: () => void
}

export const ScheduleControls = ({
  published,
  backlogCount,
  suggesting,
  hasLiveMatches,
  onSuggest,
  onPublish,
  onReset
}: ScheduleControlsProps) => (
  <div className="flex flex-wrap items-center justify-end gap-2">
    {backlogCount > 0 && (
      <Button size="sm" variant="outline" disabled={suggesting} onClick={onSuggest}>
        <Sparkles className="size-4" />
        Vorschlag
      </Button>
    )}

    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <RotateCcw className="size-4" />
          Zurücksetzen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Spielplan zurücksetzen?</AlertDialogTitle>
          <AlertDialogDescription>
            {hasLiveMatches
              ? 'Achtung: Es laufen oder liefen bereits Matches. Alle geplanten Ansetzungen wandern zurück in den Pool und der öffentliche Spielplan wird wieder verborgen — laufende und beendete Matches behalten ihren Platz. Auslosung, Tableaus und Ergebnisse bleiben erhalten.'
              : 'Alle Ansetzungen wandern zurück in den Pool und der öffentliche Spielplan wird wieder verborgen. Auslosung, Tableaus und Ergebnisse bleiben erhalten.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={onReset}>Zurücksetzen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {published ? (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700">
        <CheckCircle2 className="size-4" />
        Veröffentlicht
      </span>
    ) : backlogCount > 0 ? (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm">Veröffentlichen</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Spielplan veröffentlichen?</AlertDialogTitle>
            <AlertDialogDescription>
              {backlogCount === 1
                ? '1 Match ist noch nicht geplant — trotzdem veröffentlichen?'
                : `${backlogCount} Matches sind noch nicht geplant — trotzdem veröffentlichen?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={onPublish}>Veröffentlichen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ) : (
      <Button size="sm" onClick={onPublish}>
        Veröffentlichen
      </Button>
    )}
  </div>
)

interface MixerBlockDialogProps {
  // The block as it stands — the sentence the button summarises and the courts the head-count earned.
  block: SocialMixerBlock
  // The stored placement the two selects edit.
  placement: SocialMixerPlacement
  // The mixer's confirmed entries, stated in the dialog: the court count follows it, and a shading that
  // moves on its own would otherwise read as a bug (ADR-0064).
  confirmed: number
  // How many placed matches a candidate placement would put inside the block — stated before the move, so
  // the soft warnings that follow are not a surprise. The move itself is never refused (ADR-0033).
  affectedCount: (placement: SocialMixerPlacement) => number
  onMove: (placement: SocialMixerPlacement) => Promise<boolean>
}

// The Damen-Doppel block's move dialog (ADR-0064). The block is not a card on the grid — it exists exactly
// once and is never drawn — so it moves through two selects rather than drag-and-drop: the event day and
// the start, offered only at starts whose three hours finish by daylight. Its courts are *not* editable:
// they follow the confirmed head-count, and the dialog says so rather than leaving the operator to notice.
export const MixerBlockDialog = ({ block, placement, confirmed, affectedCount, onMove }: MixerBlockDialogProps) => {
  const [day, setDay] = useState(placement.day)
  const [startSlot, setStartSlot] = useState(placement.startSlot)
  const dirty = day !== placement.day || startSlot !== placement.startSlot
  const affected = affectedCount({ day, startSlot })
  // „4, 5 und 6" — the same German list shape the appointment sentence uses, not a bare join.
  const courts = block.courts.join(', ').replace(/, (\d+)$/, ' und $1')

  // Re-seed the fields from the stored placement whenever the dialog opens, so a cancelled edit does not
  // linger as the next opening's starting point.
  const onOpenChange = (open: boolean) => {
    if (!open) return
    setDay(placement.day)
    setStartSlot(placement.startSlot)
  }

  return (
    <AlertDialog onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarClock className="size-4" />
          Doppel-Block
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Damen-Doppel-Block verschieben</AlertDialogTitle>
          <AlertDialogDescription>
            Aktuell: {socialMixerWhenAndWhere(block)}. Die Plätze folgen der Anmeldezahl —{' '}
            {confirmed === 1 ? '1 bestätigte Anmeldung' : `${confirmed} bestätigte Anmeldungen`} → {block.courts.length}{' '}
            {block.courts.length === 1 ? 'Platz' : 'Plätze'} ({courts}). Die Dauer von drei Stunden ist fest.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mixer-day">Tag</Label>
            <NativeSelect id="mixer-day" value={day} onChange={e => setDay(Number(e.target.value))}>
              {DAY_INDICES.map(d => (
                <option key={d} value={d}>
                  {[tournament.saturday, tournament.sunday][d]?.weekday ?? `Tag ${d + 1}`}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mixer-start">Beginn</Label>
            <NativeSelect id="mixer-start" value={startSlot} onChange={e => setStartSlot(Number(e.target.value))}>
              {socialMixerStartSlots(day).map(slot => (
                <option key={slot} value={slot}>
                  {slotTime(day, slot)} Uhr
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {affected > 0 && (
          <p className="text-sm text-amber-700">
            {affected === 1 ? '1 Ansetzung läge dann im Block' : `${affected} Ansetzungen lägen dann im Block`} — sie
            werden gewarnt, nicht verhindert.
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction disabled={!dirty} onClick={() => void onMove({ day, startSlot })}>
            Verschieben
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
