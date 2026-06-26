import { ArrowRight, ClipboardCheck, LayoutDashboard } from 'lucide-react'
import {
  type AdminRegistration,
  byeCount,
  COMPETITION_SLUGS,
  type CompetitionSlug,
  CLUBS,
  drawSize,
  isActive
} from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/admin/ui/table'
import { competitionCapacity, competitionLabel } from './registration-detail'

// The Konkurrenzen in story order (Herren, Herren Challenger, Damen) — COMPETITION_SLUGS already
// carries them in that order. Label and capacity come from the tournament content model (via the
// shared helpers) so the Übersicht never re-states what tournament.ts already owns.
const FIELDS = COMPETITION_SLUGS.map(slug => ({
  slug,
  label: competitionLabel(slug),
  capacity: competitionCapacity(slug)
}))

interface OverviewSurfaceProps {
  registrations: AdminRegistration[]
  // Jump to Anmeldungen pre-filtered to "Neu" — the one job the signup phase demands.
  onGoToNew: () => void
  // Jump to Anmeldungen pre-filtered to one Konkurrenz (the clickable table rows).
  onGoToCompetition: (slug: CompetitionSlug) => void
}

// The Übersicht surface (ADR-0019): the at-a-glance dashboard the operator lands on. The "neu — zu
// bestätigen" call-to-action plus a per-Konkurrenz table (status breakdown, projected Auslosung,
// club split, fill). Small N (ADR-0021): the whole table is three rows, so it favours a glance over
// scale. Semantic status colour (amber = neu, green = bestätigt, red = abgemeldet) is the only
// colour, the bounded carve-out from ADR-0016's neutral rule recorded in ADR-0019.
export const OverviewSurface = ({ registrations, onGoToNew, onGoToCompetition }: OverviewSurfaceProps) => {
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

  const newCount = registrations.filter(r => r.status === 'new').length
  const confirmedCount = registrations.filter(r => r.status === 'confirmed').length

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
    new: rows.reduce((s, r) => s + r.new, 0),
    confirmed: rows.reduce((s, r) => s + r.confirmed, 0),
    cancelled: rows.reduce((s, r) => s + r.cancelled, 0),
    byClub: CLUBS.map((_, i) => rows.reduce((s, r) => s + r.byClub[i], 0))
  }

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
        <SectionLabel>Konkurrenzen</SectionLabel>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Konkurrenz</TableHead>
                <TableHead className="text-right">Neu</TableHead>
                <TableHead className="text-right">Best.</TableHead>
                <TableHead className="text-right">Abgem.</TableHead>
                <TableHead>Auslosung</TableHead>
                <TableHead className="text-right">TV / TSV</TableHead>
                <TableHead className="w-[200px]">Auslastung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const size = drawSize(row.confirmed)
                const byes = byeCount(row.confirmed)
                return (
                  <TableRow
                    key={row.slug}
                    role="button"
                    tabIndex={0}
                    onClick={() => onGoToCompetition(row.slug)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onGoToCompetition(row.slug)
                      }
                    }}
                    className="cursor-pointer"
                    title={`${row.label} in den Anmeldungen öffnen`}
                  >
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <Count value={row.new} dot={row.new > 0 ? 'bg-amber-500' : undefined} />
                    <Count value={row.confirmed} />
                    <Count value={row.cancelled} muted />
                    <TableCell className="text-muted-foreground tabular-nums">
                      {size === 0 ? '—' : `${size}er · ${byes} FL`}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                      {row.byClub[0]} / {row.byClub[1]}
                    </TableCell>
                    <TableCell>
                      <Fill confirmed={row.confirmed} pending={row.new} capacity={row.capacity} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell>Gesamt (aktiv)</TableCell>
                <Count value={totals.new} />
                <Count value={totals.confirmed} />
                <Count value={totals.cancelled} muted />
                <TableCell />
                <TableCell className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                  {totals.byClub[0]} / {totals.byClub[1]}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </section>
    </div>
  )
}

interface CountProps {
  value: number
  // A semantic status hue (ADR-0019) shown as a leading dot, e.g. amber for the Neu queue.
  dot?: string
  muted?: boolean
}
const Count = ({ value, dot, muted }: CountProps) => (
  <TableCell className={cn('text-right font-mono tabular-nums', muted && value > 0 && 'text-muted-foreground')}>
    <span className="inline-flex items-center justify-end gap-1.5">
      {dot && <span className={cn('size-1.5 rounded-full', dot)} aria-hidden />}
      {value}
    </span>
  </TableCell>
)

interface FillProps {
  confirmed: number
  pending: number
  capacity: number | undefined
}
// The fill bar: bestätigt solid + neu as a lighter segment, toward capacity. Over-capacity is
// revealed (the bar runs to the larger total and a red marker shows where the cap sits) rather
// than clamped, so an over-subscribed field looks different from an exactly-full one (ADR-0019).
const Fill = ({ confirmed, pending, capacity }: FillProps) => {
  if (!capacity) return <span className="text-muted-foreground text-xs">—</span>
  const total = confirmed + pending
  const over = total > capacity
  const denom = over ? total : capacity
  const cw = (confirmed / denom) * 100
  const pw = (pending / denom) * 100
  const capMark = over ? (capacity / denom) * 100 : 100
  return (
    <div className="flex items-center gap-2">
      <span className={cn('shrink-0 font-mono text-xs tabular-nums', over ? 'text-red-600' : 'text-muted-foreground')}>
        {confirmed}/{capacity}
      </span>
      <div className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
        <div className="bg-foreground absolute inset-y-0 left-0 rounded-full" style={{ width: `${cw}%` }} />
        <div className="bg-foreground/30 absolute inset-y-0" style={{ left: `${cw}%`, width: `${pw}%` }} />
        {over && <div className="absolute inset-y-0 w-px bg-red-500" style={{ left: `${capMark}%` }} aria-hidden />}
      </div>
    </div>
  )
}

interface SectionLabelProps {
  children: React.ReactNode
}
const SectionLabel = ({ children }: SectionLabelProps) => (
  <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">{children}</h2>
)
