import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readSvgOutlines } from '../lib/svgShape'
import { buildCells, cellArea, delaunayEdges, nearestPoint, type Cell } from './diagram'
import { isConvex, type Polygon } from './geometry'
import { buildGeometry, patternRegion } from './pattern'
import { createRng } from './random'
import { insetRegion, regionArea, sheetRegion, type Region } from './region'
import { relax } from './relax'
import { seedPoints, type SeedSettings } from './seeding'
import { shapeFromOutlines } from './shape'
import { stretchFrame, toSheet, toWork, type Stretch } from './stretch'

const flat = { mode: 'none' as const, strength: 1, angle: 0, invert: false }
const seed = (over: Partial<SeedSettings> = {}): SeedSettings => ({ count: 600, placement: 'even', autoSpacing: true, spacing: 10, tries: 30, jitter: 0, seed: 4, density: flat, ...over })
const rect: Region = { shape: 'rect', x0: 5, y0: 5, x1: 195, y1: 145 }
const oval: Region = { shape: 'ellipse', x0: 0, y0: 0, x1: 160, y1: 100 }

// Point in polygon, even-odd over a cell's rings.
function inside(cell: Cell, x: number, y: number): boolean {
  let hit = false
  for (const ring of cell) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

// A cell's long-to-short axis ratio and the long axis's angle (0° right, 90° up), from its second moments.
function shapeOf(ring: Polygon): { aspect: number; angle: number } {
  let A = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length; i++) { const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length], c = x0 * y1 - x1 * y0; A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c }
  A /= 2; cx /= 6 * A; cy /= 6 * A
  let xx = 0, yy = 0, xy = 0
  for (let i = 0; i < ring.length; i++) {
    const x0 = ring[i][0] - cx, y0 = ring[i][1] - cy, x1 = ring[(i + 1) % ring.length][0] - cx, y1 = ring[(i + 1) % ring.length][1] - cy, c = x0 * y1 - x1 * y0
    xx += (x0 * x0 + x0 * x1 + x1 * x1) * c; yy += (y0 * y0 + y0 * y1 + y1 * y1) * c; xy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c
  }
  const h = (xx - yy) / 24, q = xy / 24, mid = (xx + yy) / 24, root = Math.hypot(h, q)
  return { aspect: Math.sqrt((mid + root) / (mid - root)), angle: ((-Math.atan2(q, h) * 90) / Math.PI + 180) % 180 }
}

