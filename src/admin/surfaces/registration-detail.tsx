import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  canConfirm,
  COMPETITION_SLUGS,
  CLUBS,
  isTooStrongForChallenger,
  resolveSeedingBasis,
  type AdminRegistration,
  type Club,
  type CompetitionSlug
} from '../../../shared'
import { competitions } from '@/data/tournament'
import { cn } from '@/admin/lib/utils'
import { Badge } from '@/admin/ui/badge'
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

// Konkurrenz labels come from the tournament content model so the detail panel never re-states a
// label tournament.ts already owns.
export const competitionLabel = (slug: string): string => competitions.find(c => c.slug === slug)?.label ?? slug

const CLUB_LOGOS: Record<string, string> = {
  'TV Winsen': '/club-logos/tv-winsen.svg',
  'TSV Winsen': '/club-logos/tsv-winsen.png'
}

// The editable payload the panel submits to confirm/save a row (matches ConfirmRequest minus id).
export interface ConfirmPayload {
  competition: CompetitionSlug
  club: Club
  playerId: string
  lk: string
}

interface RegistrationDetailProps {
  reg: AdminRegistration
  onConfirm: (id: number, payload: ConfirmPayload) => void
  onCancel: (id: number) => void
  onDelete: (reg: AdminRegistration) => void
}

// The triage detail/edit panel (ADR-0019): the right pane of the Anmeldungen surface. Shows the
// registrant in full and lets the operator correct the seeding-relevant fields before confirming.
// The edit state seeds from the row; the panel is remounted (keyed on the row's mutable fields by
// the surface) after a save, so it always reflects the persisted state. The shared predicates
// (canConfirm, resolveSeedingBasis, isTooStrongForChallenger — ADR-0011) drive the affordances, so
// the panel and the domain compute confirmability from the same source.
export const RegistrationDetail = ({ reg, onConfirm, onCancel, onDelete }: RegistrationDetailProps) => {
  const isConfirmed = reg.status === 'confirmed'
  const isCancelled = reg.status === 'cancelled'
  const [playerId, setPlayerId] = useState(reg.playerId ?? '')
  const [lk, setLk] = useState(reg.lk ?? '')
  const [competition, setCompetition] = useState<CompetitionSlug>(reg.competition)
  // reg.club is the lenient list-response string; the confirm contract narrows it to a Club.
  const [club, setClub] = useState<Club>(reg.club as Club)
  // Mirror a confirmed-without-id row's "no nuLiga ID" state so saving is not falsely blocked.
  const [noId, setNoId] = useState(isConfirmed && !reg.playerId)
  // Drives the "stark fürs Challenger-Feld" second confirmation (ADR-0011).
  const [challengerOpen, setChallengerOpen] = useState(false)

  // The seeding basis a confirm would persist — what canConfirm and the Challenger judgment read.
  // Resolved once in shared/ (incl. the no-ID ⇒ 25.0 rule), so the panel shows exactly what a
  // confirm would write and never carries a second copy of the policy.
  const basis = resolveSeedingBasis({ playerId, lk, noId })
  const confirmCheck = canConfirm(basis)
  const blockedReason = confirmCheck === true ? null : confirmCheck
  const blocked = blockedReason !== null
  const tooStrong = isTooStrongForChallenger(competition, basis.lk)

  const toggleNoId = (checked: boolean) => {
    setNoId(checked)
    if (checked) {
      setPlayerId('')
      // Pre-fill the visible LK through the single owner of the no-ID default, so the field shows
      // exactly what a confirm would persist — the 25.0 rule has no second copy here.
      setLk(prev => resolveSeedingBasis({ playerId: '', lk: prev, noId: true }).lk ?? '')
    }
  }

  const doConfirm = () => onConfirm(reg.id, { competition, club, playerId: basis.playerId ?? '', lk: basis.lk ?? '' })

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

  const logo = CLUB_LOGOS[reg.club]
  const status = STATUS_META[reg.status]

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-lg font-semibold">
            {reg.firstName} {reg.lastName}
          </span>
          <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', status.badge)}>
            {status.label}
          </span>
          <Badge variant="outline" className="uppercase">
            {competitionLabel(reg.competition)}
          </Badge>
          <Badge variant="outline" className="font-mono tabular-nums">
            <span className="text-[9px] tracking-[0.1em] opacity-60">LK</span>
            {reg.lk ?? '—'}
          </Badge>
          {isTooStrongForChallenger(reg.competition, reg.lk) && (
            <span className="text-destructive inline-flex items-center gap-1 text-xs font-semibold">
              <TriangleAlert className="size-3.5" />
              LK &lt; 20 — Hauptfeld?
            </span>
          )}
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm min-[561px]:ml-auto">
            {logo && (
              <img className="h-[18px] w-[18px] shrink-0 object-contain" src={logo} alt="" width={18} height={18} />
            )}
            <span>{reg.club}</span>
          </span>
        </div>
        <div className="text-muted-foreground mt-2 font-mono text-xs break-words">
          {reg.email}
          {reg.phone ? `  ·  ${reg.phone}` : ''}
        </div>
        {reg.note && (
          <div className="text-muted-foreground mt-3 border-l-2 border-border pl-[9px] text-sm">„{reg.note}"</div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-dashed pt-5 sm:grid-cols-2">
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
            <Label htmlFor="detail-lk">LK</Label>
            <Input
              id="detail-lk"
              className="font-mono"
              type="text"
              inputMode="decimal"
              placeholder="—"
              value={lk}
              onChange={e => setLk(e.target.value)}
            />
          </div>
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
            <Label htmlFor="detail-club">Verein</Label>
            <NativeSelect id="detail-club" value={club} onChange={e => setClub(e.target.value as Club)}>
              {CLUBS.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {blockedReason && <p className="text-destructive mt-3 text-xs font-semibold">{blockedReason}</p>}
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
            <AlertDialogTitle>LK {basis.lk} ist stark fürs Challenger-Feld</AlertDialogTitle>
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
