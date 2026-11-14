import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseProject, serializeProject, VERSION } from '../lib/project'
import { DEFAULTS, fieldShare, sanitizeSettings, stretchOf, type Settings } from '../lib/settings'
import { readSvgOutlines } from '../lib/svgShape'
import { runJob } from '../worker/jobs'
import { buildCells, nearestPoint, type Cell } from './diagram'
import { metricAt, metricGrid } from './field'
import { signedArea, type Polygon } from './geometry'
import { buildGeometry, patternRegion } from './pattern'
import { encodeGray } from './picture'
import { regionArea, regionPolygon } from './region'
import { shapeFromOutlines } from './shape'

const base: Settings = { ...DEFAULTS, width: 200, height: 200, count: 600, stretch: 3, relaxSteps: 0, seed: 5 }
const make = (s: Settings, steps: number) => {
  let points = runJob({ kind: 'generate', settings: s }).points
  for (let done = 0; done < steps; done += 100) points = runJob({ kind: 'relax', settings: s, points, steps: Math.min(100, steps - done) }).points
  return { points, geometry: buildGeometry(points, { ...s, stretchSpec: stretchOf(s) }) }
}
// A soft dark blob on a light ramp, for Along the picture.
const blob = (() => {
  const W = 120, H = 120, bytes = new Uint8Array(W * H)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const r = Math.hypot(i - 50, j - 60) / 40; bytes[j * W + i] = Math.min(255, 230 * Math.min(1, r * r) + 25 * (i / W)) }
  return { name: 'blob.png', width: W, height: H, gray: encodeGray(bytes), sourceWidth: W, sourceHeight: H }
})()
const FIELDS: [string, Partial<Settings>][] = [
  ['rings', { stretchField: 'centre', stretchTurn: 90 }], ['spiral', { stretchField: 'centre', stretchTurn: 40, stretchCentreX: 30 }],
  ['saddle', { stretchField: 'saddle', stretchAngle: 20 }], ['waves', { stretchField: 'wave' }], ['swirls', { stretchField: 'cells', stretchCells: 3 }],
  ['noise', { stretchField: 'noise' }], ['curl', { stretchField: 'curl' }], ['veins', { stretchField: 'veins', veins: 'wing', veinCount: 8 }],
  ['picture', { stretchField: 'picture', densityPicture: blob }],
]

// Two edges of a ring that cross (not just touch at a shared corner).
function crosses(ring: Polygon): boolean {
  const side = (a: number[], b: number[], c: number[]) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  const n = ring.length
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue
    const a = ring[i], b = ring[(i + 1) % n], c = ring[j], d = ring[(j + 1) % n]
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true
  }
  return false
}
function inside(cell: Cell, x: number, y: number): boolean {
  let hit = false
  for (const ring of cell) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
// A cell's long-to-short ratio, long axis (radians, screen coordinates) and centre, from its second moments.
function shapeOf(ring: Polygon) {
  let A = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length; i++) { const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length], c = x0 * y1 - x1 * y0; A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c }
  A /= 2; cx /= 6 * A; cy /= 6 * A
  let xx = 0, yy = 0, xy = 0
  for (let i = 0; i < ring.length; i++) {
    const x0 = ring[i][0] - cx, y0 = ring[i][1] - cy, x1 = ring[(i + 1) % ring.length][0] - cx, y1 = ring[(i + 1) % ring.length][1] - cy, c = x0 * y1 - x1 * y0
    xx += (x0 * x0 + x0 * x1 + x1 * x1) * c; yy += (y0 * y0 + y0 * y1 + y1 * y1) * c; xy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c
  }
  const h = (xx - yy) / 24, q = xy / 24, mid = (xx + yy) / 24, root = Math.hypot(h, q)
  return { area: Math.abs(A), cx, cy, aspect: Math.sqrt((mid + root) / (mid - root)), angle: Math.atan2(q, h) / 2 }
}
// The field's long direction and stretch at a place, from the metric the pattern uses.
function fieldAt(s: Settings, count: number, x: number, y: number) {
  const region = patternRegion(s)
  const [a, b, c] = metricAt(metricGrid(stretchOf(s)!.field!, region, Math.sqrt(regionArea(region) / count)), x, y)
  const mid = (a + c) / 2, root = Math.hypot((a - c) / 2, b)
  return { long: Math.atan2(2 * b, a - c) / 2 + Math.PI / 2, stretch: Math.sqrt((mid + root) / (mid - root)) }
}
const turnBetween = (p: number, q: number) => { let d = Math.abs(p - q) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d; return (d * 180) / Math.PI }

