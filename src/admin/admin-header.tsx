import type { Phase, PlaySuspension, UnderfilledCompetition } from '../../shared'
import { Separator } from '@/admin/ui/separator'
import { SidebarTrigger } from '@/admin/ui/sidebar'
import { PhaseStepper } from './phase-stepper'
import { SuspensionSwitch } from './suspension-switch'

// The admin shell's header bar (ADR-0019): the sidebar trigger hard-left, the phase stepper centred in the
// remaining width (ADR-0023), and the Play suspension's switch hard-right (ADR-0078 rule 8).
//
// Non-sticky, so the registrations filter bar below can pin to the top while a long list scrolls.
//
// The two controls up here are deliberately **not** neighbours in meaning, and the layout says so: the
// stepper performs the event's two global transitions (ADR-0027), the switch states whether play is
// happening at all. Putting the suspension beside „Anmeldung schließen" would read as a third phase.

interface AdminHeaderProps {
  phase: Phase | null
  onChangePhase: (next: Phase) => void
  underfilled: UnderfilledCompetition[]
  onGoToCompetitions: () => void
  suspension: PlaySuspension
  onSuspend: (inMinutes: number | null) => Promise<boolean>
  onResume: () => Promise<boolean>
  onToggleCourt: (court: number) => Promise<boolean>
}

export const AdminHeader = ({
  phase,
  onChangePhase,
  underfilled,
  onGoToCompetitions,
  suspension,
  onSuspend,
  onResume,
  onToggleCourt
}: AdminHeaderProps) => (
  <header className="bg-background flex items-center gap-2 border-b px-4 py-3">
    <SidebarTrigger className="-ml-1" />
    <Separator orientation="vertical" className="mr-1 !h-5" />
    <div className="flex flex-1 justify-center">
      <PhaseStepper
        phase={phase}
        onChange={onChangePhase}
        underfilled={underfilled}
        onGoToCompetitions={onGoToCompetitions}
      />
    </div>
    <SuspensionSwitch
      suspension={suspension}
      onSuspend={onSuspend}
      onResume={onResume}
      onToggleCourt={onToggleCourt}
      visible={phase === 'tournament'}
    />
  </header>
)
