import { useState } from 'react'
import { StickyNote, TriangleAlert } from 'lucide-react'
import {
  canConfirm,
  COMPETITION_SLUGS,
  CLUBS,
  DEFAULT_LK,
  isTooStrongForChallenger,
  resolveSeedingBasis,
  type AdminRegistration,
  type Club,
  type CompetitionSlug
} from '../../../shared'
import { competitions } from '@/data/tournament'
import { cn } from '@/admin/lib/utils'
import { formatDate, formatRelative } from '@/admin/lib/format'
import { Alert, AlertDescription, AlertTitle } from '@/admin/ui/alert'
import { Badge } from '@/admin/ui/badge'
import { Input } from '@/admin/ui/input'
import { Label } from '@/admin/ui/label'
import { NativeSelect } from '@/admin/ui/native-select'
import { Switch } from '@/admin/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/admin/ui/toggle-group'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/admin/ui/alert-dialog'
import { ContactActions } from './contact-actions'
import { DetailActions } from './detail-actions'

// Semantic status colour — the single, bounded carve-out from ADR-0016's neutral rule (ADR-0019):
// amber = neu, green = bestätigt, red = abgemeldet. Shown as a dot in the queue and a badge here.
interface StatusMeta {
  label: string
  dot: string
  badge: string
}
export const STATUS_META: Record<AdminRegistration['status'], StatusMeta> = {
  new: { label: 'Neu', dot: 'bg-amber-500', badge: 'border-amber-300 bg-amber-50 text-amber-900' },
  confirmed: { label: 'Bestätigt', dot: 'bg-emerald-500', badge: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  cancelled: { label: 'Abgemeldet', dot: 'bg-red-500', badge: 'border-red-300 bg-red-50 text-red-900' }
}

// Konkurrenz label + capacity come from the tournament content model so the admin never re-states
// what tournament.ts already owns — both lookups live here, beside each other.
export const competitionLabel = (slug: string): string => competitions.find(c => c.slug === slug)?.label ?? slug
export const competitionCapacity = (slug: string): number | undefined =>
  competitions.find(c => c.slug === slug)?.capacity

export const CLUB_LOGOS: Record<string, string> = {
  'TV Winsen': '/club-logos/tv-winsen.svg',
  'TSV Winsen': '/club-logos/tsv-winsen.png'
}

// The editable payload the panel submits to confirm/save a row. The LK is not among the fields —
// it is derived (ADR-0020): `playerId` is the nuLiga link and `noId` the explicit "keine
// nuLiga-ID" choice; the server fetches or defaults the LK. (Matches ConfirmRequest minus id.)
export interface ConfirmPayload {
  competition: CompetitionSlug
  club: Club
  playerId: string
  noId: boolean
}

interface RegistrationDetailProps {
  reg: AdminRegistration
  onConfirm: (id: number, payload: ConfirmPayload) => void
  onCancel: (id: number) => void
  onDelete: (reg: AdminRegistration) => void
}

// The triage detail/edit panel (ADR-0019, redesigned in ADR-0023): three honest zones — identity
// (read-only facts, with contact facts turned into mailto/tel/WhatsApp actions), editable entry
// (each value shown once), actions. Content sits in a measured, centered column (max-w-3xl) so it
// uses the pane without sprawling. The LK is read-only (ADR-0020): the only seeding input is the
// nuLiga id + the „keine ID" switch; the LK is shown as a badge with its provenance (nuLiga vs
// Standard), not a fake input. The Verein is a two-option logo toggle, not a dropdown (small N).
// The edit state seeds from the row; the panel is remounted (keyed on the row's mutable fields by
// the surface) after a save, so it always reflects the persisted state. The shared predicates
// (canConfirm, resolveSeedingBasis, isTooStrongForChallenger — ADR-0011) drive the affordances.
export const RegistrationDetail = ({ reg, onConfirm, onCancel, onDelete }: RegistrationDetailProps) => {
  const isConfirmed = reg.status === 'confirmed'
  const isCancelled = reg.status === 'cancelled'
  // '' when there is no update to show or the stored value is unparseable (see formatRelative).
  const updatedRelative = reg.updatedAt ? formatRelative(reg.updatedAt) : ''
  const [playerId, setPlayerId] = useState(reg.playerId ?? '')
  const [competition, setCompetition] = useState<CompetitionSlug>(reg.competition)
  const [club, setClub] = useState<Club>(reg.club)
  // Mirror a confirmed-without-id row's "no nuLiga ID" state so saving is not falsely blocked.
  const [noId, setNoId] = useState(isConfirmed && !reg.playerId)
  // Drives the "stark fürs Challenger-Feld" second confirmation (ADR-0011).
  const [challengerOpen, setChallengerOpen] = useState(false)

  // The seeding basis a confirm would persist — what canConfirm reads. Resolved once in shared/
  // (incl. the no-ID ⇒ default rule), so the panel shows exactly what a confirm would write.
  const idDigits = playerId.trim()
  const basis = resolveSeedingBasis({ playerId, noId })
  const confirmCheck = canConfirm(basis)
  const blockedReason = confirmCheck === true ? null : confirmCheck
  const blocked = blockedReason !== null

  // The LK is derived (ADR-0020), shown read-only as what a save would result in, split into its
  // value and its provenance (two badges). `lkPending` is the transient state where a fresh 8-digit
  // id has been entered but nuLiga has not been queried for its rating yet.
  const idMatches = idDigits === reg.playerId && !!reg.lk
  const lkPending = !noId && idDigits.length === 8 && !idMatches
  const lkValue = noId ? DEFAULT_LK : lkPending ? null : idMatches ? reg.lk : (reg.lk ?? null)
  // The provenance is only worth a badge when it adds information: a nuLiga-sourced rating gets the
  // „nuLiga" tag, a Standard default (no id) gets none — the bare value already says „default".
  const lkFromNuliga = !noId && !lkPending && !!lkValue && !!reg.playerId

  // The LK the Challenger guard can judge: the no-id default, or a linked row's already-known
  // rating. A freshly entered id has no known LK yet (the edge fetches it), so the guard defers.
  const effectiveLk = noId ? DEFAULT_LK : idDigits === reg.playerId ? reg.lk : null
  const tooStrong = isTooStrongForChallenger(competition, effectiveLk)

  const toggleNoId = (checked: boolean) => {
    setNoId(checked)
    if (checked) setPlayerId('')
  }

  const doConfirm = () => onConfirm(reg.id, { competition, club, playerId: basis.playerId ?? '', noId })

  const submit = () => {
    if (isCancelled || blocked) return
    // The Challenger field is protected upward (from LK 20). A stronger LK is confirmed explicitly
    // (or moved to the Hauptfeld) via the AlertDialog below.
    if (tooStrong) {
      setChallengerOpen(true)
      return
    }
    doConfirm()
  }

  // Enter confirms the open entry (ADR-0019), so the operator can work the queue from the keyboard.
  // Buttons, the switch, and the native selects handle Enter themselves, so the panel only acts on
  // Enter raised from a text field or its own surface.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    const el = e.target as HTMLElement
    if (el.tagName === 'BUTTON' || el.tagName === 'SELECT' || el.getAttribute('role') === 'switch') return
    submit()
  }

  const status = STATUS_META[reg.status]

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {/* Identity — read-only facts. The status is the one state the operator does not edit
              inline, so it is the only badge here; everything editable lives once in the zone below. */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-xl font-semibold">
                {reg.firstName} {reg.lastName}
              </span>
              <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', status.badge)}>
                {status.label}
              </span>
              {/* LK is a derived, read-only fact (ADR-0020) — shown among the identity facts as two
                  badges: the value, and its provenance (nuLiga / Standard). Reflects the Spieler-ID
                  below live; while a fresh id is unresolved it reads as pending. */}
              {lkPending ? (
                <Badge variant="secondary">LK wird geholt …</Badge>
              ) : (
                <>
                  <Badge variant="default">LK {lkValue ?? '—'}</Badge>
                  {lkFromNuliga && (
                    <Badge variant="outline" className="font-normal">
                      nuLiga
                    </Badge>
                  )}
                </>
              )}
            </div>

            <ContactActions email={reg.email} phone={reg.phone} />

            {/* Provenance grounded in a labelled meta row, not loose text (ADR-0023). "Zuletzt
                aktualisiert" stays present even when nothing has changed yet (shows „—"). */}
            <div className="flex flex-wrap gap-x-10 gap-y-2 border-t border-dashed pt-4">
              <Meta label="Angemeldet" value={formatDate(reg.createdAt)} />
              {/* Relative ("vor 5 Minuten") via Intl.RelativeTimeFormat — no date-fns needed. Falls
                  back to „—" only when the timestamp is missing or unparseable. */}
              <Meta label="Zuletzt aktualisiert" value={updatedRelative || '—'} />
            </div>
          </div>

          {/* Editable entry — each value appears exactly once. */}
          <div className="grid grid-cols-1 gap-5 border-t border-dashed pt-6 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="detail-comp">Konkurrenz</Label>
              <NativeSelect
                id="detail-comp"
                value={competition}
                onChange={e => setCompetition(e.target.value as CompetitionSlug)}
              >
                {COMPETITION_SLUGS.map(slug => (
                  <option key={slug} value={slug}>
                    {competitionLabel(slug)}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Verein</Label>
              {/* Two clubs (small N) → a logo toggle, not a dropdown. Logos only (the name is the
                  accessible label/tooltip). Single-select: ignore the empty deselect so one is
                  always chosen. */}
              <ToggleGroup
                type="single"
                value={club}
                onValueChange={v => v && setClub(v as Club)}
                variant="outline"
                className="w-full"
              >
                {CLUBS.map(c => (
                  <ToggleGroupItem
                    key={c}
                    value={c}
                    aria-label={c}
                    title={c}
                    className="group data-[state=on]:bg-accent h-12 flex-1"
                  >
                    <img
                      src={CLUB_LOGOS[c]}
                      alt={c}
                      className="size-7 object-contain transition-opacity group-data-[state=off]:opacity-50"
                      width={28}
                      height={28}
                    />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="detail-pid">Spieler-ID</Label>
              <Input
                id="detail-pid"
                className="font-mono"
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="8-stellig"
                value={playerId}
                disabled={noId}
                onChange={e => setPlayerId(e.target.value)}
              />
              <Label className="text-muted-foreground mt-1 flex cursor-pointer items-center gap-2 font-medium">
                <Switch checked={noId} onCheckedChange={toggleNoId} />
                keine nuLiga-ID
              </Label>
            </div>
          </div>

          {blockedReason && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
              <TriangleAlert />
              <AlertTitle>Noch nicht bestätigbar</AlertTitle>
              <AlertDescription className="text-amber-900/90">{blockedReason}</AlertDescription>
            </Alert>
          )}
          {tooStrong && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
              <TriangleAlert />
              <AlertTitle>Stark fürs Challenger-Feld</AlertTitle>
              <AlertDescription className="text-amber-900/90">
                LK &lt; 20 — das Challenger-Feld ist ab LK 20 geschützt. „Herren" erwägen.
              </AlertDescription>
            </Alert>
          )}

          {/* Notiz sits at the foot of the panel (ADR-0023): operator context, below the facts and
              the edit zone, just above the actions. */}
          {reg.note && (
            <div className="bg-muted/50 flex gap-2.5 rounded-lg border p-3 text-sm">
              <StickyNote className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Notiz</span>
                <p className="text-foreground">{reg.note}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <DetailActions
        reg={reg}
        isConfirmed={isConfirmed}
        isCancelled={isCancelled}
        blocked={blocked}
        blockedReason={blockedReason}
        onSubmit={submit}
        onCancel={onCancel}
        onDelete={onDelete}
      />

      <AlertDialog open={challengerOpen} onOpenChange={setChallengerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>LK {effectiveLk} ist stark fürs Challenger-Feld</AlertDialogTitle>
            <AlertDialogDescription>
              Das Challenger-Feld ist ab LK 20 geschützt. {reg.firstName} {reg.lastName} trotzdem im Challenger
              bestätigen? Sonst oben das Feld auf „Herren" stellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={doConfirm}>Im Challenger bestätigen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface MetaProps {
  label: string
  value: string
}
// A labelled provenance fact (Angemeldet / Zuletzt aktualisiert), grounded with a small caption so
// it reads as data rather than floating text.
const Meta = ({ label, value }: MetaProps) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{label}</span>
    <span className="text-foreground text-sm tabular-nums">{value}</span>
  </div>
)
