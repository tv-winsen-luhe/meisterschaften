import { ArrowRight, LayoutDashboard, TriangleAlert } from 'lucide-react'
import {
  type AdminRegistration,
  byeCount,
  COMPETITION_SLUGS,
  type CompetitionSlug,
  CLUBS,
  type CourtBudgetProjection,
  courtBudgetProjection,
  drawSize,
  isActive,
  matchCount
} from '../../../shared'
import { courtSchedule, freizeitReservedSlots, matchSlotsPerWeekend } from '@/data/tournament'
import { cn } from '@/admin/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { CLUB_LOGOS, competitionCapacity, competitionLabel } from './registration-detail'
import { RecentSignups } from './recent-signups'

// The competitions in story order (Herren, Herren Challenger, Damen) — COMPETITION_SLUGS already
// carries them in that order. Label and capacity come from the tournament content model (via the
// shared helpers) so the overview never re-states what tournament.ts already owns.
const FIELDS = COMPETITION_SLUGS.map(slug => ({
  slug,
  label: competitionLabel(slug),
  capacity: competitionCapacity(slug)
}))

interface OverviewSurfaceProps {
  registrations: AdminRegistration[]
  // Jump to registrations pre-filtered to "new" — the one job the signup phase demands.
  onGoToNew: () => void
  // Jump to registrations pre-filtered to one competition (the clickable cards).
  onGoToCompetition: (slug: CompetitionSlug) => void
  // Open one registration's detail (the clickable "recent registrations" rows).
  onOpenRegistration: (reg: AdminRegistration) => void
}

// The overview surface (ADR-0019, redesigned in ADR-0023): the at-a-glance dashboard the operator
// lands on. A thin summary line (with a clickable "new" that opens the triage queue) over one card
// per competition — status breakdown, projected draw, club split, fill. Small N (ADR-0021): the
// set is three fields, so it favours a glance over scale, and the content sits in a measured,
// centered column (ADR-0023) rather than sprawling full-bleed. Semantic status colour (amber = neu,
// green = bestätigt, red = abgemeldet) is the only colour, the carve-out from ADR-0016 (ADR-0019).
export const OverviewSurface = ({
  registrations,
  onGoToNew,
  onGoToCompetition,
  onOpenRegistration
}: OverviewSurfaceProps) => {
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

  // Per-field tallies, derived from the same admin list (no new endpoint). Active = new + confirmed
  // — who is still in — which is also the population the club split counts.
  const rows = FIELDS.map(field => {
    const inField = registrations.filter(r => r.competition === field.slug)
    const confirmed = inField.filter(r => r.status === 'confirmed').length
    const active = inField.filter(r => isActive(r.status))
    return {
      ...field,
      new: inField.filter(r => r.status === 'new').length,
      confirmed,
      cancelled: inField.filter(r => r.status === 'cancelled').length,
      byClub: CLUBS.map(c => active.filter(r => r.club === c).length)
    }
  })
  const totals = {
    active: rows.reduce((s, r) => s + r.new + r.confirmed, 0),
    new: rows.reduce((s, r) => s + r.new, 0),
    confirmed: rows.reduce((s, r) => s + r.confirmed, 0)
  }

  // The planning cockpit's court-load projection (ADR-0023 follow-up, ADR-0043). The decision math —
  // live vs full-fill load against the shared budget, and the two overbooking flags — lives in the
  // shared, tested `courtBudgetProjection`, so the gauge never re-derives it. A field's load is its
  // match count *clamped to capacity*: the cut (ADR-0043) leaves the surplus as reserves, who run no
  // bracket matches, so an over-subscribed field reads at its cap, not at a phantom over-full count.
  const planFields = rows.map(r => ({ active: r.new + r.confirmed, capacity: r.capacity ?? 0 }))
  const projection = courtBudgetProjection(planFields, freizeitReservedSlots, matchSlotsPerWeekend)
  // Per-field court-slot consumption for the planning breakdown: load now (clamped) vs at the cap —
  // the "if it fills" figure. Same clamp as the projection, so the rows always sum to its total.
  const fieldLoads = rows.map(r => ({
    label: r.label,
    load: matchCount(Math.min(r.new + r.confirmed, r.capacity ?? 0)),
    capacityLoad: matchCount(r.capacity ?? 0)
  }))

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* Overview header (ADR-0023): the global status counts and the Gesamtauslastung grouped in
            one grounded panel rather than floating loose above the cards. "Neu" is clickable when the
            queue has entries, opening Anmeldungen filtered to Neu (the one-click triage). */}
        <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Summary label="Aktiv" value={totals.active} />
            {totals.new > 0 ? (
              <button
                type="button"
                onClick={onGoToNew}
                className="group -my-1 -ml-1 inline-flex items-center gap-2 rounded-md py-1 pr-1 pl-1 transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                title="Neue Anmeldungen bestätigen"
              >
                <Summary label="Neu" value={totals.new} dot="bg-amber-500" emphasis />
                <ArrowRight className="size-4 text-amber-600 transition-transform group-hover:translate-x-0.5" />
              </button>
            ) : (
              <Summary label="Neu" value={0} />
            )}
            <Summary label="Bestätigt" value={totals.confirmed} dot="bg-emerald-500" />
          </div>
          <div className="border-t border-dashed" />
          <CourtLoad projection={projection} fields={fieldLoads} />
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(row => {
            const size = drawSize(row.confirmed)
            const byes = byeCount(row.confirmed)
            const drawText = size === 0 ? null : byes > 0 ? `${size}er-Feld · ${byes} FL` : `${size}er-Feld`
            return (
              <button
                key={row.slug}
                type="button"
                onClick={() => onGoToCompetition(row.slug)}
                title={`${row.label} in den Anmeldungen öffnen`}
                className="group bg-card hover:bg-accent/40 flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {/* Title + projected draw badge — the field's structural label. */}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{row.label}</span>
                  <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                    {drawText && <span className="bg-muted rounded px-1.5 py-0.5 tabular-nums">{drawText}</span>}
                    <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>

                {/* Hero — the dominant metric: how full the field is toward capacity (ADR-0023). */}
                <Hero confirmed={row.confirmed} capacity={row.capacity} pending={row.new} />

                {/* Quiet subline: the actionable "neu" (amber when waiting) and the club split. */}
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5',
                      row.new > 0 ? 'text-amber-900' : 'text-muted-foreground'
                    )}
                  >
                    <span
                      className={cn('size-1.5 rounded-full', row.new > 0 ? 'bg-amber-500' : 'bg-muted-foreground/40')}
                      aria-hidden
                    />
                    <span className="font-semibold tabular-nums">{row.new}</span> neu
                  </span>
                  <span className="text-muted-foreground flex items-center gap-3 text-xs tabular-nums">
                    {CLUBS.map((c, i) => (
                      <span key={c} className="inline-flex items-center gap-1" title={c}>
                        <img src={CLUB_LOGOS[c]} alt={c} className="size-4 object-contain" width={16} height={16} />
                        {row.byClub[i]}
                      </span>
                    ))}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        <RecentSignups registrations={registrations} onOpen={onOpenRegistration} />
      </div>
    </div>
  )
}

