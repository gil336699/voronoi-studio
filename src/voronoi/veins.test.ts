import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseProject, serializeProject, VERSION } from '../lib/project'
import { DEFAULTS, sanitizeSettings } from '../lib/settings'
import { readSvgOutlines } from '../lib/svgShape'
import { cellArea, regionParts, partOf } from './diagram'
import { signedArea, type Polygon, type Vec } from './geometry'
import { buildGeometry, patternRegion, veinLinesAt, type PatternSettings } from './pattern'
import { contains, regionArea, regionRings, type Region } from './region'
import { relax } from './relax'
import { seedPoints } from './seeding'
import { veinsFromLines } from './veinLines'
import { makeVeins, veinBase, type VeinSettings } from './veins'
import { shapeFromOutlines } from './shape'

const flat = { mode: 'none' as const, strength: 1, angle: 0, invert: false }
const base: PatternSettings = { width: 200, height: 120, shape: 'rect', customShape: null, border: 3, cellStyle: 'lines', web: 1, cornerRadius: 0.5, minHole: 0.3, showDelaunay: false,
  veins: 'wing', veinCount: 10, veinStart: 'left', veinWidth: 1.2, veinTaper: 60 }
const vs = (s: PatternSettings): VeinSettings => ({ style: s.veins!, count: s.veinCount!, start: s.veinStart!, width: s.veinWidth!, taper: s.veinTaper! / 100, lines: null, loops: s.veinLoops })
const seeded = (region: Region, count = 600) => seedPoints({ count, placement: 'even', autoSpacing: true, spacing: 5, tries: 30, jitter: 0, seed: 2, density: flat }, region).points

// Whether segments ab and cd cross at a point inside both (not at a shared end).
function crosses([a, b]: [Vec, Vec], [c, d]: [Vec, Vec]): boolean {
  const o = (p: Vec, q: Vec, r: Vec) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d)
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9
}

