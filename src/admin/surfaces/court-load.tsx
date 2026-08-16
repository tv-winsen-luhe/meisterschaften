import { TriangleAlert } from 'lucide-react'
import type { CourtBudgetProjection } from '../../../shared'
import { courtSchedule } from '@/data/tournament'
import { cn } from '@/admin/lib/utils'

interface CourtLoadProps {
  // The court-budget projection (shared, tested): live vs full-fill load, the two pressure totals and
  // the overbooking flags. The gauge renders it; it owns no budget math (ADR-0043).
  projection: CourtBudgetProjection
  // Per-field court-slot consumption: load now vs at the field's cap — the planning breakdown.
  fields: { label: string; load: number; capacityLoad: number }[]
}
// The Gesamtauslastung gauge + planning cockpit (ADR-0023 follow-up, ADR-0043): weekend court pressure
// as two stacked segments — the live championship load (solid) and the reserved social-mixer block
// (striped, provisional) — against the 72-slot budget. The marker sits where a full field plus the
// reservation would land, so the operator sees whether the weekend still fits if every field fills to
// its cap. Beneath it, the per-field slot breakdown shows where the load sits and which cap drives it —
// the lever the operator adjusts (the soft `capacity` constants in tournament.ts). The figure turns red
// when the live load already bursts the budget; the marker reddens and an overbooking warning appears
// when a *full* field would (the planning signal, distinct from the live one).
export const CourtLoad = ({ projection, fields }: CourtLoadProps) => {
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
        {/* Reserved social-mixer block — striped to read as provisional, not yet booked matches. */}
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
      {/* The reservation half of the line drops once there is nothing reserved — a cancelled mixer
          (ADR-0062) takes its block with it, and „~0 Slots reserviert" would read as a bug. */}
      <p className="text-muted-foreground text-xs">
        Championship {load} (voll ≈ {fullLoad}){reserved > 0 && ` · Damen Doppel ~${reserved} Slots reserviert`}
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
