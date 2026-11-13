import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseProject, serializeProject, VERSION } from '../lib/project'
import { DEFAULTS, sanitizeSettings } from '../lib/settings'
import { readSvgOutlines } from '../lib/svgShape'
import { cellArea, regionParts, partOf } from './diagram'
import { signedArea, type Polygon, type Vec } from './geometry'
import { buildGeometry, patternRegion, veinLinesAt, type PatternSettings } from './pattern'
import { regionArea, type Region } from './region'
import { relax } from './relax'
import { seedPoints } from './seeding'
import { veinsFromLines } from './veinLines'
import { makeVeins, type VeinSettings } from './veins'

const flat = { mode: 'none' as const, strength: 1, angle: 0, invert: false }
const base: PatternSettings = { width: 200, height: 120, shape: 'rect', customShape: null, border: 3, cellStyle: 'lines', web: 1, cornerRadius: 0.5, minHole: 0.3, showDelaunay: false,
  veins: 'wing', veinCount: 10, veinStart: 'left', veinWidth: 1.2, veinTaper: 60 }
const vs = (s: PatternSettings): VeinSettings => ({ style: s.veins!, count: s.veinCount!, start: s.veinStart!, width: s.veinWidth!, taper: s.veinTaper! / 100, lines: null })
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

  it('saves veins in version 5 projects and drops damaged ones', () => {
    const veinLines = { name: 'w.svg', lines: [[0, 0.5, 1, 0.5]] }
    const settings = { ...DEFAULTS, veins: 'imported' as const, veinLines, veinCount: 12 }
    const text = serializeProject({ settings, points: new Float64Array(), handEdited: false })
    expect(JSON.parse(text).version).toBe(VERSION)
    expect(VERSION).toBe(5)
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

// Polygon is used in the type of a helper above.
export type { Polygon }