interface SummaryProps {
  label: string
  value: number
  dot?: string
  // The clickable "Neu" reads stronger than the calm counts beside it.
  emphasis?: boolean
}
const Summary = ({ label, value, dot, emphasis }: SummaryProps) => (
  <span className="inline-flex items-baseline gap-2">
    {dot && <span className={cn('size-1.5 translate-y-[-1px] rounded-full', dot)} aria-hidden />}
    <span className={cn('text-lg tabular-nums', emphasis ? 'font-bold text-amber-900' : 'font-semibold')}>{value}</span>
    <span className="text-muted-foreground text-sm">{label}</span>
  </span>
)

interface CourtLoadProps {
  // The court-budget projection (shared, tested): live vs full-fill load, the two pressure totals and
  // the overbooking flags. The gauge renders it; it owns no budget math (ADR-0043).
  projection: CourtBudgetProjection
  // Per-field court-slot consumption: load now vs at the field's cap — the planning breakdown.
  fields: { label: string; load: number; capacityLoad: number }[]
}
// The Gesamtauslastung gauge + planning cockpit (ADR-0023 follow-up, ADR-0043): weekend court pressure
// as two stacked segments — the live championship load (solid) and the reserved Damen-Freizeit block
// (striped, provisional) — against the 72-slot budget. The marker sits where a full field plus the
// reservation would land, so the operator sees whether the weekend still fits if every field fills to
// its cap. Beneath it, the per-field slot breakdown shows where the load sits and which cap drives it —
// the lever the operator adjusts (the soft `capacity` constants in tournament.ts). The figure turns red
// when the live load already bursts the budget; the marker reddens and an overbooking warning appears
// when a *full* field would (the planning signal, distinct from the live one).
const CourtLoad = ({ projection, fields }: CourtLoadProps) => {
  const { load, fullLoad, reserved, budget, used, projected, over, projectedOver } = projection
  const pct = Math.round((used / budget) * 100)
  const seg = (v: number) => `${Math.max(0, Math.min(100, (v / budget) * 100))}%`
  const fullMark = Math.min(100, (projected / budget) * 100)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">Platzauslastung</h2>
        <span className="text-sm tabular-nums">
          <span className={cn('font-semibold', over && 'text-red-600')}>{used}</span>
          <span className="text-muted-foreground">
            {' '}
            / {budget} Slots · {pct}%
          </span>
        </span>
      </div>
      <div className="bg-muted relative h-2 w-full overflow-hidden rounded-full">
        <div
          className={cn('absolute inset-y-0 left-0', over ? 'bg-red-500' : 'bg-foreground')}
          style={{ width: seg(load) }}
        />
        {/* Reserved Freizeit block — striped to read as provisional, not yet booked matches. */}
        <div
          className="absolute inset-y-0"
          style={{
            left: seg(load),
            width: seg(reserved),
            backgroundImage: 'repeating-linear-gradient(45deg, var(--color-foreground) 0 2px, transparent 2px 5px)',
            opacity: 0.5
          }}
          aria-hidden
        />
        {/* Full-fill marker — where a full field + the reservation would land; red once that overbooks. */}
        <div
          className={cn('absolute inset-y-0 w-px', projectedOver ? 'bg-red-500' : 'bg-foreground/40')}
          style={{ left: `${fullMark}%` }}
          aria-hidden
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Championship {load} (voll ≈ {fullLoad}) · Damen Freizeit ~{reserved} reserviert (Format offen)
      </p>

      {/* Per-field court-slot breakdown — current load vs the field's limit, so the operator sees which
          cap drives the budget and where the headroom is (ADR-0043). Slots, not players: the cards
          above already carry the registration fill; this is the court-load split. */}
      <dl className="mt-1 flex flex-col gap-1 border-t border-dashed pt-2">
        {fields.map(f => (
          <div key={f.label} className="flex items-baseline justify-between gap-2 text-xs">
            <dt className="text-muted-foreground truncate">{f.label}</dt>
            <dd className="tabular-nums">
              <span className="text-foreground font-medium">{f.load}</span>
              <span className="text-muted-foreground"> / {f.capacityLoad} Slots</span>
            </dd>
          </div>
        ))}
      </dl>

      {projectedOver && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-red-700">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span>
            Bei voller Auslastung {projected} Slots — über dem Budget ({budget}). Feld-Limits in tournament.ts senken.
          </span>
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        {courtSchedule.courts} Plätze · {courtSchedule.matchMinutes} min · Sa+So
      </p>
    </div>
  )
}

