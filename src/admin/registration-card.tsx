import { useState } from 'react'
import {
  canConfirm,
  DEFAULT_LK,
  isTooStrongForChallenger,
  type AdminRegistration,
  type Club,
  type CompetitionSlug
} from '../../shared'

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

  // The fields a confirm would persist — what canConfirm and the Challenger judgment read.
  const effectivePlayerId = noId ? '' : playerId.trim()
  const effectiveLk = noId ? lk.trim() || DEFAULT_LK : lk.trim()
  const confirmCheck = canConfirm({ playerId: effectivePlayerId || null, lk: effectiveLk || null })
  const blockedReason = confirmCheck === true ? null : confirmCheck
  const blocked = blockedReason !== null
  const tooStrong = isTooStrongForChallenger(competition, effectiveLk || null)

  const toggleNoId = (checked: boolean) => {
    setNoId(checked)
    if (checked) {
      setPlayerId('')
      setLk(prev => prev.trim() || DEFAULT_LK)
    }
  }

  const submit = () => {
    if (blocked) return
    // Eligibility: the Challenger field is protected upward (from LK 20). A stronger LK is asked
    // to be confirmed explicitly (or moved to the Hauptfeld).
    if (
      tooStrong &&
      !window.confirm(
        `LK ${effectiveLk} ist stark fürs Challenger-Feld (geschützt ab LK 20).\n\n` +
          `${reg.firstName} ${reg.lastName} trotzdem im Challenger bestätigen? Sonst oben das Feld auf „Herren" stellen.`
      )
    )
      return
    onConfirm(reg.id, { competition, club, playerId: effectivePlayerId, lk: effectiveLk })
  }

  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit()
  }

  const logo = CLUB_LOGOS[reg.club]

  return (
    <div className={`card s-${reg.status}`}>
      <div className="row1">
        <span className="name">
          {reg.firstName} {reg.lastName}
        </span>
        <span className="badge">{COMPETITION_LABELS[reg.competition] ?? reg.competition}</span>
        {reg.lk ? (
          <span className="seed">
            <b>LK</b>
            {reg.lk}
          </span>
        ) : (
          <span className="seed is-none">
            <b>LK</b>—
          </span>
        )}
        {isTooStrongForChallenger(reg.competition, reg.lk) && <span className="warn">⚠ LK &lt; 20 — Hauptfeld?</span>}
        <span className="meta">
          {logo && <img className="club-logo" src={logo} alt="" width={18} height={18} />}
          <span>{reg.club}</span>
        </span>
      </div>
      <div className="contact">
        {reg.email}
        {reg.phone ? `  ·  ${reg.phone}` : ''}
      </div>
      {reg.note && <div className="note">„{reg.note}"</div>}

      <div className="row2">
        <label>Spieler-ID</label>
        <input
          className="pid"
          type="text"
          inputMode="numeric"
          maxLength={8}
          placeholder="8-stellig"
          value={playerId}
          disabled={noId}
          onChange={e => setPlayerId(e.target.value)}
          onKeyDown={onFieldKeyDown}
        />
        <label className="noid">
          <input type="checkbox" checked={noId} onChange={e => toggleNoId(e.target.checked)} /> keine ID
        </label>
        <label>LK</label>
        <input
          className="lk"
          type="text"
          inputMode="decimal"
          placeholder="—"
          value={lk}
          onChange={e => setLk(e.target.value)}
          onKeyDown={onFieldKeyDown}
        />
        <label>Feld</label>
        <select className="konk" value={competition} onChange={e => setCompetition(e.target.value as CompetitionSlug)}>
          <option value="mens">Herren</option>
          <option value="mens-challenger">Herren Challenger</option>
          <option value="womens">Damen</option>
        </select>
        <label>Verein</label>
        <select className="vrn" value={club} onChange={e => setClub(e.target.value as Club)}>
          <option value="TV Winsen">TV Winsen</option>
          <option value="TSV Winsen">TSV Winsen</option>
        </select>
        <span className="spacer" />
        <button
          className="btn-primary act-confirm"
          disabled={blocked}
          title={blockedReason ?? undefined}
          onClick={submit}
        >
          {isConfirmed ? 'Speichern' : 'Bestätigen'}
        </button>
        <button className="btn-hide act-hide" onClick={() => onHide(reg.id)}>
          Verstecken
        </button>
        <button className="btn-del act-del" title="Anmeldung dauerhaft löschen" onClick={() => onDelete(reg)}>
          Löschen
        </button>
        {blockedReason && <span className="reason">{blockedReason}</span>}
      </div>
    </div>
  )
}
