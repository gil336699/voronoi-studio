import { describe, expect, it } from 'vitest'
import type { DensitySettings } from './density'
import { buildCells, buildDiagram, delaunayEdges, nearestPoint, uniqueEdges } from './diagram'
import { area } from './geometry'
import { arcFromBulge, makeHole, outlineLength } from './holes'
import { buildGeometry, patternRegion, type PatternSettings } from './pattern'
import { createRng } from './random'
import { contains, regionArea, sheetRegion } from './region'
import { relax } from './relax'
import { poissonDisk, seedPoints, type SeedSettings } from './seeding'

const flat: DensitySettings = { mode: 'none', strength: 1, angle: 0, invert: false }
const seed = (over: Partial<SeedSettings> = {}): SeedSettings => ({
  count: 300, placement: 'even', autoSpacing: true, spacing: 10, tries: 30, jitter: 0, seed: 7, density: flat, ...over,
})
const sheet = sheetRegion(200, 200, 'rect')
const oval = sheetRegion(200, 120, 'ellipse')

function evenness(points: Float64Array, region = sheet) {
  const areas = buildCells(points, region).flatMap(c => (c ? [area(c)] : []))
  const mean = areas.reduce((a, b) => a + b, 0) / areas.length
  return Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length) / mean
}

describe('seeding', () => {
  it('is the same for the same seed and different for another', () => {
    for (const placement of ['random', 'even', 'hex', 'square'] as const) {
      const a = seedPoints(seed({ placement, jitter: 0.4 }), sheet).points
      expect(seedPoints(seed({ placement, jitter: 0.4 }), sheet).points).toEqual(a)
      if (placement !== 'square' && placement !== 'hex') expect(seedPoints(seed({ placement, seed: 8 }), sheet).points).not.toEqual(a)
    }
  })

  it('gives the exact count for random and even placement, inside the region', () => {
    for (const region of [sheet, oval]) {
      for (const placement of ['random', 'even'] as const) {
        const { points } = seedPoints(seed({ placement }), region)
        expect(points.length / 2).toBe(300)
        for (let i = 0; i < points.length; i += 2) expect(contains(region, points[i], points[i + 1])).toBe(true)
      }
    }
  })

  it('keeps the minimum spacing with manual Poisson spacing', () => {
    const { points } = poissonDisk(sheet, 12, 30, flat, createRng(3))
    let closest = Infinity
    for (let i = 0; i < points.length; i += 2) for (let j = i + 2; j < points.length; j += 2) {
      closest = Math.min(closest, Math.hypot(points[i] - points[j], points[i + 1] - points[j + 1]))
    }
    expect(closest).toBeGreaterThanOrEqual(12)
    // A full sample at 12 mm spacing on 200 × 200 mm holds roughly 0.6–0.75 of hexagonal packing (321 points).
    expect(points.length / 2).toBeGreaterThan(180)
    expect(points.length / 2).toBeLessThan(260)
  })

  it('spreads even points more evenly than random ones', () => {
    expect(evenness(seedPoints(seed({ placement: 'even' }), sheet).points)).toBeLessThan(evenness(seedPoints(seed({ placement: 'random' }), sheet).points) * 0.7)
  })

  it('places grids within a few percent of the requested count, filling the region evenly', () => {
    for (const region of [sheet, oval, sheetRegion(600, 400, 'rect')]) {
      for (const placement of ['hex', 'square'] as const) {
        for (const count of [82, 300, 2000]) {
          const { points } = seedPoints(seed({ placement, count }), region)
          expect(Math.abs(points.length / 2 - count) / count).toBeLessThan(0.05)
        }
      }
    }
    // An unjittered square grid tiles a square sheet with identical cells.
    expect(evenness(seedPoints(seed({ placement: 'square', count: 400 }), sheet).points)).toBeLessThan(1e-9)
  })

  it('stops at the point limit when the spacing is tiny', () => {
    const result = seedPoints(seed({ placement: 'square', autoSpacing: false, spacing: 0.1 }), sheet)
    expect(result.capped).toBe(true)
    expect(result.points.length / 2).toBeLessThanOrEqual(20_000)
  })

  it('puts more points on the dense side of a gradient', () => {
    const density: DensitySettings = { mode: 'linear', strength: 6, angle: 0, invert: false }
    for (const placement of ['random', 'even'] as const) {
      const { points } = seedPoints(seed({ placement, density }), sheet)
      let right = 0
      for (let i = 0; i < points.length; i += 2) if (points[i] > 100) right++
      expect(right / (points.length / 2)).toBeGreaterThan(0.68)
    }
  })
})

