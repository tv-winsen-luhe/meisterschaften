import { type PublicDraw, type PublicRevealStep } from '../../shared'
import { type RevealRead } from './use-reveal'

// The draw show's playback engine (issue #71), lifted out of the DrawShow component so its reliability
// logic — the retry-then-stale read loop, the double-fire guard, the status reducer — is testable
// without rendering (the component only ever paints what this returns). Framework-agnostic on purpose:
// it owns its state and exposes a getState/subscribe store the React view binds with
// useSyncExternalStore. It is *pure playback* (ADR-0003/0031): it reads the cursor-sliced reveal the
// server already wrote and moves the cursor forward only — it never re-rolls.

// How many times a transient read is retried before the show settles (error / stale), and the pause
// between tries — enough to ride out a one-off network blip without stalling the operator. The pause is
// injected as `sleep` so a test consumes the retries instantly instead of waiting it out in real time.
const READ_RETRIES = 2
const RETRY_DELAY_MS = 300

// The read-side phase the beamer is in: the initial read in flight, a reveal on screen (`ready`), a
// genuinely un-drawn field (`absent`), the initial read failed with nothing to show (`error`), or a
// refresh failed while a reveal stands — kept on screen but paused (`stale`). Why `absent` and `error`
// stay distinct (and why `error` is retried while `absent` is terminal) is the Draw reveal show entry in
// CONTEXT.md — the canonical home for that rule.
export type RevealPhase = 'loading' | 'absent' | 'error' | 'ready' | 'stale'

// The resolved view model the component renders straight off — every derived flag is decided here, so
// the view never combines `phase`/`cursor` itself. `current` is the lot in focus (the last revealed
// step); `complete` is a fully-revealed `ready`; `canAdvance` is the single truth the „Weiter" button
// and the keydown handler both gate on (it already folds in whether an advance is mid-flight, so the
// view never sees a separate busy flag).
export interface RevealState {
  phase: RevealPhase
  draw: PublicDraw | null
  current: PublicRevealStep | null
  cursor: number
  total: number
  complete: boolean
  canAdvance: boolean
}

// The controller's two server seams (the existing useReveal port) plus an injectable `sleep`. The
// competition is bound into the closures by the caller, so the controller never sees a slug.
export interface RevealDeps {
  load: () => Promise<RevealRead>
  advance: (direction: 'forward') => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
}

export interface RevealController {
  getState: () => RevealState
  subscribe: (listener: () => void) => () => void
  // Read the current reveal, retrying a transient error a few times before settling. Playback only — it
  // never advances the cursor. Resume-on-open and the post-advance re-read both go through here.
  refresh: () => Promise<void>
  // Move the cursor one lot forward, then re-read to pick it up. A no-op unless a fresh reveal is on
  // screen and idle (`canAdvance`) — the guard is what stops a held presenter key revealing two lots.
  step: () => Promise<void>
}

const realSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// Derive the full view model from the phase, the last good draw, and whether an advance is in flight.
// One place owns „what is the lot in focus / is it complete / may we advance" so the rules are tested
// here, not re-derived in render.
const project = (phase: RevealPhase, draw: PublicDraw | null, busy: boolean): RevealState => {
  const cursor = draw?.cursor ?? 0
  const total = draw?.total ?? 0
  const steps = draw?.steps ?? []
  const complete = total > 0 && cursor === total
  return {
    phase,
    draw,
    current: steps.length > 0 ? steps[steps.length - 1] : null,
    cursor,
    total,
    complete,
    // Forward only from a fresh reveal that is neither complete nor mid-advance. `stale`/`error`/
    // `absent`/`loading` are all not-`ready`, so a key press on any of them can't move the server cursor.
    canAdvance: phase === 'ready' && !complete && !busy
  }
}

export const createReveal = ({ load, advance, sleep = realSleep }: RevealDeps): RevealController => {
  let state: RevealState = project('loading', null, false)
  const listeners = new Set<() => void>()
  // The synchronous double-fire guard: set before the first await in `step`, so a second activation that
  // fires faster than any state propagation sees it already up and bails — never timing-dependent.
  let busy = false

  const set = (next: RevealState): void => {
    state = next
    for (const listener of listeners) listener()
  }

  const refresh = async (): Promise<void> => {
    for (let attempt = 0; attempt <= READ_RETRIES; attempt++) {
      // A rejecting load is the seam's contract being broken (the prod loadReveal catches and returns
      // `error`); treat a throw as a transient read failure so it retries and settles to error/stale,
      // never stranding the show in `loading` with no way back but a page reload.
      const result = await load().catch((): RevealRead => ({ status: 'error' }))
      if (result.status === 'ok') return set(project('ready', result.draw, busy))
      if (result.status === 'absent') return set(project('absent', null, busy))
      if (attempt < READ_RETRIES) await sleep(RETRY_DELAY_MS)
    }
    // Every attempt failed: hold the last good reveal as `stale` (paused until a clean re-read), or, with
    // nothing yet on screen, surface the load `error`. Either way advancing stays blocked.
    set(project(state.draw ? 'stale' : 'error', state.draw, busy))
  }

  const step = async (): Promise<void> => {
    if (busy || !state.canAdvance) return
    busy = true
    set(project(state.phase, state.draw, true))
    try {
      if (await advance('forward')) await refresh()
    } finally {
      busy = false
      // Re-project the settled phase without the in-flight flag, so `canAdvance` reopens (advance failed
      // → retry the same lot; advance took → the re-read already moved `state` to the next lot).
      set(project(state.phase, state.draw, false))
    }
  }

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    step
  }
}