describe('veins', () => {
  it('splits the pattern into regions, each filled on its own, so no cell reaches across a vein', () => {
    const region = patternRegion(base)
    expect(region.parts!.length).toBeGreaterThan(5)
    const points = seeded(region)
    const g = buildGeometry(points, base)
    expect(g.metrics.cells).toBe(600)
    const parts = regionParts(region)!, owner = partOf(points, parts)
    // Every cell is a single piece inside its own region: its area is its region's share, and regions are exactly filled.
    const byPart = new Map<number, number>()
    g.cells.forEach((c, i) => { expect(c!.length).toBe(1); byPart.set(owner[i], (byPart.get(owner[i]) ?? 0) + cellArea(c!)) })
    for (const [p, area] of byPart) expect(area / regionArea(parts[p])).toBeCloseTo(1, 3)
    // The cells and the veins together fill the pattern.
    const veinArea = g.veins.reduce((s, r) => s + signedArea(r), 0)
    const cellsArea = g.cells.reduce((s, c) => s + cellArea(c!), 0)
    expect((cellsArea + veinArea) / ((base.width - 6) * (base.height - 6))).toBeCloseTo(1, 2)
  })

  it('makes wing veins that never cross, reach the edge, and narrow toward their ends', () => {
    const region = patternRegion({ ...base, veins: 'none' })
    const veins = makeVeins(region, vs(base))
    expect(veins.length).toBeGreaterThanOrEqual(8)
    const segs = veins.map(v => v.points.slice(0, -1).map((p, i) => [p, v.points[i + 1]] as [Vec, Vec]))
    let crossings = 0
    for (let a = 0; a < segs.length; a++) for (let b = a + 1; b < segs.length; b++) for (const s of segs[a]) for (const t of segs[b]) if (crosses(s, t)) crossings++
    expect(crossings).toBe(0)
    const atEdge = veins.filter(v => { const [x, y] = v.points[v.points.length - 1]; return Math.min(x - region.x0, region.x1 - x, y - region.y0, region.y1 - y) < 1.5 }).length
    expect(atEdge).toBeGreaterThanOrEqual(8)
    for (const v of veins) expect(v.widths[v.widths.length - 1]).toBeLessThanOrEqual(v.widths[0] + 1e-9)
    expect(Math.min(...veins.map(v => v.widths[v.widths.length - 1]))).toBeLessThan(1.2 * 0.6)
  })

  it('grows leaf veins that close off regions, the same each time', () => {
    const s = { ...base, veins: 'leaf' as const, veinCount: 14, veinStart: 'bottom' as const }
    const a = patternRegion(s)
    expect(a.parts!.length).toBeGreaterThan(5)
    const again = makeVeins(patternRegion({ ...s, veins: 'none' }), vs(s))
    expect(makeVeins(patternRegion({ ...s, veins: 'none' }), vs(s))).toEqual(again)
  })

  it('spreads veins from the centre in every direction', () => {
    const s = { ...base, width: 160, height: 160, shape: 'ellipse' as const, veinStart: 'centre' as const, veinCount: 16 }
    const region = patternRegion(s)
    expect(region.parts!.length).toBeGreaterThanOrEqual(12)
  })

  it('keeps every point in its own region through relaxing', () => {
    const region = patternRegion(base)
    const points = seeded(region)
    const parts = regionParts(region)!
    const count = (p: Float64Array) => { const o = partOf(p, parts); const c = new Array(parts.length).fill(0); o.forEach(i => c[i]++); return c }
    const before = count(points)
    const { points: after } = relax(points, region, flat, 15)
    expect(count(after)).toEqual(before)
  })

  it('leaves a solid web round each vein in Holes style: vein width plus the web', () => {
    const s = { ...base, cellStyle: 'holes' as const, web: 1.5 }
    const g = buildGeometry(seeded(patternRegion(s), 500), s)
    expect(g.metrics.holes).toBeGreaterThan(400)
    const veins = makeVeins(patternRegion({ ...s, veins: 'none' }), vs(s))
    const near = (x: number, y: number) => Math.min(...veins.flatMap(v => v.points.slice(0, -1).map((p, i) => {
      const q = v.points[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1)))
      return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy) - (v.widths[i] + (v.widths[i + 1] - v.widths[i]) * t) / 2
    })))
    // Every hole stays at least half a web (less rounding) clear of every vein.
    const closest = Math.min(...g.holes.flatMap(h => h.outline.points.map(([x, y]) => near(x, y))))
    expect(closest).toBeGreaterThan(0.75 * 0.95)
  })

  it('reads veins from an SVG’s open lines, placed by its outline', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
      <path d="M0 0H100V50H0Z" fill="#ccc"/><path d="M0 25 C 30 20, 60 20, 100 10" fill="none" stroke="#000"/><line x1="50" y1="15" x2="50" y2="50" stroke="#000"/></svg>`
    const found = readSvgOutlines(svg)
    expect(found.lines.length).toBe(2)
    const veins = veinsFromLines(found.lines, 'w.svg', [0, 0, 100, 50])!
    const lines = veinLinesAt(veins, 200, 100)
    expect(lines[1][0][0]).toBeCloseTo(100, 6) // the line at x 50 of 100 sits at the middle of a 200 mm sheet
    const s = { ...base, width: 200, height: 100, veins: 'imported' as const, veinLines: veins, border: 0 }
    expect(patternRegion(s).parts!.length).toBe(3)
    expect(() => readSvgOutlines('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="4"/></svg>', 0.02, true)).toThrow(/no open lines/)
  })

  it('thins the walls between smaller cells when walls follow cell size', () => {
    const s = { ...base, veins: 'none' as const, cellStyle: 'holes' as const, web: 2 }
    const density = { mode: 'linear' as const, strength: 8, angle: 0, invert: false }
    const points = seedPoints({ count: 500, placement: 'even', autoSpacing: true, spacing: 5, tries: 30, jitter: 0, seed: 2, density }, patternRegion(s)).points
    const solid = (follow: number) => { const g = buildGeometry(points, { ...s, wallsFollow: follow }); return g.holes.reduce((a, h) => a + signedArea(h.outline.points), 0) }
    expect(solid(100)).toBeGreaterThan(solid(0) * 1.05) // more open area: thinner webs between the small cells
    const g = buildGeometry(points, { ...s, cellStyle: 'lines', wallsFollow: 100 })
    expect(Math.min(...g.edges.widths!)).toBeLessThan(0.6)
    expect(Math.max(...g.edges.widths!)).toBeCloseTo(1, 1)
  })

  it('saves veins in projects (version 5 on) and drops damaged ones', () => {
    const veinLines = { name: 'w.svg', lines: [[0, 0.5, 1, 0.5]] }
    const settings = { ...DEFAULTS, veins: 'imported' as const, veinLines, veinCount: 12 }
    const text = serializeProject({ settings, points: new Float64Array(), handEdited: false })
    expect(JSON.parse(text).version).toBe(VERSION)
    expect(VERSION).toBeGreaterThanOrEqual(5)
    expect(parseProject(text).settings).toEqual(settings)
    expect(sanitizeSettings({ veins: 'imported', veinLines: { lines: [[0, 0, 'x', 1]] } })).toMatchObject({ veins: 'none', veinLines: null })
    expect(sanitizeSettings({ veinCount: 500, veinTaper: -5, veinStart: 'middle' })).toMatchObject({ veinCount: 60, veinTaper: 0, veinStart: 'left' })
  })

  it('works with a stretch and with an imported shape', () => {
    const svg = readFileSync(new URL('../../test-fixtures/pill-with-hole.svg', import.meta.url), 'utf8')
    void svg
    const s = { ...base, stretch: 2, stretchAngle: 0 }
    const region = patternRegion(s)
    const g = buildGeometry(seeded(region), s)
    expect(g.metrics.cells).toBe(600)
    expect(g.cells.every(c => c && c.length === 1)).toBe(true)
  })
})

describe('leaf veins with loops', () => {
  const loopy: PatternSettings = { ...base, veins: 'leaf', veinLoops: true, veinCount: 16 }
  const near = (p: Vec, rings: Polygon[], tol: number) => rings.some(ring => ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2))
    return Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey) < tol
  }))
  // How far a point is from a polyline.
  const offLine = (p: Vec, line: Vec[]) => {
    let best = Infinity
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2))
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey))
    }
    return best
  }
  // Vein ends that are neither on another vein (a join), at the edge (on it, or just past it), nor the start.
  const looseEnds = (s: PatternSettings) => {
    const sheet = patternRegion({ ...s, veins: 'none' }), veins = makeVeins(sheet, vs(s)), start = veinBase(sheet, s.veinStart!)
    let loose = 0
    veins.forEach((v, i) => { for (const e of [v.points[0], v.points[v.points.length - 1]]) {
      if (Math.hypot(e[0] - start[0], e[1] - start[1]) < 1e-6 || !contains(sheet, e[0], e[1]) || near(e, regionRings(sheet), 0.05)) continue
      if (!veins.some((o, j) => j !== i && offLine(e, o.points) < 1e-6)) loose++
    } })
    return loose
  }
  // Regions that don't reach the pattern's edge: what only loops make many of.
  const inner = (s: PatternSettings) => {
    const sheet = patternRegion({ ...s, veins: 'none' })
    return patternRegion(s).parts!.filter(part => !part[0].some(q => near(q, regionRings(sheet), 0.5))).length
  }

  it('joins veins into loops, closing off regions inside the leaf, about as many regions as asked', () => {
    for (const count of [8, 16, 30]) {
      const parts = patternRegion({ ...loopy, veinCount: count }).parts!.length
      expect(parts).toBeGreaterThan(count * 0.6)
      expect(parts).toBeLessThan(count * 1.6)
    }
    expect(inner({ ...loopy, veinCount: 30 })).toBeGreaterThan(15)
    expect(inner({ ...loopy, veinCount: 30, veinLoops: false })).toBeLessThan(15) // open veins branch like a tree
  })

  it('leaves no vein ending inside the leaf: every end is a join, on the edge, or the start', () => {
    for (const patch of [{}, { veinCount: 40 }, { veinStart: 'centre' }, { shape: 'ellipse' }] as Partial<PatternSettings>[]) expect(looseEnds({ ...loopy, ...patch })).toBe(0)
    // Branching veins run on to the edge too, bar the odd one that stops where its neighbours took the room.
    for (const count of [8, 16, 30]) expect(looseEnds({ ...loopy, veinLoops: false, veinCount: count })).toBeLessThanOrEqual(1)
  })

  it('grows veins as smooth curves, with no sharp kinks', () => {
    for (const patch of [{}, { veinLoops: false }, { veinStart: 'centre', veinCount: 12 }, { veinStart: 'centre', veinCount: 12, veinLoops: false }] as Partial<PatternSettings>[]) {
      const s = { ...loopy, shape: 'ellipse' as const, width: 200, height: 200, ...patch }
      const turns: number[] = []
      for (const v of makeVeins(patternRegion({ ...s, veins: 'none' }), vs(s))) for (let i = 1; i < v.points.length - 1; i++) {
        const [a, b, c] = [v.points[i - 1], v.points[i], v.points[i + 1]], u = [b[0] - a[0], b[1] - a[1]], w = [c[0] - b[0], c[1] - b[1]]
        turns.push(Math.abs(Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1])) * 180 / Math.PI)
      }
      turns.sort((p, q) => p - q)
      expect(turns[Math.floor(turns.length * 0.99)]).toBeLessThan(25)
      expect(turns[turns.length - 1]).toBeLessThan(30)
    }
  })

  it('tapers every branching vein along its length, from Vein width at the start', () => {
    const s = { ...loopy, veinLoops: false }, sheet = patternRegion({ ...s, veins: 'none' }), veins = makeVeins(sheet, vs(s))
    const widest = Math.max(...veins.flatMap(v => v.widths)), start = veinBase(sheet, s.veinStart!)
    expect(widest).toBeCloseTo(s.veinWidth!, 6)
    expect(veins.some(v => Math.hypot(v.points[0][0] - start[0], v.points[0][1] - start[1]) < 1e-6 && Math.abs(v.widths[0] - widest) < 1e-9)).toBe(true)
    for (const v of veins) {
      for (let i = 1; i < v.widths.length; i++) expect(v.widths[i]).toBeLessThanOrEqual(v.widths[i - 1] + 1e-9)
      expect(Math.min(...v.widths)).toBeGreaterThanOrEqual(s.veinWidth! * (1 - s.veinTaper! / 100) - 1e-9)
    }
    // And they really do thin: their tips are near the narrowest Taper allows, most of the way along.
    const tipWidths = veins.map(v => v.widths[v.widths.length - 1]).sort((p, q) => p - q)
    expect(tipWidths[Math.floor(tipWidths.length / 2)]).toBeLessThan(s.veinWidth! * (1 - s.veinTaper! / 200))
  })

  it('keeps the same veins when the count changes, adding branches to the same tree', () => {
    const sheet = patternRegion({ ...loopy, veins: 'none' })
    const few = makeVeins(sheet, vs({ ...loopy, veinLoops: false, veinCount: 8 })), many = makeVeins(sheet, vs({ ...loopy, veinLoops: false, veinCount: 20 }))
    // Every point of the 8 veins lies on the 20 (smoothing between different branch points moves them a hair).
    const worst = Math.max(...few.flatMap(v => v.points.map(p => Math.min(...many.map(m => offLine(p, m.points))))))
    expect(worst).toBeLessThan(0.5)
    expect(many.length).toBeGreaterThan(few.length)
  })

  it('joins each loop between two different main veins, so none closes a bulb beside one vein', () => {
    for (const patch of [{}, { veinStart: 'centre' }, { veinCount: 30 }] as Partial<PatternSettings>[]) {
      const s = { ...loopy, ...patch }, veins = makeVeins(patternRegion({ ...s, veins: 'none' }), vs(s))
      const fine = Math.min(...veins.flatMap(v => v.widths)) + 1e-9
      const loops = veins.filter(v => v.widths.every(w => w <= fine)), mains = veins.filter(v => !v.widths.every(w => w <= fine))
      expect(loops.length).toBeGreaterThan(3)
      for (const l of loops) {
        const on = (p: Vec) => mains.findIndex(m => offLine(p, m.points) < 1e-6)
        const a = on(l.points[0]), b = on(l.points[l.points.length - 1])
        if (a >= 0 && b >= 0) expect(a).not.toBe(b)
      }
    }
  })

  it('grows the same loops each time, thickest from the start', () => {
    const sheet = patternRegion({ ...loopy, veins: 'none' }), start = veinBase(sheet, 'left')
    const a = makeVeins(sheet, vs(loopy))
    expect(makeVeins(patternRegion({ ...loopy, veins: 'none' }), vs(loopy))).toEqual(a)
    const widest = Math.max(...a.flatMap(v => v.widths))
    const fromStart = a.filter(v => Math.hypot(v.points[0][0] - start[0], v.points[0][1] - start[1]) < 1e-6)
    expect(fromStart.length).toBeGreaterThan(0)
    expect(Math.max(...fromStart.map(v => v.widths[0]))).toBe(widest)
    // Most veins are much thinner than the one from the start.
    const widths = a.flatMap(v => v.widths).sort((p, q) => p - q)
    expect(widths[Math.floor(widths.length / 2)]).toBeLessThan(widest * 0.6)
  })

  it('works round a hole, and fills every region with its own cells', () => {
    const pill = shapeFromOutlines(readSvgOutlines(readFileSync(new URL('../../test-fixtures/pill-with-hole.svg', import.meta.url), 'utf8')).rings, 'pill')
    const s: PatternSettings = { ...loopy, shape: 'custom', customShape: pill, width: 160, height: 80, border: 4 }
    expect(looseEnds(s)).toBe(0)
    // Veins flow round the hole; the regions beside it close against its edge.
    expect(regionRings(patternRegion({ ...s, veins: 'none' })).filter(r => signedArea(r) < 0).length).toBe(1)
    const region = patternRegion(s)
    expect(region.parts!.length).toBeGreaterThan(8)
    const points = seeded(region)
    const g = buildGeometry(points, s)
    // Every cell is one piece inside its own region, and the regions are exactly filled.
    const parts = regionParts(region)!, owner = partOf(points, parts), byPart = new Map<number, number>()
    g.cells.forEach((c, i) => { expect(c!.length).toBe(1); byPart.set(owner[i], (byPart.get(owner[i]) ?? 0) + cellArea(c!)) })
    for (const [p, area] of byPart) expect(area / regionArea(parts[p])).toBeCloseTo(1, 3)
  })

  it('keeps open Leaf veins for files from before loops, and saves the choice', () => {
    expect(DEFAULTS.veinLoops).toBe(true)
    expect(sanitizeSettings({ veins: 'leaf' }).veinLoops).toBe(false)
    expect(sanitizeSettings({ veins: 'leaf', veinLoops: true }).veinLoops).toBe(true)
    const settings = { ...DEFAULTS, veins: 'leaf' as const, veinLoops: false, veinCount: 20 }
    const text = serializeProject({ settings, points: new Float64Array(), handEdited: false })
    expect(parseProject(text).settings).toEqual(settings)
  })
})

// Polygon is used in the type of a helper above.
export type { Polygon }
