import { Fragment, useMemo } from 'react'
import { ListOrdered, TriangleAlert } from 'lucide-react'
import {
  type AdminRegistration,
  bracketStructure,
  CHALLENGER_MIN_LK,
  challengerEligibility,
  COMPETITION_SLUGS,
  drawSize,
  fieldCut,
  isActive,
  isChallengerField,
  isSupportedDrawSize,
  isUnseededCompetition,
  provisionalSeedRanks
} from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Badge } from '@/admin/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { CLUB_LOGOS, competitionCapacity, competitionLabel } from './registration-detail'

interface SeedingSurfaceProps {
  registrations: AdminRegistration[]
}

// One row of the provisional seeding: the registration, its position in the cut order (1-based), its
// seed number if it is a drawn seed (DTB §30.5a — by LK, so on a Challenger field it need not match the
// row position; null when unseeded), whether it falls below the field cut (a reserve), and — for the
// Challenger field — whether its LK is too strong for the cap.
interface SeedingRow {
  reg: AdminRegistration
  position: number
  seed: number | null
  reserve: boolean
  tooStrong: boolean
}

// The provisional seeding list + field cut (de: provisorische Setzliste, CONTEXT: Field cut, issue
// #72 / ADR-0043): per competition, the **active** players (new + confirmed) ranked in cut order, with
// a cut line drawn at the field's `capacity` — above the line is in the field, below is a reserve
// (Nachrücker). The cut criterion depends on the field type (fieldCut, ADR-0043): a championship field
// ranks by LK (the cut is **provisional** — LK drifts until the seeding freeze, ADR-0010/0024), a
// Challenger field by registration order (the cut is **stable** — that key never drifts). `new` rows
// carry an LK because `matchOnRegister` matches them at signup and `syncAll` refreshes them weekly, so
// the list is rankable without confirming anyone first. Seed numbers are by LK on **every** field
// (provisionalSeedRanks, ADR-0047): on a championship field they read down the rows (cut order is LK
// order); on a Challenger field, listed in registration order, a seed badge can sit at any row (Nr. 1 may
// be last) — the honest signal that seeding ≠ registration. Too-strong Challenger entries are flagged via the
// shared challengerEligibility predicate — the same authority the draw guard reuses (affordance here,
// hard block there; ADR-0011, ADR-0024). Read-only: the operator eyeballs the cut + eligibility before
// auslosen; authority stays in the domain (the draw enforces the cut at the freeze, Schicht 2).
export const SeedingSurface = ({ registrations }: SeedingSurfaceProps) => {
  const fields = useMemo(() => {
    // An unseeded field (Social mixer, ADR-0051) has no Setzliste — it is never seeded or drawn — so it
    // is absent from the seeding preview entirely, matching the public list (which suppresses its seeds).
    return COMPETITION_SLUGS.filter(slug => !isUnseededCompetition(slug)).map(slug => {
      const isChallenger = isChallengerField(slug)
      // The cut ranks the active field (new + confirmed); a `new` row already carries a derived LK.
      const active = registrations.filter(r => r.competition === slug && isActive(r.status))
      // A field with no capacity (a planned field, not registerable today) gets no cut — pass the full
      // count as the cap so nothing is a reserve. The three live fields all carry a capacity.
      const capacity = competitionCapacity(slug)
      const cut = fieldCut(active, slug, capacity ?? active.length)
      // Seeds preview the *drawn* field (the in-field entries): the DTB seed count for that field's
      // draw size, and only for the supported sizes (4/8/16) — bracketStructure throws otherwise. The
      // seeds are ranked by LK for **every** field (provisionalSeedRanks, ADR-0047), so a Challenger
      // field — listed in registration order — still marks its LK-strongest, not its earliest registrants.
      const size = drawSize(cut.inField)
      const seedCount = isSupportedDrawSize(size) ? bracketStructure(size).seedCount : 0
      const inField = cut.ranked.filter(r => !r.reserve).map(r => r.entry)
      const seedRankOf = provisionalSeedRanks(inField, seedCount)
      // The Challenger field is judged against the current cap (over the active set); other fields
      // have none, so the too-strong set stays empty.
      const tooStrong = isChallenger ? challengerEligibility(active, CHALLENGER_MIN_LK).tooStrong : []
      const tooStrongIds = new Set(tooStrong.map(r => r.id))
      const rows: SeedingRow[] = cut.ranked.map(({ entry, position, reserve }) => ({
        reg: entry,
        position,
        seed: reserve ? null : (seedRankOf.get(entry) ?? null),
        reserve,
        tooStrong: tooStrongIds.has(entry.id)
      }))
      return {
        slug,
        label: competitionLabel(slug),
        capacity,
        provisional: cut.provisional,
        inField: cut.inField,
        reserves: cut.reserves,
        seedCount,
        tooStrongCount: tooStrong.length,
        rows
      }
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
            Sobald Anmeldungen vorliegen, erscheint hier pro Konkurrenz die provisorische Reihenfolge — mit Schnittlinie
            bei der Maximalgröße, sobald ein Feld voll ist.
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
  capacity: number | undefined
  provisional: boolean
  inField: number
  reserves: number
  seedCount: number
  tooStrongCount: number
}
// One competition's provisional seeding: a header with the active count (plus the field/reserve split
// once the cut bites and the seed count), then the ranked rows with the cut line drawn at capacity. An
// empty field shows the header alone so the operator sees every competition's state at a glance.
const FieldCard = ({
  label,
  rows,
  capacity,
  provisional,
  inField,
  reserves,
  seedCount,
  tooStrongCount
}: FieldCardProps) => {
  // Where the cut line goes — before the first reserve row. -1 when the field is at or below capacity
  // (no reserves), so no line is drawn: the cut only shows once a field is genuinely over its limit.
  const firstReserve = rows.findIndex(r => r.reserve)
  return (
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
        <span className="text-muted-foreground text-sm tabular-nums">
          {rows.length} aktiv
          {reserves > 0 && ` · ${inField} im Feld · ${reserves} Nachrücker`}
          {seedCount > 0 && ` · ${seedCount} gesetzt`}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Noch keine Anmeldungen.</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((row, i) => (
            <Fragment key={row.reg.id}>
              {i === firstReserve && <CutLine capacity={capacity} provisional={provisional} />}
              <SeedRow {...row} />
            </Fragment>
          ))}
        </ol>
      )}
    </section>
  )
}

interface CutLineProps {
  capacity: number | undefined
  provisional: boolean
}
// The field cut (CONTEXT: Field cut, ADR-0043): a labelled rule between the in-field rows above and
// the reserves below. „vorläufig" for a championship field (the cut moves as LKs sync until the
// freeze), „fix" for a Challenger field (registration order never drifts — a spot is secure once
// taken). Not aria-hidden: the label conveys the cut to assistive tech, not just the dimmed rows.
const CutLine = ({ capacity, provisional }: CutLineProps) => (
  <li className="my-1 flex items-center gap-2 py-1">
    <span className="h-px flex-1 bg-amber-300" />
    <span className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase">
      Schnitt bei {capacity} · {provisional ? 'vorläufig' : 'fix'}
    </span>
    <span className="h-px flex-1 bg-amber-300" />
  </li>
)

// One ranked row: the position in the cut order (a muted number — the first-come order for a Challenger
// field), then the club logo and player name, followed by a filled **seed badge** (the LK seed number,
// mirroring the bracket) when the row is a drawn seed, the LK, and — for a too-strong Challenger entry —
// an amber „stark"-marker. Because seeding is by LK (ADR-0047), the seed badge can sit at any row on a
// Challenger field (Nr. 1 may be the last-registered), which is exactly the divergence to surface. A
// reserve (below the cut) is dimmed and never seeded. The LK is shown as stored; a row with no resolvable
// rating seeds at the weakest.
const SeedRow = ({ reg, position, seed, reserve, tooStrong }: SeedingRow) => (
  <li
    className={cn(
      'flex items-center gap-3 border-b py-2 text-sm last:border-b-0',
      tooStrong && '-mx-2 rounded bg-amber-50/60 px-2',
      reserve && 'opacity-55'
    )}
  >
    <span className="flex w-6 shrink-0 justify-center">
      <span className="text-muted-foreground tabular-nums">{position}</span>
    </span>
    <img
      src={CLUB_LOGOS[reg.club]}
      alt={reg.club}
      title={reg.club}
      className="size-4 shrink-0 object-contain"
      width={16}
      height={16}
    />
    <span className="min-w-0 flex-1 truncate">
      {reg.firstName} {reg.lastName}
    </span>
    {seed !== null && (
      <span
        className="bg-foreground text-background inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums"
        title={`An ${seed} gesetzt`}
      >
        {seed}
      </span>
    )}
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
