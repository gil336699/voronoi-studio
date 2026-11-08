import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planChange } from '../lib/changes'
import { cutDxf } from '../lib/dxfExport'
import { parseProject, serializeProject } from '../lib/project'
import { DEFAULTS, sanitizeSettings, type Settings } from '../lib/settings'
import { readSvgOutlines } from '../lib/svgShape'
import { laserSvg } from '../lib/svgExport'
import { buildCells, cellArea } from './diagram'
import type { Polygon } from './geometry'
import { buildGeometry, patternRegion } from './pattern'
import { relax } from './relax'
import { contains, insetRegion, regionArea, regionPerimeter, sheetRegion } from './region'
import { seedPoints, type SeedSettings } from './seeding'
import { sanitizeShape, shapeFromOutlines } from './shape'

const svg = readFileSync(new URL('../../test-fixtures/pill-with-hole.svg', import.meta.url), 'utf8')
const pill = shapeFromOutlines(readSvgOutlines(svg).rings, 'pill-with-hole.svg')
const settings: Settings = { ...DEFAULTS, width: 160, height: 80, shape: 'custom', customShape: pill, border: 4 }
const seed = (over: Partial<SeedSettings> = {}): SeedSettings => ({
  count: 200, placement: 'even', autoSpacing: true, spacing: 10, tries: 30, jitter: 0.3, seed: 7,
  density: { mode: 'none', strength: 4, angle: 0, invert: false }, ...over,
})
const AREA = Math.PI * 40 * 40 + 80 * 80 - Math.PI * 15 * 15

// Point in polygon, even-odd, as a check independent of the shape index.
function inside(ring: Polygon, x: number, y: number) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

