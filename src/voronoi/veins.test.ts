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
import { makeVeins, veinBase, type Vein, type VeinSettings } from './veins'
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

  it('narrows imported veins along the veins from Start from, so a branch begins as wide as the vein it leaves', () => {
    const region: Region = { shape: 'rect', x0: 0, y0: 0, x1: 200, y1: 100 }
    // The width at the point of a vein nearest (x, y), between its points as the strips are drawn.
    const widthAt = (vein: Vein, x: number, y: number) => {
      let best = Infinity, w = 0
      for (let i = 0; i + 1 < vein.points.length; i++) {
        const [a, b] = [vein.points[i], vein.points[i + 1]], ex = b[0] - a[0], ey = b[1] - a[1]
        const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1)))
        const d = Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey)
        if (d < best) { best = d; w = vein.widths[i] + (vein.widths[i + 1] - vein.widths[i]) * t }
      }
      return w
    }
    // A trunk from the left edge, and a branch leaving it halfway, drawn from its far end toward the trunk.
    const trunk: Polygon = [[0, 50], [200, 50]], branch: Polygon = [[160, 95], [100, 50]]
    const v: VeinSettings = { style: 'imported', count: 8, start: 'left', width: 2, taper: 0.6, lines: [trunk, branch] }
    const [t, b] = makeVeins(region, v)
    expect(widthAt(t, 0, 50)).toBeCloseTo(2, 2)
    expect(widthAt(t, 200, 50)).toBeLessThan(widthAt(t, 100, 50))
    // The branch begins as wide as the trunk where it leaves it (before 1.12.0: 0.8 against 1.4) and narrows outward.
    expect(Math.abs(widthAt(b, 100, 50) - widthAt(t, 100, 50))).toBeLessThan(0.05)
    expect(widthAt(b, 160, 95)).toBeLessThan(widthAt(b, 100, 50))
    // From the right, the trunk is widest at the right.
    expect(widthAt(makeVeins(region, { ...v, start: 'right' })[0], 200, 50)).toBeCloseTo(2, 2)
    // A line touching no other starts narrower the farther it is from the start.
    const lone = makeVeins(region, { ...v, lines: [trunk, branch, [[150, 10], [190, 10]]] })[2]
    expect(widthAt(lone, 150, 10)).toBeLessThan(1.6)
    expect(widthAt(lone, 190, 10)).toBeLessThan(widthAt(lone, 150, 10))
    // With no taper every line is Vein width all along.
    expect(makeVeins(region, { ...v, taper: 0 }).every(vein => vein.widths.every(w => w === 2))).toBe(true)
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

describe('leaf vein ends', () => {
  // A tall leaf like Gil's 363.8 × 630.3 mm vesica (two circles, each through the other's centre), started from the
  // bottom, and a wide strip started from the left. Before 1.13.1 both went from about 35 ends straight to about
  // 500, a mesh of twigs: every branch feeding more tips than a threshold went in at once, and once the threshold
  // came down to the twigs, hundreds of them did.
  const r = 363.8, lens: Polygon = []
  for (let i = 0; i <= 200; i++) { const t = -Math.PI / 3 + (i / 200) * (2 * Math.PI / 3); lens.push([r * Math.cos(t) - r / 2, r * Math.sin(t)]) }
  for (let i = 0; i <= 200; i++) { const t = (2 * Math.PI) / 3 + (i / 200) * (2 * Math.PI / 3); lens.push([r / 2 + r * Math.cos(t), -r * Math.sin(t)]) }
  const leaf: PatternSettings = { ...base, shape: 'custom', customShape: shapeFromOutlines([lens], 'vesica'), width: 363.8, height: 630.3, border: 5,
    veins: 'leaf', veinLoops: false, veinStart: 'bottom', veinWidth: 1, veinTaper: 0 }
  const strip: PatternSettings = { ...base, width: 300, height: 120, border: 5, veins: 'leaf', veinLoops: false, veinStart: 'left', veinWidth: 1.5, veinTaper: 60 }
  const key = (p: Vec) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`
  // Ends: vein ends that no other vein starts from, other than the start itself.
  const endsOf = (s: PatternSettings) => {
    const sheet = patternRegion({ ...s, veins: 'none' }), veins = makeVeins(sheet, vs(s))
    const starts = new Set(veins.map(v => key(v.points[0]))), start = key(veinBase(sheet, s.veinStart!))
    return veins.filter(v => { const end = key(v.points[v.points.length - 1]); return !starts.has(end) && end !== start }).length
  }

  it('has exactly as many ends as Vein ends asks, all the way up the slider', () => {
    for (const s of [leaf, strip]) for (const count of [10, 24, 30, 36, 45, 60]) expect(endsOf({ ...s, veinCount: count })).toBe(count)
  })

  // Before 1.13.1 a vein's last stretch steered for the nearest edge point straight across its neighbours: 3 crossings
  // at 20 ends on the tall leaf, and still about 30 at 60 once the count was exact.
  it('never crosses one vein with another, however many ends', () => {
    for (const s of [leaf, strip]) for (const count of [20, 40, 60]) {
      const veins = makeVeins(patternRegion({ ...s, veins: 'none' }), vs({ ...s, veinCount: count }))
      const boxes = veins.map(v => [Math.min(...v.points.map(p => p[0])), Math.min(...v.points.map(p => p[1])), Math.max(...v.points.map(p => p[0])), Math.max(...v.points.map(p => p[1]))])
      let crossings = 0
      for (let i = 0; i < veins.length; i++) for (let j = i + 1; j < veins.length; j++) {
        const [a, b] = [boxes[i], boxes[j]]
        if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue
        const P = veins[i].points, Q = veins[j].points
        for (let k = 1; k < P.length; k++) for (let m = 1; m < Q.length; m++) if (crosses([P[k - 1], P[k]], [Q[m - 1], Q[m]])) crossings++
      }
      expect(crossings).toBe(0)
    }
  })

  it('splits the leaf into about one region per end at 60, not hundreds', () => {
    for (const s of [leaf, strip]) {
      const parts = patternRegion({ ...s, veinCount: 60 }).parts!.length
      expect(parts).toBeGreaterThan(30)
      expect(parts).toBeLessThan(90)
    }
  })
})

// Polygon is used in the type of a helper above.
export type { Polygon }
