// Shared Tailwind class strings for the admin island. The legacy admin.css applied these as
// global rules (`button, .btn { … }` and a single `:focus-visible` outline); expressed as
// utilities they have to be opted into per element, so they live here once instead of being
// duplicated across the app and the card.

// The global `button`/`.btn` base: bold, pointer, the press-down on :active, and the disabled
// look. The transition keeps the legacy split timing (transform .08s, filter .12s) verbatim.
export const btnBase =
  'cursor-pointer font-bold [transition:transform_.08s_ease,filter_.12s_ease] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50'

// The legacy global `:focus-visible { outline: 2.5px solid var(--blue); outline-offset: 1px }`.
export const focusRing = 'focus-visible:[outline:2.5px_solid_var(--color-blue)] focus-visible:outline-offset-1'