describe('custom sheet shapes', () => {
  const sheet = sheetRegion(160, 80, 'custom', pill)

  it('measures the shape and knows what is inside it', () => {
    expect(regionArea(sheet)).toBeCloseTo(AREA, -1)
    expect(regionPerimeter(sheet)).toBeCloseTo(2 * Math.PI * 40 + 160 + 2 * Math.PI * 15, -1)
    expect(contains(sheet, 20, 40)).toBe(true)
    expect(contains(sheet, 80, 40)).toBe(false) // the hole
    expect(contains(sheet, 2, 2)).toBe(false) // outside the rounded end
    // The border grows the hole and shrinks the outline.
    const inner = insetRegion(sheet, 4)
    expect(contains(inner, 80, 40 - 17)).toBe(false)
    expect(regionArea(inner)).toBeCloseTo(Math.PI * 36 * 36 + 80 * 72 - Math.PI * 19 * 19, -1)
  })

  it('seeds every placement inside the shape and tiles it with cells', () => {
    const region = patternRegion(settings)
    for (const placement of ['random', 'even', 'hex', 'square'] as const) {
      const { points } = seedPoints(seed({ placement }), region)
      const n = points.length / 2
      expect(Math.abs(n - 200)).toBeLessThanOrEqual(placement === 'random' ? 0 : 12)
      for (let i = 0; i < points.length; i += 2) expect(contains(region, points[i], points[i + 1])).toBe(true)
      const cells = buildCells(points, region)
      const total = cells.reduce((a, c) => a + (c ? cellArea(c) : 0), 0)
      expect(total / regionArea(region)).toBeCloseTo(1, 3)
    }
  })

  it('keeps relaxed points and gradients inside the shape', () => {
    const region = patternRegion(settings)
    const density = { mode: 'radial' as const, strength: 6, angle: 0, invert: true }
    const { points } = seedPoints(seed({ placement: 'random', density }), region)
    const relaxed = relax(points, region, density, 20)
    for (let i = 0; i < relaxed.points.length; i += 2) expect(contains(region, relaxed.points[i], relaxed.points[i + 1])).toBe(true)
  })

  it('clips Lines edges to the shape', () => {
    const s = { ...settings, cellStyle: 'lines' as const }
    const g = buildGeometry(seedPoints(seed(), patternRegion(s)).points, s)
    expect(g.edges.internal.length).toBeGreaterThan(300)
    for (const [x0, y0, x1, y1] of g.edges.internal) expect(contains(g.region, (x0 + x1) / 2, (y0 + y1) / 2)).toBe(true)
  })

  it('cuts holes that keep the frame round the outline and the hole', () => {
    const s = { ...settings, cellStyle: 'holes' as const, web: 2, cornerRadius: 1, minHole: 0.5 }
    const g = buildGeometry(seedPoints(seed(), patternRegion(s)).points, s)
    expect(g.holes.length).toBeGreaterThan(150)
    const frame = insetRegion(g.sheet, s.border - 0.02)
    for (const hole of g.holes) for (const [x, y] of hole.outline.points) expect(contains(frame, x, y)).toBe(true)
    // No hole may reach within the border of the shape's own hole.
    for (const hole of g.holes) for (const [x, y] of hole.outline.points) expect(Math.hypot(x - 80, y - 40)).toBeGreaterThan(15 + s.border - 0.02)
  })

  it('bridges a cell that wraps right round the hole, so the frame stays attached', () => {
    const s = { ...settings, cellStyle: 'holes' as const, web: 2, cornerRadius: 1, minHole: 0.5, border: 3 }
    // Three points: the middle cell surrounds the hole.
    const points = Float64Array.from([20, 40, 80, 8, 140, 40])
    const g = buildGeometry(points, s)
    expect(g.holes.length).toBeGreaterThan(0)
    for (const hole of g.holes) expect(inside(hole.outline.points, 80, 40)).toBe(false)
    for (const hole of g.holes) expect(inside(hole.outline.points, 80, 40 - 15 - 1.5)).toBe(false)
  })

  it('exports the outline as the outer cut and its hole as an inner cut', () => {
    const s = { ...settings, cellStyle: 'holes' as const }
    const g = buildGeometry(seedPoints(seed(), patternRegion(s)).points, s)
    const laser = laserSvg(g, s)
    const outer = /<g id="cut-outer"[^>]*>(.*?)<\/g>/s.exec(laser)![1]
    expect(outer.match(/<path /g)).toHaveLength(1)
    expect(outer).toContain('fill-rule="evenodd"')
    const inner = /<g id="cut-inner"[^>]*>(.*?)<\/g>/s.exec(laser)![1]
    expect(inner.match(/<path /g)!.length).toBe(g.holes.length + 1)
    const dxf = cutDxf(g, s)
    expect(dxf.split('\nCUT_OUTER\n').length - 1).toBeGreaterThan(10) // the outline's polyline and its vertices
    expect(dxf.match(/\nPOLYLINE\n/g)).toHaveLength(g.holes.length + 2)
  })

  it('saves the shape in version 2 project files and rejects damaged shapes', () => {
    const back = parseProject(serializeProject({ settings, points: Float64Array.from([20, 40]), handEdited: false }))
    expect(back.settings.shape).toBe('custom')
    expect(back.settings.customShape).toEqual(pill)
    expect(JSON.parse(serializeProject({ settings, points: new Float64Array(), handEdited: false })).version).toBe(2)
    expect(sanitizeShape({ ...pill, rings: [[0, 0, 1]] })).toBeNull()
    expect(sanitizeShape({ ...pill, rings: [[0, 0, 5, 0, 0, 1]] })).toBeNull()
    // A custom sheet without a usable shape falls back to a rectangle.
    expect(sanitizeSettings({ shape: 'custom', customShape: 'nonsense' }).shape).toBe('rect')
  })

  it('makes a new pattern when switching to a shape, and keeps points inside when resizing it', () => {
    const rect = { settings: DEFAULTS, points: Float64Array.from([10, 10, 190, 190]), handEdited: false, stale: false }
    expect(planChange(rect, { shape: 'custom', customShape: pill, width: 160, height: 80 }).remake).toBe(true)
    expect(planChange({ ...rect, handEdited: true }, { shape: 'custom', customShape: pill }).next.stale).toBe(true)
    const region = patternRegion(settings)
    const { points } = seedPoints(seed(), region)
    const doc = { settings, points, handEdited: true, stale: false }
    const { next, remake } = planChange(doc, { width: 240, height: 120 })
    expect(remake).toBe(false)
    const bigger = patternRegion(next.settings)
    for (let i = 0; i < next.points.length; i += 2) expect(contains(bigger, next.points[i], next.points[i + 1])).toBe(true)
  })
})