interface HeroProps {
  confirmed: number
  pending: number
  capacity: number | undefined
}
// The card's dominant metric (ADR-0023): the confirmed count toward capacity as a big figure, with
// the fill bar beneath it — bestätigt solid + neu as a lighter segment. Over-capacity is revealed
// (the bar runs to the larger total and a red marker shows where the cap sits) rather than clamped,
// so an over-subscribed field looks different from an exactly-full one (ADR-0019). When the field
// has no capacity, the hero degrades to a plain confirmed count.
const Hero = ({ confirmed, pending, capacity }: HeroProps) => {
  if (!capacity) {
    return (
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl leading-none font-bold tabular-nums">{confirmed}</span>
        <span className="text-muted-foreground text-sm">bestätigt</span>
      </div>
    )
  }
  const total = confirmed + pending
  const over = total > capacity
  const denom = over ? total : capacity
  const cw = (confirmed / denom) * 100
  const pw = (pending / denom) * 100
  const capMark = over ? (capacity / denom) * 100 : 100
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-1.5">
        <span className={cn('text-3xl leading-none font-bold tabular-nums', over && 'text-red-600')}>{confirmed}</span>
        <span className="text-muted-foreground text-lg tabular-nums">/ {capacity}</span>
        <span className="text-muted-foreground ml-1 text-sm">bestätigt</span>
      </div>
      <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full">
        <div className="bg-foreground absolute inset-y-0 left-0 rounded-full" style={{ width: `${cw}%` }} />
        <div className="bg-foreground/30 absolute inset-y-0" style={{ left: `${cw}%`, width: `${pw}%` }} />
        {over && <div className="absolute inset-y-0 w-px bg-red-500" style={{ left: `${capMark}%` }} aria-hidden />}
      </div>
    </div>
  )
}
