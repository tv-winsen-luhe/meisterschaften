import { useState } from 'react'
import { CloudRain, Play } from 'lucide-react'
import { formatResumeTime, type PlaySuspension } from '../../shared'
import { cn } from '@/admin/lib/utils'
import { Button } from '@/admin/ui/button'
import { RESUME_OFFSETS_MINUTES } from './use-play-suspension'

// The Play suspension's switch (ADR-0078 rule 8), in the **admin shell** rather than on a surface.
//
// The context is one person, one phone, rain — and both requirements point the same way: switching it on
// must be one tap from anywhere, and the on-state must be **loud wherever the operator looks**, which is
// ADR-0041's posture for the forgotten publish. It is deliberately *not* beside the phase stepper's two
// transitions: a suspension is not a phase, and standing it there invites exactly that confusion.
//
// The German here is the operator's, not the public's — the band's copy is `suspensionNotice`'s and is
// never restated in this file.

interface SuspensionSwitchProps {
  suspension: PlaySuspension
  onSuspend: (inMinutes: number | null) => Promise<boolean>
  onResume: () => Promise<boolean>
  /** Only meaningful during the tournament; hidden otherwise, since there is no play to suspend. */
  visible: boolean
}

export const SuspensionSwitch = ({ suspension, onSuspend, onResume, visible }: SuspensionSwitchProps) => {
  // The offsets fold out on demand rather than sitting in the bar: suspending is the rare act, and four
  // buttons permanently in a header the operator reads all weekend is four buttons of noise.
  const [open, setOpen] = useState(false)
  if (!visible) return null

  const choose = async (minutes: number | null) => {
    setOpen(false)
    await onSuspend(minutes)
  }

  if (suspension.suspended) {
    // The loud state. It names what the public is being told — including the resume time going stale, which
    // is the moment the operator most needs to act — and offers the one act that ends it.
    const resume =
      suspension.resumesAt !== null && suspension.resumesAt > Date.now()
        ? `weiter ca. ${formatResumeTime(suspension.resumesAt)} Uhr`
        : 'ohne Zeitangabe'
    return (
      <div className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-1.5 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <CloudRain className="size-4 shrink-0" aria-hidden />
        <span className="text-sm font-semibold">Spielbetrieb unterbrochen</span>
        <span className="text-xs opacity-80">({resume})</span>
        <Button size="sm" variant="secondary" onClick={() => void onResume()}>
          <Play className="size-3.5" aria-hidden />
          Weiter
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="Spielbetrieb unterbrechen"
      >
        <CloudRain className="size-4" aria-hidden />
        Unterbrechen
      </Button>
      <div className={cn('flex items-center gap-1', !open && 'hidden')}>
        {RESUME_OFFSETS_MINUTES.map(m => (
          <Button key={m} size="sm" variant="outline" onClick={() => void choose(m)}>
            +{m}
          </Button>
        ))}
        {/* The honest option, and not a lesser one: on a wet Saturday nobody knows when it resumes, and a
            forced guess would be published as „weiter ca. …" to the whole grounds. */}
        <Button size="sm" variant="outline" onClick={() => void choose(null)}>
          offen
        </Button>
      </div>
    </div>
  )
}
