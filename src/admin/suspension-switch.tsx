import { useState } from 'react'
import { CloudRain, Play } from 'lucide-react'
import { COURT_NUMBERS, courtLabel, formatResumeTime, suspensionNotice, type PlaySuspension } from '../../shared'
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
// The German here is the operator's, not the public's — and where this bar quotes the public statement it
// **reads** `suspensionNotice` rather than restating it, so the two cannot drift apart.
//
// It carries **two** controls, and only one of them is always here: the switch, and — while a suspension
// stands — the court chips that release a single court or stop it again (Amendment 2 rule 3), folded out
// behind one button. The resting state is unchanged, which is the point: the common case is that it rains on
// the whole club.

interface SuspensionSwitchProps {
  suspension: PlaySuspension
  onSuspend: (inMinutes: number | null) => Promise<boolean>
  onResume: () => Promise<boolean>
  /** Release one stopped court, or stop a released one again (ADR-0078 Amendment 2 rule 3). */
  onToggleCourt: (court: number) => Promise<boolean>
  /** Only meaningful during the tournament; hidden otherwise, since there is no play to suspend. */
  visible: boolean
}

export const SuspensionSwitch = ({
  suspension,
  onSuspend,
  onResume,
  onToggleCourt,
  visible
}: SuspensionSwitchProps) => {
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
    // **Read from the projection, not restated here.** „What the public is being told" is a claim this bar
    // makes, and since the band names the stopped courts a hardcoded „Spielbetrieb unterbrochen" would
    // assert the whole event is stopped while one court has puddles. The front-door form is the shorter of
    // the two and carries the same headline, so the operator reads the extent rather than inferring it from
    // which chips are filled.
    const headline = suspensionNotice(suspension, Date.now(), 'front-door')?.headline
    const stopped = new Set(suspension.courts)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-100 px-3 py-1.5 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <CloudRain className="size-4 shrink-0" aria-hidden />
        <span className="text-sm font-semibold">{headline}</span>
        <span className="text-xs opacity-80">({resume})</span>
        {/* The court chips (ADR-0078 Amendment 2 rule 3) — the **second** control, and the one the partial
            case needs: court 3 dried while court 4 still has puddles. They fold out on demand, for the same
            reason the offsets below do and one more: „Weiter" is the only control that ends a suspension, and
            six buttons permanently in this row would push it off the edge of the phone the operator is
            holding in the rain. The whole group exists only inside this branch, so the shell's resting state
            is unchanged and the fast path — one tap on „Unterbrechen", meaning „alles unterbrechen" — is not
            taxed to buy this. */}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          title="Einzelne Plätze freigeben oder unterbrechen"
        >
          Plätze
        </Button>
        <span className={cn('flex items-center gap-1', !open && 'hidden')}>
          {COURT_NUMBERS.map(court => (
            <Button
              key={court}
              size="sm"
              variant={stopped.has(court) ? 'default' : 'outline'}
              // A toggle: the name is the thing, the state is `aria-pressed`. Naming the *act* instead
              // („Platz 3 freigeben") would announce „freigeben, pressed" — a label describing what the tap
              // undoes, beside a flag reporting what is true. The tooltip carries the act for the sighted
              // operator, where there is no second channel to contradict.
              aria-pressed={stopped.has(court)}
              aria-label={courtLabel(court)}
              title={stopped.has(court) ? `${courtLabel(court)} freigeben` : `${courtLabel(court)} unterbrechen`}
              onClick={() => void onToggleCourt(court)}
            >
              {court}
            </Button>
          ))}
        </span>
        {/* Filled means stopped, which is the same reading as the band these chips feed. Releasing the last
            stopped court lifts the suspension entirely; that rule lives in `toggleCourt`, so this row states
            it nowhere and cannot state it differently. */}
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
