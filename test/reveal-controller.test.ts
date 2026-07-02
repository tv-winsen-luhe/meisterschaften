import { describe, expect, it, vi } from 'vitest'
import type { PublicDraw, PublicRevealStep } from '../shared'
import { createReveal } from '../src/admin/reveal-controller'

// The draw show's playback engine (issue #71), tested in isolation — no DOM, no rendering. The retry
// loop, the loading→ok→absent→error→stale reducer, and the double-fire guard used to live inside the
// DrawShow component, reachable only by rendering and faking a presenter remote; lifted into a
// framework-agnostic store they are plain unit tests here. `sleep` is faked so the retries run instantly.

const step = (i: number): PublicRevealStep => ({
  kind: 'draw',
  position: i,
  seed: null,
  player: { firstName: `P${i}`, lastName: 'Player', lk: null }
})

// A reveal at `cursor`/`total` over an 8-field: the revealed prefix is the first `cursor` steps, so the
// lot in focus is step(cursor − 1).
const drawAt = (cursor: number, total: number): PublicDraw => ({
  competition: 'mens',
  size: 8,
  cursor,
  total,
  // The operator reveal never redacts (ADR-0024, ADR-0048) — the beamer reads the full draw.
  redacted: false,
  steps: Array.from({ length: cursor }, (_, i) => step(i))
})

const noSleep = async (): Promise<void> => {}

describe('createReveal.refresh', () => {
  it('1 — a clean read lands a ready reveal with the last revealed lot in focus', async () => {
    const load = vi.fn().mockResolvedValue({ status: 'ok', draw: drawAt(3, 8) })
    const r = createReveal({ load, advance: vi.fn(), sleep: noSleep })

    await r.refresh()

    const s = r.getState()
    expect(s.phase).toBe('ready')
    expect(s.cursor).toBe(3)
    expect(s.total).toBe(8)
    expect(s.current).toEqual(step(2))
    expect(s.canAdvance).toBe(true)
  })

  it('2 — an absent read is a genuinely un-drawn field', async () => {
    const load = vi.fn().mockResolvedValue({ status: 'absent' })
    const r = createReveal({ load, advance: vi.fn(), sleep: noSleep })

    await r.refresh()

    expect(r.getState().phase).toBe('absent')
    expect(r.getState().canAdvance).toBe(false)
  })

  it('3 — a read error with nothing on screen surfaces the error', async () => {
    const load = vi.fn().mockResolvedValue({ status: 'error' })
    const r = createReveal({ load, advance: vi.fn(), sleep: noSleep })

    await r.refresh()

    expect(r.getState().phase).toBe('error')
    expect(r.getState().draw).toBeNull()
  })

  it('4 — a read error after a good reveal goes stale, keeping the last reveal', async () => {
    const load = vi.fn().mockResolvedValueOnce({ status: 'ok', draw: drawAt(2, 8) })
    const r = createReveal({ load, advance: vi.fn(), sleep: noSleep })
    await r.refresh()

    load.mockResolvedValue({ status: 'error' })
    await r.refresh()

    const s = r.getState()
    expect(s.phase).toBe('stale')
    expect(s.draw).toEqual(drawAt(2, 8))
    expect(s.canAdvance).toBe(false)
  })

  it('5 — a transient error recovers within the retries (and sleeps between tries)', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ status: 'error' })
      .mockResolvedValueOnce({ status: 'ok', draw: drawAt(1, 8) })
    const sleep = vi.fn(noSleep)
    const r = createReveal({ load, advance: vi.fn(), sleep })

    await r.refresh()

    expect(r.getState().phase).toBe('ready')
    expect(load).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('5b — a rejecting load is treated as a transient failure, not a stranded loading', async () => {
    const load = vi.fn().mockRejectedValue(new Error('network down'))
    const r = createReveal({ load, advance: vi.fn(), sleep: noSleep })

    await r.refresh()

    expect(r.getState().phase).toBe('error') // settled, retry button reachable — never stuck on „Lädt …"
    expect(load).toHaveBeenCalledTimes(3) // a throw rides the same retry loop as an `error` result
  })

  it('6 — every attempt failing settles error and blocks advancing', async () => {
    const load = vi.fn().mockResolvedValue({ status: 'error' })
    const sleep = vi.fn(noSleep)
    const r = createReveal({ load, advance: vi.fn(), sleep })

    await r.refresh()

    expect(r.getState().phase).toBe('error')
    expect(r.getState().canAdvance).toBe(false)
    expect(load).toHaveBeenCalledTimes(3) // 1 + READ_RETRIES
    expect(sleep).toHaveBeenCalledTimes(2) // a pause between each retry, not after the last
  })
})

describe('createReveal.step', () => {
  it('7 — advancing is a no-op until a fresh reveal is on screen', async () => {
    const advance = vi.fn()
    const r = createReveal({ load: vi.fn().mockResolvedValue({ status: 'absent' }), advance, sleep: noSleep })

    await r.step() // still loading
    await r.refresh() // → absent
    await r.step()

    expect(advance).not.toHaveBeenCalled()
  })

  it('8 — two activations before the first resolves coalesce into one advance', async () => {
    let release: (took: boolean) => void = () => {}
    const advance = vi.fn(() => new Promise<boolean>(resolve => (release = resolve)))
    const load = vi.fn().mockResolvedValue({ status: 'ok', draw: drawAt(1, 8) })
    const r = createReveal({ load, advance, sleep: noSleep })
    await r.refresh()

    const first = r.step()
    const second = r.step() // sees the synchronous guard up → bails
    release(false)
    await Promise.all([first, second])

    expect(advance).toHaveBeenCalledTimes(1)
  })

  it('9 — an advance that does not take leaves the cursor and reopens advancing', async () => {
    const load = vi.fn().mockResolvedValue({ status: 'ok', draw: drawAt(2, 8) })
    const advance = vi.fn().mockResolvedValue(false)
    const r = createReveal({ load, advance, sleep: noSleep })
    await r.refresh()

    await r.step()

    expect(load).toHaveBeenCalledTimes(1) // no re-read after a no-op advance
    expect(r.getState().cursor).toBe(2)
    expect(r.getState().canAdvance).toBe(true)
  })

  it('10 — an advance that takes re-reads and moves the cursor on', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ok', draw: drawAt(1, 8) })
      .mockResolvedValueOnce({ status: 'ok', draw: drawAt(2, 8) })
    const advance = vi.fn().mockResolvedValue(true)
    const r = createReveal({ load, advance, sleep: noSleep })
    await r.refresh()

    await r.step()

    expect(load).toHaveBeenCalledTimes(2)
    expect(r.getState().cursor).toBe(2)
    expect(r.getState().current).toEqual(step(1))
  })

  it('11 — a fully revealed draw is complete and cannot be advanced', async () => {
    const advance = vi.fn()
    const r = createReveal({
      load: vi.fn().mockResolvedValue({ status: 'ok', draw: drawAt(8, 8) }),
      advance,
      sleep: noSleep
    })

    await r.refresh()
    await r.step()

    expect(r.getState().complete).toBe(true)
    expect(r.getState().canAdvance).toBe(false)
    expect(advance).not.toHaveBeenCalled()
  })
})
