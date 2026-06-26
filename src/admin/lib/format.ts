// Date presentation helpers for the admin, kept as pure functions separate from the detail panel
// so they are tested in isolation like the other admin predicates (auto-advance, can-confirm).
// Both take a stored ISO timestamp; the relative one is deliberately hardened against bad input
// (see formatRelative) because a throw in render would blank the whole client:only admin island.

// "14. August 2026" — the operator-facing form of the stored ISO timestamp.
export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })

// "vor 2 Tagen" — a relative form for the last update, so recency reads at a glance. Returns ''
// for an unparseable timestamp: Intl.RelativeTimeFormat.format throws a RangeError on a NaN
// (e.g. a non-ISO value leaking from the store), and an unhandled throw here would blank the whole
// admin island — a single bad field must degrade to "no relative time", never take down the UI.
const relativeTime = new Intl.RelativeTimeFormat('de', { numeric: 'auto' })
export const formatRelative = (iso: string): string => {
  const rtf = relativeTime
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const mins = Math.round((ms - Date.now()) / 60000)
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute')
  const hours = Math.round(mins / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}
