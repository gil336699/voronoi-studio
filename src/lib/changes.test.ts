import { describe, expect, it } from 'vitest'
import { runJob } from '../worker/jobs'
import { patternRegion } from '../voronoi/pattern'
import { contains } from '../voronoi/region'
import { planChange, type Doc } from './changes'
import { DEFAULTS } from './settings'
import { shapeFromOutlines } from '../voronoi/shape'
import type { Polygon } from '../voronoi/geometry'

const doc = (over: Partial<Doc> = {}): Doc => ({ settings: DEFAULTS, points: runJob({ kind: 'generate', settings: DEFAULTS }).points, handEdited: false, stale: false, ...over })

describe('what a settings change does to the points', () => {
  it('makes a new pattern for pattern settings, or waits if points were edited by hand', () => {
    expect(planChange(doc(), { count: 120 }).remake).toBe(true)
    const prev = doc({ handEdited: true })
    const edited = planChange(prev, { count: 120 })
    expect(edited.remake).toBe(false)
    expect(edited.next.stale).toBe(true)
    expect(edited.next.points).toBe(prev.points)
  })

  it('stretches points to a new sheet when Keep points is on, and remakes when it is off', () => {
    const kept = planChange(doc(), { width: 400 })
    expect(kept.remake).toBe(false)
    expect(Math.max(...kept.next.points.filter((_, i) => i % 2 === 0))).toBeGreaterThan(300)
    expect(planChange(doc({ settings: { ...DEFAULTS, keepPoints: false } }), { width: 400 }).remake).toBe(true)
  })

  it('makes a pattern when the border is lowered after it left no room, even with Keep points on', () => {
    // Twenty 2.1 mm strokes: a 1.5 mm border leaves nothing to fill, so the design has no points to keep.
    const comb = shapeFromOutlines(Array.from({ length: 20 }, (_, k) => [[k * 10, 0], [k * 10 + 2.1, 0], [k * 10 + 2.1, 100], [k * 10, 100]] as Polygon), 'comb.svg')
    const settings = { ...DEFAULTS, shape: 'custom' as const, customShape: comb, width: 192.1, height: 100, border: 1.5, keepPoints: true }
    const empty: Doc = { settings, points: new Float64Array(), handEdited: false, stale: false }
    expect(planChange(empty, { border: 1 }).remake).toBe(true)
    expect(planChange(empty, { width: 150 }).remake).toBe(true)
    // With room, Keep points still keeps them.
    const roomy: Doc = { ...empty, settings: { ...settings, border: 0 }, points: Float64Array.from([1, 50]) }
    expect(planChange(roomy, { border: 0.5 }).remake).toBe(false)
  })

  it('keeps every point inside when the sheet becomes an ellipse', () => {
    const { next } = planChange(doc(), { shape: 'ellipse' })
    const region = patternRegion(next.settings)
    for (let i = 0; i < next.points.length; i += 2) expect(contains(region, next.points[i], next.points[i + 1])).toBe(true)
  })

  it('never remakes the pattern for style changes', () => {
    const before = doc()
    for (const patch of [{ lineColor: '#000000' }, { cellStyle: 'holes' as const }, { web: 5 }, { showSites: false }, { units: 'in' as const }]) {
      const { next, remake } = planChange(before, patch)
      expect(remake).toBe(false)
      expect(next.points.length).toBe(before.points.length)
    }
  })

  it('keeps pixel sizes when pixels per inch changes on a pixel sheet', () => {
    const px = doc({ settings: { ...DEFAULTS, units: 'px', width: 91.44, height: 91.44, web: 2 } })
    const { next } = planChange(px, { dpi: 72 })
    expect((next.settings.width / 25.4) * 72).toBeCloseTo(1080)
    expect(next.settings.web).toBeCloseTo(2 * (300 / 72))
    // On a millimetre sheet the size stays put.
    expect(planChange(doc(), { dpi: 72 }).next.settings.width).toBe(200)
  })
})
