import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  canConfirm,
  isTooStrongForChallenger,
  resolveSeedingBasis,
  type AdminRegistration,
  type Club,
  type CompetitionSlug
} from '../../shared'
import { cn } from '@/admin/lib/utils'
import { Badge } from '@/admin/ui/badge'
import { Button } from '@/admin/ui/button'
import { Input } from '@/admin/ui/input'
import { Label } from '@/admin/ui/label'
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

// The left edge keys the card to its lifecycle status. The neutral shadcn palette is
// monochrome, so only cancelled gets a hue (destructive); the rest lean on weight + opacity,
// reinforced by the group headers and status tabs in the shell.
const cardStatus: Record<AdminRegistration['status'], string> = {
  new: 'border-l-foreground',
  confirmed: 'border-l-primary',
  hidden: 'border-l-border opacity-60',
  cancelled: 'border-l-destructive opacity-60'
}

const rowLabel = 'text-xs font-medium text-muted-foreground'
// Native <select> styled to match the shadcn Input — kept native so the operator gets the
// platform picker on a phone (mobile-first, per ADR-0016's CRUD-on-a-phone framing).
const selectClass = cn(
  'h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow]',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
)

const COMPETITION_LABELS: Record<string, string> = {
  mens: 'Herren',
  'mens-challenger': 'Herren Challenger',
  womens: 'Damen'
}
const CLUB_LOGOS: Record<string, string> = {
  'TV Winsen': '/club-logos/tv-winsen.svg',
  'TSV Winsen': '/club-logos/tsv-winsen.png'
}

// The editable payload the card submits to confirm/save a row (matches ConfirmRequest minus id).
export interface ConfirmPayload {
  competition: CompetitionSlug
  club: Club
  playerId: string
  lk: string
}

interface RegistrationCardProps {
  reg: AdminRegistration
  onConfirm: (id: number, payload: ConfirmPayload) => void
  onHide: (id: number) => void
  onDelete: (reg: AdminRegistration) => void
}

