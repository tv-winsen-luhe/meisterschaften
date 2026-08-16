import type { LiveBracket, LiveBracketSlot, PublicDraw } from './admin'

// Strength redaction — the one place that answers "does this field's absolute strength leave the server?"
// and, if so, performs the redaction (CONTEXT: Strength redaction; ADR-0048, ADR-0061).
//
// The concept was built for the protected Challenger field: its LK value and seed number were dropped on
// every public wire, so a recreational field would not broadcast its weakness (ADR-0024, ADR-0044). ADR-0061
// ended that for the Herren Challenger — a drawn field must be verifiable and a player must be able to
// place an opponent against their own LK — so **no competition is redacted today**. The seam stays: it is
// what a future protected field (Damen Freizeit) flips, and it keeps the decision one server-side switch
// rather than a rule each surface re-derives from the competition slug.
//
// The predicate and the two redactors live together, apart from the projections that call them, so the
// mechanism stays exercised by tests while the list is empty and the rule cannot drift across surfaces.

// The competitions whose absolute strength is withheld from the public wire. Deliberately a list, not a
// slug-suffix rule like isChallengerField: redaction is a per-field editorial decision (what a field's
// audience should see), not a structural property of the field type — the Herren Challenger is protected
// *and* public. Adding a field here is the single change that turns redaction on for it; every public
// projection reads this predicate, and the client reads the `redacted` flag they set from it (ADR-0048).
const STRENGTH_REDACTED_COMPETITIONS: readonly string[] = []

export const strengthRedacted = (competition: string): boolean => STRENGTH_REDACTED_COMPETITIONS.includes(competition)

// Redact a reveal draw's strength: null each step's `seed` and the joined player's `lk`, and set
// `redacted: true` in the same object literal so the withheld values and the decision that withheld them
// cannot drift (the enforced invariant, ADR-0048). The seeded *structure* — kind, position, names — is
// deliberately kept (ADR-0044 §2): relative rank is the sanctioned signal, the absolute LK is not.
// Unconditional: the caller decides *whether* to redact via strengthRedacted, so the two halves of the
// decision are visible at the call site and this stays a pure, testable transform.
export const redactRevealDraw = (draw: PublicDraw): PublicDraw => ({
  ...draw,
  redacted: true,
  steps: draw.steps.map(s => ({ ...s, seed: null, player: s.player ? { ...s.player, lk: null } : null }))
})

// The live-phase analogue (ADR-0046): null each *resolved* player slot's seed + LK, keeping the name and
// the bracket structure. A non-player slot (feeder, bye, „offen") carries no strength and passes through.
const redactLiveSlot = (slot: LiveBracketSlot): LiveBracketSlot =>
  slot.kind === 'player' ? { ...slot, lk: null, seed: null } : slot

export const redactLiveBracket = (bracket: LiveBracket): LiveBracket => ({
  ...bracket,
  redacted: true,
  matches: bracket.matches.map(m => ({ ...m, slot1: redactLiveSlot(m.slot1), slot2: redactLiveSlot(m.slot2) }))
})