describe('stretched cells', () => {
  it('squeezes and stretches back exactly, keeping areas, with right angles exactly on the axes', () => {
    for (const angle of [0, 30, 90, 135]) {
      const f = stretchFrame({ amount: 3, angle })!
      expect(f.a * f.c - f.b * f.b).toBeCloseTo(1, 12)
      const [x, y] = toSheet(f, ...toWork(f, 12.5, -7))
      expect(x).toBeCloseTo(12.5, 12); expect(y).toBeCloseTo(-7, 12)
      expect(f.axis).toBe(angle % 90 === 0)
      if (f.axis) expect(f.b).toBe(0)
    }
    expect(stretchFrame({ amount: 1, angle: 40 })).toBeNull()
    expect(stretchFrame(null)).toBeNull()
  })

  it('still fills the region exactly, with straight-edged convex cells that hold their own points', () => {
    const stretch: Stretch = { amount: 3, angle: 30 }
    for (const region of [rect, oval]) {
      const { points } = seedPoints(seed({ stretch }), region)
      const cells = buildCells(points, region, stretch)
      expect(cells.every(Boolean)).toBe(true)
      const total = cells.reduce((a, c) => a + (c ? cellArea(c) : 0), 0)
      expect(total / regionArea(region)).toBeCloseTo(region.shape === 'rect' ? 1 : 0.99993, 3)
      expect(cells.every(c => c!.length === 1 && isConvex(c![0]))).toBe(true)
      expect(cells.every((c, i) => inside(c!, points[i * 2], points[i * 2 + 1]))).toBe(true)
    }
  })

  it('relaxes into cells as many times longer than wide as the stretch, along its direction', () => {
    for (const stretch of [{ amount: 2, angle: 0 }, { amount: 3, angle: 30 }, { amount: 4, angle: 135 }]) {
      const region: Region = { shape: 'rect', x0: 0, y0: 0, x1: 200, y1: 200 }
      const { points } = relax(seedPoints(seed({ count: 1200, stretch }), region).points, region, flat, 30, stretch)
      const inner = buildCells(points, region, stretch).filter(c => c && c[0].every(([x, y]) => x > 25 && x < 175 && y > 25 && y < 175)) as Cell[]
      const shapes = inner.map(c => shapeOf(c[0]))
      const aspect = [...shapes.map(s => s.aspect)].sort((a, b) => a - b)[Math.floor(shapes.length / 2)]
      const angle = (Math.atan2(shapes.reduce((s, x) => s + Math.sin((x.angle * Math.PI) / 90), 0), shapes.reduce((s, x) => s + Math.cos((x.angle * Math.PI) / 90), 0)) * 90 / Math.PI + 180) % 180
      expect(aspect / stretch.amount).toBeGreaterThan(0.9)
      expect(aspect / stretch.amount).toBeLessThan(1.1)
      expect(Math.min(Math.abs(angle - stretch.angle), 180 - Math.abs(angle - stretch.angle))).toBeLessThan(3)
    }
  })

  it('finds the cell under a point with the stretch’s ellipse', () => {
    const stretch: Stretch = { amount: 4, angle: 60 }
    const { points } = seedPoints(seed({ count: 300, stretch }), rect)
    const cells = buildCells(points, rect, stretch)
    const rng = createRng(9)
    let wrongWithout = 0
    for (let k = 0; k < 400; k++) {
      const x = 10 + rng() * 180, y = 10 + rng() * 130
      const owner = cells.findIndex(c => c && inside(c, x, y))
      if (owner < 0) continue
      expect(nearestPoint(points, x, y, stretch).index).toBe(owner)
      if (nearestPoint(points, x, y).index !== owner) wrongWithout++
    }
    expect(wrongWithout).toBeGreaterThan(20) // plain distance picks a neighbour often, so the ellipse matters
  })

  it('works in an imported shape with a hole, and in Holes style', () => {
    const svg = readFileSync(new URL('../../test-fixtures/pill-with-hole.svg', import.meta.url), 'utf8')
    const outlines = readSvgOutlines(svg)
    const custom = shapeFromOutlines(outlines.rings, 'pill', outlines.units)
    const s = { width: custom.width, height: custom.height, shape: 'custom' as const, customShape: custom, border: 3, cellStyle: 'holes' as const, web: 1, cornerRadius: 0.5, minHole: 0.3, showDelaunay: true, stretch: 2.5, stretchAngle: 20 }
    const region = patternRegion(s)
    const { points } = seedPoints(seed({ count: 400, stretch: { amount: 2.5, angle: 20 } }), region)
    const g = buildGeometry(points, s)
    expect(g.metrics.cells).toBe(400)
    const total = g.cells.reduce((a, c) => a + (c ? cellArea(c) : 0), 0)
    expect(total / regionArea(region)).toBeCloseTo(1, 3)
    expect(g.metrics.holes + g.metrics.dropped).toBeGreaterThanOrEqual(400)
    expect(g.metrics.narrowest).toBeGreaterThanOrEqual(0.3)
    expect(g.delaunay.length).toBeGreaterThan(400)
    expect(delaunayEdges(points, region, { amount: 2.5, angle: 20 }).length).toBe(g.delaunay.length)
  })

  it('changes nothing at 1×', () => {
    const region = insetRegion(sheetRegion(200, 150, 'ellipse'), 5)
    const a = seedPoints(seed(), region), b = seedPoints(seed({ stretch: { amount: 1, angle: 45 } }), region)
    expect(Array.from(b.points)).toEqual(Array.from(a.points))
    expect(buildCells(a.points, region, { amount: 1, angle: 45 })).toEqual(buildCells(a.points, region))
  })
})
