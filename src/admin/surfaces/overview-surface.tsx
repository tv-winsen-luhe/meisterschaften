import { ArrowRight, ClipboardCheck, LayoutDashboard } from 'lucide-react'
import { type AdminRegistration, COMPETITION_SLUGS } from '../../../shared'
import { competitions } from '@/data/tournament'
import { cn } from '@/admin/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { competitionLabel } from './registration-detail'

// The Konkurrenzen in story order (Herren, Herren Challenger, Damen) — COMPETITION_SLUGS already
// carries them in that order. Label and capacity come from the tournament content model (via the
// shared competitionLabel helper) so the Übersicht never re-states what tournament.ts already owns.
const FIELDS = COMPETITION_SLUGS.map(slug => ({
  slug,
  label: competitionLabel(slug),
  capacity: competitions.find(c => c.slug === slug)?.capacity
}))

interface OverviewSurfaceProps {
  registrations: AdminRegistration[]
  // Jump to Anmeldungen pre-filtered to "Neu" — the one job the signup phase demands.
  onGoToNew: () => void
}

// The Übersicht surface (ADR-0019): the at-a-glance dashboard the operator lands on before
// deciding what to work on. It is deliberately thin in V1 — the "neu — zu bestätigen"
// call-to-action, fill per Konkurrenz, and total counts, all derived from the same admin list the
// Anmeldungen surface reads (no new endpoint, no charts). Semantic status colour (amber = neu,
// green = bestätigt, red = abgemeldet) is the only colour, the bounded carve-out from ADR-0016's
// neutral rule recorded in ADR-0019.
export const OverviewSurface = ({ registrations, onGoToNew }: OverviewSurfaceProps) => {
  if (registrations.length === 0) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboard />
          </EmptyMedia>
          <EmptyTitle>Noch keine Anmeldungen</EmptyTitle>
          <EmptyDescription>
            Sobald die erste Anmeldung eingeht, zeigt die Übersicht hier offene Bestätigungen, die Auslastung je
            Konkurrenz und die Gesamtzahlen.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const count = (status: AdminRegistration['status']) => registrations.filter(r => r.status === status).length
  const newCount = count('new')
  const confirmedCount = count('confirmed')
  const cancelledCount = count('cancelled')
  const confirmedIn = (slug: string) =>
    registrations.filter(r => r.status === 'confirmed' && r.competition === slug).length

  // The CTA's calm state must not over-claim: "Alles bestätigt" only fits when something is
  // actually confirmed. With an all-cancelled list (no new, none confirmed) it would read as a
  // healthy field, so that case gets a neutral "keine offenen" message instead.
  const hasNew = newCount > 0
  const ctaTitle = hasNew ? 'neu — zu bestätigen' : confirmedCount > 0 ? 'Alles bestätigt' : 'Keine offenen Anmeldungen'
  const ctaHint = hasNew
    ? 'Triage starten unter „Anmeldungen“.'
    : confirmedCount > 0
      ? 'Keine offenen Bestätigungen.'
      : 'Es liegen keine neuen Anmeldungen vor.'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
      {/* The one job this phase demands: confirm the "Neu" queue. Amber while entries wait (the
          semantic "neu" hue), calm once the queue is clear; either way it opens Anmeldungen. */}
      <button
        type="button"
        onClick={onGoToNew}
        className={cn(
          'group flex items-center gap-4 rounded-xl border p-5 text-left transition-colors',
          hasNew ? 'border-amber-300 bg-amber-50 hover:bg-amber-100' : 'bg-card hover:bg-accent'
        )}
      >
        <span
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-lg',
            hasNew ? 'bg-amber-200 text-amber-900' : 'bg-muted text-muted-foreground'
          )}
        >
          {hasNew ? (
            <span className="font-mono text-2xl font-bold tabular-nums">{newCount}</span>
          ) : (
            <ClipboardCheck className="size-6" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{ctaTitle}</p>
          <p className="text-muted-foreground mt-0.5 text-sm">{ctaHint}</p>
        </div>
        <ArrowRight className="text-muted-foreground size-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </button>

      <section className="flex flex-col gap-2.5">
        <SectionLabel>Auslastung je Konkurrenz</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          {FIELDS.map(field => {
            const filled = confirmedIn(field.slug)
            const pct = field.capacity ? Math.min(100, Math.round((filled / field.capacity) * 100)) : 0
            return (
              <div key={field.slug} className="bg-card rounded-lg border p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{field.label}</span>
                  <span className="text-muted-foreground font-mono text-sm tabular-nums">
                    {filled}
                    {field.capacity ? ` / ${field.capacity}` : ''}
                  </span>
                </div>
                {field.capacity && (
                  <div className="bg-muted mt-2.5 h-1.5 overflow-hidden rounded-full">
                    <div className="bg-foreground h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionLabel>Gesamt</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Gesamt" value={registrations.length} />
          <Stat label="Bestätigt" value={confirmedCount} dot="bg-emerald-500" />
          <Stat label="Abgemeldet" value={cancelledCount} dot="bg-red-500" />
        </div>
      </section>
    </div>
  )
}

interface SectionLabelProps {
  children: React.ReactNode
}
const SectionLabel = ({ children }: SectionLabelProps) => (
  <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">{children}</h2>
)

interface StatProps {
  label: string
  value: number
  // A semantic status hue (ADR-0019), e.g. `bg-emerald-500`; omitted for the neutral total.
  dot?: string
}
const Stat = ({ label, value, dot }: StatProps) => (
  <div className="bg-card flex flex-col gap-1 rounded-lg border px-4 py-3">
    <span className="font-mono text-2xl leading-none font-bold tabular-nums">{value}</span>
    <span className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-medium tracking-[0.1em] uppercase">
      {dot && <span className={cn('size-1.5 rounded-full', dot)} aria-hidden />}
      {label}
    </span>
  </div>
)