describe('stretch that follows a field', () => {
  it('tiles the sheet exactly with cells that never cross themselves and hold their own points, for every field', () => {
    for (const [name, patch] of FIELDS) {
      const s = { ...base, ...patch }
      expect(stretchOf(s)?.field, name).toBeTruthy()
      const { points, geometry: g } = make(s, 10)
      const area = g.cells.reduce((t, c) => t + (c ? c.reduce((u, ring) => u + signedArea(ring), 0) : 0), 0)
      expect(Math.abs(area - regionArea(g.region)) / regionArea(g.region), name).toBeLessThan(1e-6)
      expect(g.cells.filter(c => c?.some(crosses)).length, name).toBe(0)
      let own = 0
      for (let i = 0; i < points.length / 2; i++) if (g.cells[i] && inside(g.cells[i]!, points[2 * i], points[2 * i + 1])) own++
      expect(own, name).toBe(points.length / 2)
    }
  })

  it('works on an ellipse and in an imported shape with a hole, in both cell styles', () => {
    const svg = readFileSync(new URL('../../test-fixtures/pill-with-hole.svg', import.meta.url), 'utf8')
    const pill = shapeFromOutlines(readSvgOutlines(svg).rings, 'pill')
    for (const sheet of [{ shape: 'ellipse', width: 200, height: 120 }, { shape: 'custom', customShape: pill, width: 160, height: 80, border: 4 }] as Partial<Settings>[])
      for (const cellStyle of ['holes', 'lines'] as const) {
        const s = { ...base, ...sheet, cellStyle, stretchField: 'curl' as const }
        const { geometry: g } = make(s, 5)
        // An ellipse's cells are cut by the same many-sided outline as without a field.
        const area = g.cells.reduce((t, c) => t + (c ? c.reduce((u, ring) => u + signedArea(ring), 0) : 0), 0)
        const exact = g.region.shape === 'ellipse' ? signedArea(regionPolygon(g.region)) : regionArea(g.region)
        expect(Math.abs(area - exact) / exact).toBeLessThan(1e-6)
        expect(g.cells.filter(c => c?.some(crosses)).length).toBe(0)
        // Thin holes drop out below the smallest hole as with One direction's long cells, but no more than there.
        if (cellStyle === 'holes') expect(g.holes.length).toBeGreaterThan(make({ ...s, stretchField: 'fixed' }, 5).geometry.holes.length * 0.95)
        else expect(g.edges.internal.length).toBeGreaterThan(s.count)
      }
  })

  it('lines relaxed cells up with the field, about as long as the stretch', () => {
    const s = { ...base, count: 1200, stretchField: 'centre' as const, stretchTurn: 90 }
    const { geometry: g } = make(s, 60)
    let turn = 0, n = 0
    const aspects: number[] = []
    for (const c of g.cells) {
      if (!c || c.length !== 1 || c[0].some(([x, y]) => x < 25 || x > 175 || y < 25 || y > 175)) continue
      const cell = shapeOf(c[0]), f = fieldAt(s, 1200, cell.cx, cell.cy)
      if (f.stretch < 2) continue
      turn += turnBetween(cell.angle, f.long); n++; aspects.push(cell.aspect)
    }
    aspects.sort((a, b) => a - b)
    expect(n).toBeGreaterThan(500)
    expect(turn / n).toBeLessThan(4)
    expect(aspects[Math.floor(n / 2)]).toBeGreaterThan(2.2)
  })

  it('keeps cells even round a vortex over long relaxing: no crowding toward the eye, none pushed onto the edge', () => {
    const s = { ...base, count: 1200, stretchField: 'centre' as const, stretchTurn: 90 }
    const { points, geometry: g } = make(s, 300)
    const areas = g.cells.filter(c => c && c.length === 1 && c[0].every(([x, y]) => x > 20 && x < 180 && y > 20 && y < 180)).map(c => shapeOf(c![0]).area).sort((a, b) => a - b)
    const mean = areas.reduce((a, b) => a + b, 0) / areas.length
    expect(mean / areas[0]).toBeLessThan(1.6)
    // Points within 30 mm of the eye against points 55–85 mm out, per area: exact Lloyd keeps this near 1.
    let inner = 0, outer = 0
    for (let i = 0; i < points.length / 2; i++) { const r = Math.hypot(points[2 * i] - 100, points[2 * i + 1] - 100); if (r < 30) inner++; else if (r >= 55 && r < 85) outer++ }
    expect((inner / 900) / (outer / (85 * 85 - 55 * 55))).toBeLessThan(1.25)
    const region = patternRegion(s)
    let onEdge = 0
    for (let i = 0; i < points.length / 2; i++) if (Math.min(points[2 * i] - region.x0, region.x1 - points[2 * i], points[2 * i + 1] - region.y0, region.y1 - points[2 * i + 1]) < 1e-6) onEdge++
    expect(onEdge).toBe(0)
  })

  it('keeps cells round at a vortex’s eye and a swirl’s centre, where the field turns right round', () => {
    for (const patch of [{ stretchField: 'centre', stretchTurn: 90 }, { stretchField: 'cells', stretchCells: 1 }] as Partial<Settings>[]) {
      const { geometry: g } = make({ ...base, count: 1200, ...patch }, 100)
      const near = g.cells.filter(c => c && c.length === 1).map(c => shapeOf(c![0])).filter(c => Math.hypot(c.cx - 100, c.cy - 100) < 12)
      expect(near.length).toBeGreaterThan(8)
      expect(Math.max(...near.map(c => c.aspect))).toBeLessThan(1.3)
    }
  })

  it('draws walls bent where the field turns sharply, so drawn cells match the ones relaxing uses', () => {
    const s = { ...base, stretchField: 'veins' as const, veins: 'wing' as const, veinCount: 10 }
    const { points, geometry: g } = make(s, 20)
    const relaxing = buildCells(points, patternRegion(s), stretchOf(s))
    const area = (c: Cell | null) => (c ? c.reduce((t, ring) => t + signedArea(ring), 0) : 0)
    const worst = Math.max(...g.cells.map((c, i) => Math.abs(area(c) - area(relaxing[i])) / area(relaxing[i])))
    expect(worst).toBeLessThan(0.25)
  })

  it('lets Auto-relax settle with a field once nearly every point is still', () => {
    const s = { ...base, count: 1200, stretchField: 'wave' as const }
    let points = runJob({ kind: 'generate', settings: s }).points, settled = -1
    const tolerance = Math.sqrt(regionArea(patternRegion(s)) / 1200) / 2000
    for (let step = 1; step <= 500 && settled < 0; step++) {
      const r = runJob({ kind: 'relax', settings: s, points, steps: 1 })
      points = r.points
      if ((r.settleMove ?? r.maxMove) < tolerance) settled = step
    }
    expect(settled).toBeGreaterThan(20)
    expect(settled).toBeLessThan(500)
  })

  it('spaces seeded points in the field’s ellipses, so near neighbours sit across the field', () => {
    const s = { ...base, count: 900, stretchField: 'centre' as const, stretchTurn: 90 }
    const { points } = runJob({ kind: 'generate', settings: s })
    expect(points.length / 2).toBeGreaterThan(900 * 0.85)
    expect(points.length / 2).toBeLessThan(900 * 1.15)
    let across = 0, n = 0
    for (let i = 0; i < points.length / 2; i++) {
      const x = points[2 * i], y = points[2 * i + 1], f = fieldAt(s, 900, x, y)
      if (f.stretch < 2.5) continue
      let best = Infinity, dx = 0, dy = 0
      for (let j = 0; j < points.length / 2; j++) {
        if (j === i) continue
        const ex = points[2 * j] - x, ey = points[2 * j + 1] - y, d = ex * ex + ey * ey
        if (d < best) { best = d; dx = ex; dy = ey }
      }
      n++; if (turnBetween(Math.atan2(dy, dx), f.long) > 45) across++
    }
    expect(across / n).toBeGreaterThan(0.75)
  })

  it('keeps the exact stretch for One direction, and when what the field follows is missing', () => {
    const fixed = { ...base, stretchAngle: 30, relaxSteps: 3 }
    const plain = Array.from(runJob({ kind: 'generate', settings: fixed }).points)
    for (const patch of [{ stretchField: 'fixed' }, { stretchField: 'veins', veins: 'none' }, { stretchField: 'picture', densityPicture: null }] as Partial<Settings>[]) {
      const s = { ...fixed, ...patch }
      expect(stretchOf(s)).toEqual({ amount: 3, angle: 30 })
      expect(Array.from(runJob({ kind: 'generate', settings: s }).points)).toEqual(plain)
    }
    expect(stretchOf({ ...base, stretch: 1, stretchField: 'noise' })).toBeNull()
  })

  it('finds the cell under the pointer with the field’s ellipse there', () => {
    const s = { ...base, stretchField: 'curl' as const, stretchScale: 2 }
    const { points, geometry: g } = make(s, 20)
    let right = 0, tries = 0
    for (let k = 0; k < 400; k++) {
      const x = 10 + ((k * 37) % 180) + 0.5, y = 10 + ((k * 53) % 180) + 0.25
      const hit = g.cells.findIndex(c => c && inside(c, x, y))
      if (hit < 0) continue
      tries++
      if (nearestPoint(points, x, y, stretchOf(s), g.region).index === hit) right++
    }
    expect(right / tries).toBeGreaterThan(0.95)
  })

  it('makes the same pattern every time, and relaxing in two halves matches relaxing at once', () => {
    const s = { ...base, stretchField: 'noise' as const }
    // Another stretch in between, so nothing kept from the first run (the page's and the worker's runs share nothing).
    const a = runJob({ kind: 'generate', settings: s }).points
    runJob({ kind: 'generate', settings: { ...s, stretchField: 'curl', stretchScale: 5 } })
    const b = runJob({ kind: 'generate', settings: s }).points
    expect(Array.from(a)).toEqual(Array.from(b))
    const once = runJob({ kind: 'relax', settings: s, points: a, steps: 20 }).points
    const half = runJob({ kind: 'relax', settings: s, points: runJob({ kind: 'relax', settings: s, points: b, steps: 10 }).points, steps: 10 }).points
    expect(Array.from(half)).toEqual(Array.from(once))
  })

  it('says how much of the sheet can follow the field', () => {
    expect(fieldShare({ ...base, stretchField: 'fixed' }, 300)).toBeNull()
    expect(fieldShare({ ...base, stretchField: 'centre' }, 1200)).toBeGreaterThan(0.9)
    const busy = fieldShare({ ...base, stretchField: 'noise', stretchScale: 12 }, 300)!
    expect(busy).toBeLessThan(0.2)
    expect(fieldShare({ ...base, stretchField: 'noise', stretchScale: 12 }, 8000)!).toBeGreaterThan(busy + 0.3)
  })

  it('saves the field in projects (version 6 on), and older files open with One direction', () => {
    const settings = { ...DEFAULTS, stretch: 2.5, stretchField: 'wave' as const, stretchWaves: 5, stretchSwing: 60, stretchSeed: 77 }
    const text = serializeProject({ settings, points: new Float64Array(), handEdited: false })
    expect(VERSION).toBeGreaterThanOrEqual(6)
    expect(parseProject(text).settings).toEqual(settings)
    expect(sanitizeSettings({ stretch: 2 }).stretchField).toBe('fixed')
    expect(sanitizeSettings({ stretchField: 'vortex', stretchWaves: 99, stretchTurn: -4 })).toMatchObject({ stretchField: 'fixed', stretchWaves: 12, stretchTurn: 0 })
  })
})
