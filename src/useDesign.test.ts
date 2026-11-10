import { describe, expect, it } from 'vitest'
import { keepEdits } from './useDesign'

describe('Auto-relax during hand edits', () => {
  const from = new Float64Array([10, 10, 20, 20, 30, 30])
  const relaxed = new Float64Array([11, 11, 21, 21, 31, 31])

  it('applies a relax step whole when nothing was edited meanwhile', () => {
    expect(keepEdits(relaxed, from, from)).toBe(relaxed)
  })

  it('keeps a point dragged while the step ran where the person put it', () => {
    const now = new Float64Array([10, 10, 25, 18, 30, 30])
    expect(Array.from(keepEdits(relaxed, from, now)!)).toEqual([11, 11, 25, 18, 31, 31])
  })

  it('leaves the point being held where it is, even if it did not move during the step', () => {
    const out = keepEdits(relaxed, from, from, 1)!
    expect(Array.from(out)).toEqual([11, 11, 20, 20, 31, 31])
    expect(Array.from(relaxed)).toEqual([11, 11, 21, 21, 31, 31]) // the worker's result is left as it was
  })

  it('drops the step when points were added or erased meanwhile', () => {
    expect(keepEdits(relaxed, from, new Float64Array([10, 10, 20, 20]))).toBeNull()
    expect(keepEdits(relaxed, from, new Float64Array([10, 10, 20, 20, 30, 30, 40, 40]))).toBeNull()
  })
})