describe('diagram', () => {
  const { points } = seedPoints(seed(), sheet)

  it('tiles the region with one cell per point', () => {
    const cells = buildCells(points, sheet)
    expect(cells.filter(Boolean)).toHaveLength(300)
    expect(cells.reduce((a, c) => a + (c ? area(c) : 0), 0)).toBeCloseTo(40_000, 3)
    const ovalPoints = seedPoints(seed(), oval).points
    expect(buildCells(ovalPoints, oval).reduce((a, c) => a + (c ? area(c) : 0), 0)).toBeCloseTo(regionArea(oval), -2)
  })

  it('lists every edge once', () => {
    const cells = buildCells(points, sheet)
    const sides = cells.reduce((a, c) => a + (c ? c.length : 0), 0)
    const { internal, boundary } = uniqueEdges(cells)
    expect(internal.length * 2 + boundary.length).toBe(sides)
    expect(boundary.reduce((a, s) => a + Math.hypot(s[2] - s[0], s[3] - s[1]), 0)).toBeCloseTo(800, 6)
    // d3's own edge list matches the edges found by matching cell sides, in rectangles and ellipses.
    const length = (list: number[][]) => list.reduce((a, s) => a + Math.hypot(s[2] - s[0], s[3] - s[1]), 0)
    const fast = buildDiagram(points, sheet).internal
    expect(fast.length).toBe(internal.length)
    expect(length(fast)).toBeCloseTo(length(internal), 6)
    const ovalPoints = seedPoints(seed(), oval).points
    const slow = uniqueEdges(buildCells(ovalPoints, oval)).internal, quick = buildDiagram(ovalPoints, oval).internal
    expect(Math.abs(length(quick) - length(slow)) / length(slow)).toBeLessThan(1e-3)
  })

  it('finds the nearest point', () => {
    expect(nearestPoint(Float64Array.from([0, 0, 10, 10]), 8, 9).index).toBe(1)
  })

  it('leaves out long Delaunay edges along the hull', () => {
    const edges = delaunayEdges(points, sheet)
    expect(edges.length).toBeGreaterThan(700)
    expect(edges.length).toBeLessThanOrEqual(3 * 300)
  })
})

describe('relaxation', () => {
  it('evens out cell sizes, keeps points inside, and repeats exactly', () => {
    const { points } = seedPoints(seed({ placement: 'random' }), oval)
    const relaxed = relax(points, oval, flat, 10)
    expect(evenness(relaxed.points, oval)).toBeLessThan(evenness(points, oval) * 0.5)
    for (let i = 0; i < relaxed.points.length; i += 2) expect(contains(oval, relaxed.points[i], relaxed.points[i + 1])).toBe(true)
    expect(relax(points, oval, flat, 10).points).toEqual(relaxed.points)
    expect(relaxed.maxMove).toBeGreaterThan(0)
  })

  it('keeps a density gradient while relaxing', () => {
    const density: DensitySettings = { mode: 'radial', strength: 8, angle: 0, invert: false }
    const inner = (p: Float64Array) => {
      let k = 0
      for (let i = 0; i < p.length; i += 2) if (Math.hypot(p[i] - 100, p[i + 1] - 100) < 50) k++
      return k / (p.length / 2)
    }
    const seeded = seedPoints(seed({ density }), sheet).points
    const relaxed = relax(seeded, sheet, density, 100).points
    // A uniform pattern puts about 20 % of points within 50 mm of the centre; this gradient about a third.
    expect(inner(seeded)).toBeGreaterThan(0.3)
    expect(Math.abs(inner(relaxed) - inner(seeded))).toBeLessThan(0.04)
  })
})

