import { CheckCircle2, RotateCcw, Sparkles } from 'lucide-react'
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
// matches keep their court — reset only un-places `planned` ones).

interface ScheduleControlsProps {
  published: boolean
  hasBacklog: boolean
  suggesting: boolean
  // Whether any match is already running/done — escalates the reset confirm copy (ADR-0041).
  hasLiveMatches: boolean
  onSuggest: () => void
  onPublish: () => void
  onReset: () => void
}

export const ScheduleControls = ({
  published,
  hasBacklog,
  suggesting,
  hasLiveMatches,
  onSuggest,
  onPublish,
  onReset
}: ScheduleControlsProps) => (
  <div className="flex flex-wrap items-center justify-end gap-2">
    {hasBacklog && (
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
    ) : (
      <Button size="sm" onClick={onPublish}>
        Veröffentlichen
      </Button>
    )}
  </div>
)
