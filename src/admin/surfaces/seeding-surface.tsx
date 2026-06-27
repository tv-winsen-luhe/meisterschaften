import { useMemo } from 'react'
import { ListOrdered, TriangleAlert } from 'lucide-react'
import {
  type AdminRegistration,
  CHALLENGER_MIN_LK,
  challengerEligibility,
  COMPETITION_SLUGS,
  seedingValue
} from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Badge } from '@/admin/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { competitionLabel } from './registration-detail'

interface SeedingSurfaceProps {
  registrations: AdminRegistration[]
}

// One seeded entry as the list shows it: the registration, its provisional seed position, and (for
// the Challenger field) whether its LK is too strong for the cap.
interface SeedingRow {
  reg: AdminRegistration
  seed: number
  tooStrong: boolean
}

// The provisional seeding list (de: provisorische Setzliste, issue #72): per competition, the
// confirmed players ordered by seedingValue (ascending → strongest first, the draw's seeding order)
// with their LK, all on one screen (no pagination, ADR-0021). It reflects the LK live — the rows are
// the admin list the shell already holds, which the weekly nuLiga cron keeps fresh during signup, so
// every reload mirrors the current LK before the seeding freeze (ADR-0010). For the Challenger field
// it marks entries too strong for the cap via the shared challengerEligibility predicate (ADR-0011) —
// the same authority the draw guard reuses (the affordance here, the hard block there; ADR-0024). It
// is a read-only preview: the operator eyeballs seeding + Challenger eligibility before auslosen.
export const SeedingSurface = ({ registrations }: SeedingSurfaceProps) => {
  const fields = useMemo(() => {
    return COMPETITION_SLUGS.map(slug => {
      // Seeded over the confirmed entries — the set the draw seeds (a `new` row is not yet in).
      const confirmed = registrations
        .filter(r => r.competition === slug && r.status === 'confirmed')
        .sort((a, b) => seedingValue(a.lk) - seedingValue(b.lk))
      // The Challenger field is judged against the current cap; other fields have none, so the set of
      // too-strong rows stays empty. challengerEligibility takes the field's entries directly.
      const tooStrong = slug === 'mens-challenger' ? challengerEligibility(confirmed, CHALLENGER_MIN_LK).tooStrong : []
      const tooStrongIds = new Set(tooStrong.map(r => r.id))
      const rows: SeedingRow[] = confirmed.map((reg, i) => ({
        reg,
        seed: i + 1,
        tooStrong: tooStrongIds.has(reg.id)
      }))
      return { slug, label: competitionLabel(slug), rows, tooStrongCount: tooStrong.length }
    })
  }, [registrations])

  const hasAny = fields.some(f => f.rows.length > 0)
  if (!hasAny) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListOrdered />
          </EmptyMedia>
          <EmptyTitle>Noch keine Setzliste</EmptyTitle>
          <EmptyDescription>
            Sobald Anmeldungen bestätigt sind, erscheint hier pro Konkurrenz die provisorische Setzung nach LK.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        {fields.map(field => (
          <FieldCard key={field.slug} {...field} />
        ))}
      </div>
    </div>
  )
}

interface FieldCardProps {
  label: string
  rows: SeedingRow[]
  tooStrongCount: number
}
// One competition's provisional seeding: a header with the count and (Challenger only) an
// eligibility badge, then the seeded rows. An empty field shows the header alone so the operator
// sees every competition's state at a glance, not just the populated ones.
const FieldCard = ({ label, rows, tooStrongCount }: FieldCardProps) => (
  <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="font-semibold">{label}</span>
        {tooStrongCount > 0 && (
          <Badge className="border-amber-300 bg-amber-50 text-amber-900">
            <TriangleAlert className="size-3" />
            {tooStrongCount} zu stark
          </Badge>
        )}
      </div>
      <span className="text-muted-foreground text-sm tabular-nums">{rows.length} bestätigt</span>
    </div>

    {rows.length === 0 ? (
      <p className="text-muted-foreground text-sm">Noch keine bestätigten Anmeldungen.</p>
    ) : (
      <ol className="flex flex-col">
        {rows.map(row => (
          <SeedRow key={row.reg.id} {...row} />
        ))}
      </ol>
    )}
  </section>
)

// One seeded row: the provisional seed number, the player (name + club), the LK, and — for a
// too-strong Challenger entry — an amber „stark"-marker. The LK is shown as stored; a row with no
// resolvable rating (no nuLiga rating yet) seeds at the weakest, which its position already reflects.
const SeedRow = ({ reg, seed, tooStrong }: SeedingRow) => (
  <li
    className={cn(
      'flex items-center gap-3 border-b py-2 text-sm last:border-b-0',
      tooStrong && '-mx-2 rounded bg-amber-50/60 px-2'
    )}
  >
    <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">{seed}</span>
    <span className="min-w-0 flex-1 truncate">
      {reg.firstName} {reg.lastName}
      <span className="text-muted-foreground ml-2 text-xs">{reg.club}</span>
    </span>
    {tooStrong && (
      <span
        className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"
        title="LK unter der Challenger-Grenze"
      >
        <TriangleAlert className="size-3.5" />
        stark
      </span>
    )}
    <span className="w-16 shrink-0 text-right tabular-nums">{reg.lk ? `LK ${reg.lk}` : '—'}</span>
  </li>
)
