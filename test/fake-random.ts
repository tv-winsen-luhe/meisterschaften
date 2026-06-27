import type { RandomSource } from '../shared'

// A deterministic RandomSource for the draw tests: `int(n)` returns the next scripted value, so a
// known sequence yields an exactly-known bracket. It asserts each value is in range (< n) to catch a
// mis-scripted sequence, and that the sequence is not over-drawn — both would otherwise pass quietly.
export const createFakeRandomSource = (sequence: number[]): RandomSource => {
  let i = 0
  return {
    int(n) {
      if (i >= sequence.length) throw new Error(`fake RandomSource exhausted after ${sequence.length} draws`)
      const v = sequence[i++]
      if (v < 0 || v >= n) throw new Error(`fake RandomSource value ${v} out of range for int(${n})`)
      return v
    }
  }
}
