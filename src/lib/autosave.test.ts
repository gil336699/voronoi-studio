import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosave } from './autosave'

describe('session autosave', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('writes once, a moment after a single change', () => {
    const write = vi.fn()
    const a = createAutosave(write)
    a.changed()
    vi.advanceTimersByTime(599)
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(write).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('keeps writing while changes never stop, as when Auto-relax runs', () => {
    const times: number[] = []
    const a = createAutosave(() => times.push(Date.now()))
    const start = Date.now()
    for (let t = 0; t < 10_000; t += 16) { a.changed(); vi.advanceTimersByTime(16) }
    expect(times.length).toBeGreaterThanOrEqual(4)
    const gaps = times.map((t, i) => t - (i ? times[i - 1] : start))
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2016)
  })

  it('writes what is pending at once when the page is hidden or closed, and nothing when nothing is', () => {
    const write = vi.fn()
    const a = createAutosave(write)
    a.flush()
    expect(write).not.toHaveBeenCalled()
    a.changed()
    a.flush()
    expect(write).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(write).toHaveBeenCalledTimes(1)
  })
})
