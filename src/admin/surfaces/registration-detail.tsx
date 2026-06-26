import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
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
import { Button } from '@/admin/ui/button'
import { Input } from '@/admin/ui/input'
import { Label } from '@/admin/ui/label'
import { NativeSelect } from '@/admin/ui/native-select'
import { Switch } from '@/admin/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/admin/ui/alert-dialog'

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

const CLUB_LOGOS: Record<string, string> = {
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

// The triage detail/edit panel (ADR-0019, redesigned): three honest zones — identity (read-only
// facts), editable entry (each value shown once), actions. The LK is read-only (ADR-0020): the
// only seeding input is the nuLiga id + the „keine ID" switch; the LK is shown with its provenance
// (nuLiga vs Standard). The edit state seeds from the row; the panel is remounted (keyed on the
// row's mutable fields by the surface) after a save, so it always reflects the persisted state.
// The shared predicates (canConfirm, resolveSeedingBasis, isTooStrongForChallenger — ADR-0011)
// drive the affordances, so the panel and the domain agree on confirmability.
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

  // The LK is derived (ADR-0020), so show — read-only — what a save would result in, with its
  // source: the no-id default, the linked player's stored nuLiga rating, or "to be fetched" when
  // a new id is entered that nuLiga has not been queried for yet.
  const lkText = noId
    ? `${DEFAULT_LK} · Standard`
    : idDigits.length === 8
      ? idDigits === reg.playerId && reg.lk
        ? `${reg.lk} · nuLiga`
        : 'wird aus nuLiga geholt'
      : reg.lk
        ? `${reg.lk} · ${reg.playerId ? 'nuLiga' : 'Standard'}`
        : '—'

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

  const logo = CLUB_LOGOS[club]
  const status = STATUS_META[reg.status]

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* Identity — read-only facts. The status is the one state the operator does not edit
            inline, so it is the only badge here; everything editable lives once in the zone below. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-lg font-semibold">
            {reg.firstName} {reg.lastName}
          </span>
          <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', status.badge)}>
            {status.label}
          </span>
        </div>
        <div className="text-muted-foreground mt-2 font-mono text-xs break-words">
          {reg.email}
          {reg.phone ? `  ·  ${reg.phone}` : ''}
        </div>
        {reg.note && (
          <div className="text-muted-foreground mt-3 border-l-2 border-border pl-[9px] text-sm">„{reg.note}"</div>
        )}
        <div className="text-muted-foreground mt-3 text-xs">
          Angemeldet am {formatDate(reg.createdAt)}
          {reg.updatedAt && reg.updatedAt !== reg.createdAt && updatedRelative && ` · aktualisiert ${updatedRelative}`}
        </div>

        {/* Editable entry — each value appears exactly once. */}
        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-dashed pt-5 sm:grid-cols-2">
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
            <Label htmlFor="detail-club" className="flex items-center gap-1.5">
              {logo && <img className="h-3.5 w-3.5 shrink-0 object-contain" src={logo} alt="" width={14} height={14} />}
              Verein
            </Label>
            <NativeSelect id="detail-club" value={club} onChange={e => setClub(e.target.value as Club)}>
              {CLUBS.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
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
          <div className="flex flex-col gap-1.5">
            <Label>LK</Label>
            {/* Read-only (ADR-0020): the LK is derived, never typed. */}
            <div className="border-input bg-muted/40 text-muted-foreground flex h-9 items-center rounded-md border px-3 font-mono text-sm">
              {lkText}
            </div>
          </div>
        </div>
        {blockedReason && <p className="text-destructive mt-3 text-xs font-semibold">{blockedReason}</p>}
        {tooStrong && (
          <p className="text-destructive mt-2 inline-flex items-center gap-1 text-xs font-semibold">
            <TriangleAlert className="size-3.5" />
            LK &lt; 20 — stark fürs Challenger-Feld. „Herren" erwägen.
          </p>
        )}
      </div>

      <div className="bg-background flex flex-wrap items-center gap-2 border-t p-4">
        {!isCancelled && (
          <Button className="max-[560px]:flex-1" disabled={blocked} title={blockedReason ?? undefined} onClick={submit}>
            {isConfirmed ? 'Speichern' : 'Bestätigen'}
          </Button>
        )}
        {!isCancelled && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="max-[560px]:flex-1">
                Absagen
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Anmeldung von {reg.firstName} {reg.lastName} absagen?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Der Eintrag wird abgemeldet und aus der öffentlichen Liste sowie der Auslosung entfernt. Eine erneute
                  Teilnahme erfolgt über eine neue Anmeldung.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={() => onCancel(reg.id)}>Absagen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive ml-auto hover:text-white max-[560px]:flex-1"
              title="Anmeldung dauerhaft löschen"
            >
              Löschen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Anmeldung von {reg.firstName} {reg.lastName} löschen?
              </AlertDialogTitle>
              <AlertDialogDescription>Dieser Eintrag wird endgültig aus der Datenbank entfernt.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90 text-white"
                onClick={() => onDelete(reg)}
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

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