describe('holes', () => {
  const cell: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]]

  it('shrinks by half the web and rounds the corners exactly', () => {
    const sharp = makeHole(cell, 0, { web: 2, radius: 0, minHole: 0 })!
    expect(sharp.area).toBeCloseTo(64)
    expect(sharp.width).toBeCloseTo(8)
    const round = makeHole(cell, 0, { web: 2, radius: 1, minHole: 0 })!
    expect(round.area).toBeCloseTo(64 - (4 - Math.PI))
    expect(round.length).toBeCloseTo(32 - 8 + 2 * Math.PI)
    expect(outlineLength(round.outline)).toBeCloseTo(round.length)
    expect(round.outline.points).toHaveLength(8)
  })

  it('draws arcs around the rounded corner', () => {
    const round = makeHole(cell, 0, { web: 2, radius: 1, minHole: 0 })!
    const { points, bulges } = round.outline
    for (let i = 0; i < points.length; i++) {
      if (!bulges[i]) continue
      const arc = arcFromBulge(points[i], points[(i + 1) % points.length], bulges[i])
      expect(arc.r).toBeCloseTo(1)
      expect(arc.positive).toBe(true)
      // Each arc is centred on a corner of the 6 × 6 core square.
      expect([2, 8]).toContainEqual(+arc.cx.toFixed(6))
      expect([2, 8]).toContainEqual(+arc.cy.toFixed(6))
    }
  })

  it('fits the largest radius into small cells and drops cells that close up', () => {
    const tight = makeHole(cell, 0, { web: 2, radius: 20, minHole: 0 })!
    expect(tight.width).toBeCloseTo(8, 1)
    expect(makeHole(cell, 0, { web: 10.5, radius: 0, minHole: 0 })).toBeNull()
    expect(makeHole(cell, 0, { web: 2, radius: 0, minHole: 9.5 })).toBeNull()
  })
})

describe('pattern geometry', () => {
  const base: PatternSettings = { width: 200, height: 150, shape: 'rect', border: 6, cellStyle: 'holes', web: 3, cornerRadius: 1.5, minHole: 0.5, showDelaunay: false }

  it('leaves a solid frame exactly the border wide in Holes style', () => {
    const points = seedPoints(seed(), patternRegion(base)).points
    const g = buildGeometry(points, base)
    let closest = Infinity
    for (const hole of g.holes) for (const [x, y] of hole.outline.points) closest = Math.min(closest, x, y, 200 - x, 150 - y)
    expect(closest).toBeGreaterThanOrEqual(6 - 1e-6)
    expect(closest).toBeLessThan(6.2)
    expect(g.metrics.holes + g.metrics.dropped).toBe(g.metrics.cells)
    expect(g.metrics.narrowest).toBeGreaterThan(0.5)
  })

  it('measures cut length for lines and holes', () => {
    const lines = { ...base, cellStyle: 'lines' as const }
    const points = seedPoints(seed(), patternRegion(lines)).points
    const g = buildGeometry(points, lines)
    const inner = g.edges.internal.reduce((a, s) => a + Math.hypot(s[2] - s[0], s[3] - s[1]), 0)
    expect(g.metrics.cutLength).toBeCloseTo(inner + 700 + 2 * (188 + 138), 6)
    expect(g.metrics.evenness).toBeGreaterThan(0)
    expect(g.metrics.shortestEdge).toBeGreaterThan(0)
  })
})
