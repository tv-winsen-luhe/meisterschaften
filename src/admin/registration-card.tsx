import { useState } from 'react'
import {
  canConfirm,
  isTooStrongForChallenger,
  resolveSeedingBasis,
  type AdminRegistration,
  type Club,
  type CompetitionSlug
} from '../../shared'
import { btnBase, focusRing } from './styles'

const cardStatus: Record<AdminRegistration['status'], string> = {
  new: 'border-l-blue',
  confirmed: 'border-l-neon',
  hidden: 'border-l-border-strong opacity-60',
  cancelled: 'border-l-clay opacity-[0.62]'
}

// row2 form controls — the shared border/background/size; inputs add the mono face on top.
const field = `${focusRing} border-[1.5px] border-border-strong bg-surface px-[9px] py-[7px] text-sm`
const rowLabel = 'text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted'

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

// One registration as an editable draw-sheet card — the React port of the legacy card. Local
// edit state seeds from the row; the card remounts (keyed on the row's mutable fields) after a
// save, so it always reflects the persisted state. canConfirm (shared/) drives the confirm
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

  const submit = () => {
    if (blocked) return
    // Eligibility: the Challenger field is protected upward (from LK 20). A stronger LK is asked
    // to be confirmed explicitly (or moved to the Hauptfeld).
    if (
      tooStrong &&
      !window.confirm(
        `LK ${basis.lk} ist stark fürs Challenger-Feld (geschützt ab LK 20).\n\n` +
          `${reg.firstName} ${reg.lastName} trotzdem im Challenger bestätigen? Sonst oben das Feld auf „Herren" stellen.`
      )
    )
      return
    onConfirm(reg.id, { competition, club, playerId: basis.playerId ?? '', lk: basis.lk ?? '' })
  }

  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit()
  }

  const logo = CLUB_LOGOS[reg.club]

  return (
    <div
      className={`relative mb-2 border border-l-[5px] border-border bg-surface pt-[13px] pr-4 pb-[14px] pl-4 ${cardStatus[reg.status]}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[17px] font-extrabold tracking-[-0.01em]">
          {reg.firstName} {reg.lastName}
        </span>
        <span className="border-[1.5px] border-text px-2 py-[3px] text-[10px] font-extrabold tracking-[0.12em] uppercase">
          {COMPETITION_LABELS[reg.competition] ?? reg.competition}
        </span>
        {reg.lk ? (
          <span className="inline-block border-[1.5px] border-text px-[9px] py-0.5 font-mono text-[13px] font-bold whitespace-nowrap tabular-nums">
            <b className="mr-[5px] align-[1px] text-[9px] tracking-[0.1em] opacity-60">LK</b>
            {reg.lk}
          </span>
        ) : (
          <span className="inline-block border-[1.5px] border-border-strong px-[9px] py-0.5 font-mono text-[13px] font-bold whitespace-nowrap text-text-muted tabular-nums">
            <b className="mr-[5px] align-[1px] text-[9px] tracking-[0.1em] opacity-60">LK</b>—
          </span>
        )}
        {isTooStrongForChallenger(reg.competition, reg.lk) && (
          <span className="text-xs font-extrabold text-clay">⚠ LK &lt; 20 — Hauptfeld?</span>
        )}
        <span className="inline-flex basis-full items-center gap-1.5 text-[13px] text-text-muted min-[561px]:ml-auto min-[561px]:basis-auto">
          {logo && (
            <img className="h-[18px] w-[18px] shrink-0 object-contain" src={logo} alt="" width={18} height={18} />
          )}
          <span>{reg.club}</span>
        </span>
      </div>
      <div className="mt-1.5 font-mono text-xs break-words text-text-muted">
        {reg.email}
        {reg.phone ? `  ·  ${reg.phone}` : ''}
      </div>
      {reg.note && (
        <div className="mt-1.5 border-l-2 border-border-strong pl-[9px] text-[13px] text-[#444]">„{reg.note}"</div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-dashed border-border-strong pt-3">
        <label className={rowLabel}>Spieler-ID</label>
        <input
          className={`${field} w-[118px] font-mono`}
          type="text"
          inputMode="numeric"
          maxLength={8}
          placeholder="8-stellig"
          value={playerId}
          disabled={noId}
          onChange={e => setPlayerId(e.target.value)}
          onKeyDown={onFieldKeyDown}
        />
        <label className="inline-flex cursor-pointer items-center gap-[5px] font-bold text-text-muted">
          <input
            type="checkbox"
            className={`${focusRing} accent-clay`}
            checked={noId}
            onChange={e => toggleNoId(e.target.checked)}
          />{' '}
          keine ID
        </label>
        <label className={rowLabel}>LK</label>
        <input
          className={`${field} w-[72px] text-center font-mono`}
          type="text"
          inputMode="decimal"
          placeholder="—"
          value={lk}
          onChange={e => setLk(e.target.value)}
          onKeyDown={onFieldKeyDown}
        />
        <label className={rowLabel}>Feld</label>
        <select className={field} value={competition} onChange={e => setCompetition(e.target.value as CompetitionSlug)}>
          <option value="mens">Herren</option>
          <option value="mens-challenger">Herren Challenger</option>
          <option value="womens">Damen</option>
        </select>
        <label className={rowLabel}>Verein</label>
        <select className={field} value={club} onChange={e => setClub(e.target.value as Club)}>
          <option value="TV Winsen">TV Winsen</option>
          <option value="TSV Winsen">TSV Winsen</option>
        </select>
        <span className="min-w-0 flex-1 max-[560px]:hidden" />
        <button
          className={`${btnBase} ${focusRing} bg-neon px-[14px] py-2 tracking-[0.01em] text-navy hover:brightness-105 max-[560px]:flex-1`}
          disabled={blocked}
          title={blockedReason ?? undefined}
          onClick={submit}
        >
          {isConfirmed ? 'Speichern' : 'Bestätigen'}
        </button>
        <button
          className={`${btnBase} ${focusRing} border-[1.5px] border-border-strong bg-surface-alt px-3 py-2 text-text hover:bg-[#e9e9e6] max-[560px]:flex-1`}
          onClick={() => onHide(reg.id)}
        >
          Verstecken
        </button>
        <button
          className={`${btnBase} ${focusRing} ml-1 border-[1.5px] border-clay bg-transparent px-3 py-2 text-clay hover:bg-clay hover:text-white`}
          title="Anmeldung dauerhaft löschen"
          onClick={() => onDelete(reg)}
        >
          Löschen
        </button>
        {blockedReason && <span className="basis-full text-xs font-bold text-clay">{blockedReason}</span>}
      </div>
    </div>
  )
}