// One registration as an editable draw-sheet card — now on shadcn primitives (Card look via
// the bordered surface, Button, Input, Badge, AlertDialog) at functional parity. Local edit
// state seeds from the row; the card remounts (keyed on the row's mutable fields) after a save,
// so it always reflects the persisted state. canConfirm (shared/) drives the confirm
// affordance: the primary button is disabled with the reason when the row is not confirmable.
export const RegistrationCard = ({ reg, onConfirm, onHide, onDelete }: RegistrationCardProps) => {
  const isConfirmed = reg.status === 'confirmed'
  const [playerId, setPlayerId] = useState(reg.playerId ?? '')
  const [lk, setLk] = useState(reg.lk ?? '')
  const [competition, setCompetition] = useState<CompetitionSlug>(reg.competition)
  // reg.club is the lenient list-response string; the confirm contract narrows it to a Club.
  const [club, setClub] = useState<Club>(reg.club as Club)
  // Mirror a confirmed-without-id row's "no nuLiga ID" state so saving is not falsely blocked.
  const [noId, setNoId] = useState(isConfirmed && !reg.playerId)
  // Drives the "stark fürs Challenger-Feld" confirmation dialog (the former window.confirm).
  const [challengerOpen, setChallengerOpen] = useState(false)

  // The seeding basis a confirm would persist — what canConfirm and the Challenger judgment read.
  // The shaping (incl. the no-ID ⇒ 25.0 rule) is resolved once in shared/ so it is tested, not UI
  // state — the card and the domain compute the confirmable fields from the same function.
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
    if (blocked) return
    // Eligibility: the Challenger field is protected upward (from LK 20). A stronger LK is asked
    // to be confirmed explicitly (or moved to the Hauptfeld) via the AlertDialog below.
    if (tooStrong) {
      setChallengerOpen(true)
      return
    }
    doConfirm()
  }

  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit()
  }

  const logo = CLUB_LOGOS[reg.club]

  return (
    <div className={cn('bg-card text-card-foreground mb-2 rounded-lg border border-l-4 p-4', cardStatus[reg.status])}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-base font-semibold">
          {reg.firstName} {reg.lastName}
        </span>
        <Badge variant="outline" className="uppercase">
          {COMPETITION_LABELS[reg.competition] ?? reg.competition}
        </Badge>
        {reg.lk ? (
          <Badge variant="outline" className="font-mono tabular-nums">
            <span className="text-[9px] tracking-[0.1em] opacity-60">LK</span>
            {reg.lk}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground font-mono tabular-nums">
            <span className="text-[9px] tracking-[0.1em] opacity-60">LK</span>—
          </Badge>
        )}
        {isTooStrongForChallenger(reg.competition, reg.lk) && (
          <span className="text-destructive inline-flex items-center gap-1 text-xs font-semibold">
            <TriangleAlert className="size-3.5" />
            LK &lt; 20 — Hauptfeld?
          </span>
        )}
        <span className="text-muted-foreground inline-flex basis-full items-center gap-1.5 text-sm min-[561px]:ml-auto min-[561px]:basis-auto">
          {logo && (
            <img className="h-[18px] w-[18px] shrink-0 object-contain" src={logo} alt="" width={18} height={18} />
          )}
          <span>{reg.club}</span>
        </span>
      </div>
      <div className="text-muted-foreground mt-1.5 font-mono text-xs break-words">
        {reg.email}
        {reg.phone ? `  ·  ${reg.phone}` : ''}
      </div>
      {reg.note && (
        <div className="text-muted-foreground mt-1.5 border-l-2 border-border pl-[9px] text-sm">„{reg.note}"</div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-dashed pt-3">
        <Label className={rowLabel} htmlFor={`pid-${reg.id}`}>
          Spieler-ID
        </Label>
        <Input
          id={`pid-${reg.id}`}
          className="w-[118px] font-mono"
          type="text"
          inputMode="numeric"
          maxLength={8}
          placeholder="8-stellig"
          value={playerId}
          disabled={noId}
          onChange={e => setPlayerId(e.target.value)}
          onKeyDown={onFieldKeyDown}
        />
        <Label className="text-muted-foreground cursor-pointer font-medium">
          <input
            type="checkbox"
            className="accent-foreground size-4"
            checked={noId}
            onChange={e => toggleNoId(e.target.checked)}
          />
          keine ID
        </Label>
        <Label className={rowLabel} htmlFor={`lk-${reg.id}`}>
          LK
        </Label>
        <Input
          id={`lk-${reg.id}`}
          className="w-[72px] text-center font-mono"
          type="text"
          inputMode="decimal"
          placeholder="—"
          value={lk}
          onChange={e => setLk(e.target.value)}
          onKeyDown={onFieldKeyDown}
        />
        <Label className={rowLabel} htmlFor={`comp-${reg.id}`}>
          Feld
        </Label>
        <select
          id={`comp-${reg.id}`}
          className={selectClass}
          value={competition}
          onChange={e => setCompetition(e.target.value as CompetitionSlug)}
        >
          <option value="mens">Herren</option>
          <option value="mens-challenger">Herren Challenger</option>
          <option value="womens">Damen</option>
        </select>
        <Label className={rowLabel} htmlFor={`club-${reg.id}`}>
          Verein
        </Label>
        <select
          id={`club-${reg.id}`}
          className={selectClass}
          value={club}
          onChange={e => setClub(e.target.value as Club)}
        >
          <option value="TV Winsen">TV Winsen</option>
          <option value="TSV Winsen">TSV Winsen</option>
        </select>
        <span className="min-w-0 flex-1 max-[560px]:hidden" />
        <Button className="max-[560px]:flex-1" disabled={blocked} title={blockedReason ?? undefined} onClick={submit}>
          {isConfirmed ? 'Speichern' : 'Bestätigen'}
        </Button>
        <Button variant="outline" className="max-[560px]:flex-1" onClick={() => onHide(reg.id)}>
          Verstecken
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive ml-1 hover:text-white"
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
        {blockedReason && <span className="text-destructive basis-full text-xs font-semibold">{blockedReason}</span>}
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
