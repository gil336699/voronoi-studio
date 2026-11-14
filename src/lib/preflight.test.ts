import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Vec } from '../voronoi/geometry'
import { makeHole, type Hole, type Outline } from '../voronoi/holes'
import { buildGeometry, patternRegion, type Geometry } from '../voronoi/pattern'
import { regionRings } from '../voronoi/region'
import { seedPoints } from '../voronoi/seeding'
import { shapeFromOutlines } from '../voronoi/shape'
import { runJob } from '../worker/jobs'
import { MIN_CUT, tidyOutline } from './cutPaths'
import { checkWords, crosses, findWebs, flatten, preflight, provablySimple, summaryWords, type Check, type CheckId } from './preflight'
import { DEFAULTS, seedSettings, stretchOf, type Settings } from './settings'
import { readSvgOutlines } from './svgShape'

const design = (over: Partial<Settings> = {}, relax = 0) => {
  const s = { ...DEFAULTS, ...over }
  let points = seedPoints(seedSettings(s), patternRegion(s)).points
  if (relax) points = runJob({ kind: 'relax', settings: s, points, steps: relax }).points
  return { s, points, g: buildGeometry(points, { ...s, stretchSpec: stretchOf(s) }) }
}
const find = (checks: Check[], id: CheckId) => checks.find(c => c.id === id)

// The plain way to measure a web: every piece of one outline against every piece of the other, arcs flattened to 1 µm.
function gapBetween(a: Vec[], b: Vec[]): number {
  const toSegment = (p: Vec, s: Vec, e: Vec) => {
    const ex = e[0] - s[0], ey = e[1] - s[1], l = ex * ex + ey * ey
    const t = Math.max(0, Math.min(1, l ? ((p[0] - s[0]) * ex + (p[1] - s[1]) * ey) / l : 0))
    return Math.hypot(p[0] - s[0] - ex * t, p[1] - s[1] - ey * t)
  }
  let best = Infinity
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const [p, q, r, s] = [a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]]
    best = Math.min(best, toSegment(p, r, s), toSegment(q, r, s), toSegment(r, p, q), toSegment(s, p, q))
  }
  return best
}
function bruteWebs(g: Geometry, s: Settings) {
  const limit = Math.max(s.kerf, s.smallestWeb)
  const tidy = g.holes.map(h => tidyOutline(h.outline)).filter((o): o is Outline => o !== null)
  const rings = tidy.map(o => flatten(o, 0.001))
  // Flattened arcs lie inside the true ones, so gaps read up to a micrometre wide: gaps within 5 µm of a limit are
  // measured again with every arc in 256 pieces.
  const near = (d: number) => Math.abs(d - s.kerf) < 0.005 || Math.abs(d - s.smallestWeb) < 0.005
  const refine = (d: number, i: number, other: Vec[][]) => (near(d) ? Math.min(...other.map(o => gapBetween(flatten(tidy[i], 1e-7), o))) : d)
  // Outlines whose boxes are farther apart than the limit can't be nearer than it.
  const boxes = rings.map(r => [Math.min(...r.map(q => q[0])), Math.min(...r.map(q => q[1])), Math.max(...r.map(q => q[0])), Math.max(...r.map(q => q[1]))])
  const apart = (a: number[], b: number[]) => b[0] - a[2] >= limit || a[0] - b[2] >= limit || b[1] - a[3] >= limit || a[1] - b[3] >= limit
  const widths: number[] = []
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
    if (apart(boxes[i], boxes[j])) continue
    const d = refine(gapBetween(rings[i], rings[j]), i, [flatten(tidy[j], 1e-7)])
    if (d < limit) widths.push(d)
  }
  const frames: number[] = []
  if (s.sheetOutline) rings.forEach((ring, i) => {
    const d = refine(Math.min(...regionRings(g.sheet).map(f => gapBetween(ring, f))), i, regionRings(g.sheet))
    if (d < limit) frames.push(d)
  })
  const classify = (list: number[]) => ({ burn: list.filter(d => d <= s.kerf + 1e-6).length, thin: list.filter(d => d > s.kerf + 1e-6 && d < s.smallestWeb - 1e-6).length })
  return { inner: classify(widths), frame: classify(frames) }
}

describe('Ready to cut? webs', () => {
  it('measures the web between two rounded holes exactly, with where it is', () => {
    const left = makeHole([[0, 0], [10, 0], [10, 10], [0, 10]], 0, { web: 2, radius: 1, minHole: 0 })!
    const right = makeHole([[10, 0], [20, 0], [20, 10], [10, 10]], 1, { web: 2, radius: 1, minHole: 0 })!
    const [web] = findWebs([left, right], [], 2.5)
    expect(web.width).toBeCloseTo(2, 9)
    expect(web.p[0]).toBeCloseTo(9, 9)
    expect(web.q[0]).toBeCloseTo(11, 9)
    // A limit at the web's width finds nothing: a web exactly at the smallest web passes.
    expect(findWebs([left, right], [], 2)).toEqual([])
    // Corner to corner the gap is between two arcs: from (8, 8) to (12.5, 15) between the cores' corners, less both
    // radii, exactly (flattened arcs would read it up to a micrometre wide).
    const corner = makeHole([[10.5, 13], [20.5, 13], [20.5, 23], [10.5, 23]], 2, { web: 2, radius: 1, minHole: 0 })!
    const [diagonal] = findWebs([left, corner], [], 7)
    expect(diagonal.width).toBeCloseTo(Math.hypot(4.5, 7) - 2, 9)
  })

  it('counts the same webs as measuring every pair of outlines, walls follow and frames included', () => {
    for (const over of [
      { cellStyle: 'holes', web: 0.6, minHole: 0.2, count: 90 },
      { cellStyle: 'holes', web: 1.5, wallsFollow: 100, density: 'radial', densityStrength: 8, count: 90 },
      { cellStyle: 'holes', web: 0.1, minHole: 0.2, border: 0, count: 90, smallestWeb: 0.6 },
    ] as Partial<Settings>[]) {
      const { s, g } = design(over, 2)
      const r = preflight(g, new Float64Array(), s)
      const brute = bruteWebs(g, s)
      const burn = find(r.checks, 'burnWebs'), thin = find(r.checks, 'thinWebs')
      expect(burn?.count ?? 0).toBe(brute.inner.burn + brute.frame.burn)
      expect(thin?.count ?? 0).toBe(brute.inner.thin + brute.frame.thin)
      expect((burn?.frames ?? 0) + (thin?.frames ?? 0)).toBe(brute.frame.burn + brute.frame.thin)
      expect((burn?.count ?? 0) + (thin?.count ?? 0)).toBeGreaterThan(0)
    }
  })

  it('splits webs the laser burns away from webs under the smallest web', () => {
    const { s, g } = design({ cellStyle: 'holes', web: 0.1, minHole: 0.2, count: 60 }, 2)
    const r = preflight(g, new Float64Array(), s)
    const burn = find(r.checks, 'burnWebs')!
    expect(burn.worst).toBeCloseTo(0.1, 6)
    expect(burn.marks.segments).toHaveLength(burn.count)
    expect(burn.marks.spots).toHaveLength(burn.count)
    // Raising the kerf above the web leaves nothing between the two: everything thin now burns.
    expect(find(preflight(g, new Float64Array(), { ...s, kerf: 0.05 }).checks, 'burnWebs')).toBeUndefined()
  })

  it('checks the frame along the outline only when the outline is cut', () => {
    const { s, g } = design({ cellStyle: 'holes', web: 2, border: 0, smallestWeb: 1.5, count: 60 }, 2)
    const on = find(preflight(g, new Float64Array(), s).checks, 'thinWebs')!
    expect(on.frames).toBeGreaterThan(0)
    expect(on.frames).toBe(on.count) // the webs between holes are 2 mm; only the frame, 1 mm, is thin
    expect(find(preflight(g, new Float64Array(), { ...s, sheetOutline: false }).checks, 'thinWebs')).toBeUndefined()
  })

  it('measures an imported outline with a hole, and its clipped cells', () => {
    const pill = shapeFromOutlines(readSvgOutlines(readFileSync(new URL('../../test-fixtures/pill-with-hole.svg', import.meta.url), 'utf8')).rings, 'pill')
    const { s, g } = design({ shape: 'custom', customShape: pill, width: 160, height: 80, border: 1, cellStyle: 'holes', web: 1, cornerRadius: 0.8, smallestWeb: 1.2, count: 70 }, 2)
    const thin = find(preflight(g, new Float64Array(), s).checks, 'thinWebs')!
    const brute = bruteWebs(g, s)
    expect(thin.count).toBe(brute.inner.thin + brute.frame.thin)
    expect(thin.frames).toBe(brute.frame.thin)
    expect(thin.frames).toBeGreaterThan(0)
  })
})

describe('Ready to cut? holes and cells', () => {
  it('lists cells left solid, as the measurements count them', () => {
    const { s, g } = design({ cellStyle: 'holes', web: 4, minHole: 6, count: 120 })
    const solid = find(preflight(g, new Float64Array(), s).checks, 'solid')!
    expect(g.metrics.dropped).toBeGreaterThan(0)
    expect(solid.count).toBe(g.metrics.dropped)
    expect(solid.marks.cells).toHaveLength(g.metrics.dropped)
  })

  it('flags holes narrower than the smallest feature', () => {
    const { s, g } = design({ cellStyle: 'holes', web: 1, minHole: 0.1, count: 400, placement: 'random', smallestFeature: 4 })
    const small = find(preflight(g, new Float64Array(), s).checks, 'smallHoles')!
    const expected = g.holes.filter(h => h.width < 4)
    expect(small.count).toBe(expected.length)
    expect(small.worst).toBeCloseTo(Math.min(...expected.map(h => h.width)), 9)
    expect(small.marks.outlines).toHaveLength(expected.length)
  })

  it('finds hole outlines that cross themselves, and holes too small for the cut files', () => {
    const square = makeHole([[0, 0], [10, 0], [10, 10], [0, 10]], 0, { web: 2, radius: 1, minHole: 0 })!
    expect(provablySimple(square.outline)).toBe(true)
    const bow: Vec[] = [[0, 0], [4, 4], [4, 0], [0, 4]]
    expect(provablySimple({ points: bow, bulges: [0, 0, 0, 0] })).toBe(false)
    expect(crosses(bow)).toBe(true)
    expect(crosses([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]])).toBe(false) // concave, not crossing
    const { s, g } = design({ cellStyle: 'holes', count: 20 })
    const hole = (outline: Outline, width: number): Hole => ({ cell: 0, outline, width, area: 0, length: 0 })
    const tiny = hole({ points: [[50, 50], [50.004, 50], [50.002, 50.003]], bulges: [0, 0, 0] }, 0.003)
    const twisted = hole({ points: [[60, 60], [64, 64], [64, 60], [60, 64]], bulges: [0, 0, 0, 0] }, 4)
    const r = preflight({ ...g, holes: [...g.holes, tiny, twisted] }, new Float64Array(), s)
    expect(find(r.checks, 'collapsed')?.count).toBe(1)
    expect(find(r.checks, 'crossing')?.count).toBe(1)
    expect(find(preflight(g, new Float64Array(), s).checks, 'crossing')).toBeUndefined()
  })
})

describe('Ready to cut? in Lines style', () => {
  it('counts cuts shorter than the smallest feature, leaving out those too short to be in the files', () => {
    const { s, points, g } = design({ count: 400, placement: 'random' })
    const short = find(preflight(g, points, s).checks, 'shortCuts')!
    const lengths = g.edges.internal.map(e => Math.hypot(e[2] - e[0], e[3] - e[1]))
    expect(short.count).toBe(lengths.filter(l => l >= MIN_CUT && l < s.smallestFeature).length)
    expect(short.count).toBeGreaterThan(0)
    const withDot = { ...g, edges: { internal: [...g.edges.internal, [10, 10, 10.002, 10] as [number, number, number, number]] } }
    expect(find(preflight(withDot, points, s).checks, 'shortCuts')!.count).toBe(short.count)
  })

  it('flags narrow cells, a thin border and thin veins, as cut pieces', () => {
    const many = design({ count: 3000, placement: 'random', smallestWeb: 1, border: 0.5 })
    const r = preflight(many.g, many.points, many.s)
    const cells = find(r.checks, 'thinCells')!
    expect(cells.count).toBeGreaterThan(0)
    expect(cells.worst).toBeLessThan(1)
    expect(find(r.checks, 'border')?.worst).toBe(0.5)
    expect(find(preflight(many.g, many.points, { ...many.s, sheetOutline: false }).checks, 'border')).toBeUndefined()
    const leaf = design({ veins: 'leaf', veinLoops: true, veinWidth: 1, count: 150 })
    const veins = find(preflight(leaf.g, leaf.points, leaf.s).checks, 'thinVeins')!
    // With loops, the veins between the main ones are 0.3 mm wide (1 mm, tapered 60 %, at 0.75).
    expect(veins.worst).toBeCloseTo(0.3, 6)
    expect(veins.count).toBe(leaf.g.region.widths!.filter(w => Math.min(...w.filter(v => v > 1e-6)) < 1).length)
    expect(find(preflight(leaf.g, leaf.points, { ...leaf.s, smallestWeb: 0.25 }).checks, 'thinVeins')).toBeUndefined()
  })
})

describe('Ready to cut? marks and words', () => {
  it('notes sites and Delaunay lines in the cut files, and nothing when there is nothing to cut', () => {
    const { s, points, g } = design({ showSites: true, showDelaunay: true, count: 50 })
    const marks = find(preflight(g, points, s).checks, 'marks')!
    expect(marks.note).toBe(true)
    expect(marks.sites).toBe(50)
    expect(marks.delaunay).toBeGreaterThan(0)
    const none = preflight(g, points, { ...s, showSites: false, showDelaunay: false, showEdges: false, sheetOutline: false })
    expect(none.style).toBe('nothing')
    expect(none.checks).toEqual([])
  })

  it('says what is wrong in the sheet’s unit, with a fix', () => {
    const { s, g } = design({ cellStyle: 'holes', web: 0.5, minHole: 0.2, count: 60, units: 'in', showSites: false })
    const r = preflight(g, new Float64Array(), s)
    const thin = checkWords(find(r.checks, 'thinWebs')!, r, s)
    expect(thin.detail).toBe('Thinnest 0.02 in, under 0.039 in')
    expect(thin.tip).toMatch(/raise Web width on the Style tab/)
    expect(summaryWords(r, s)).toBe('1 thing to check before cutting.')
    const fine = design({ cellStyle: 'holes', count: 60, showSites: false })
    const clear = preflight(fine.g, new Float64Array(), fine.s)
    expect(clear.checks).toEqual([])
    expect(summaryWords(clear, fine.s)).toBe('Ready to cut: every cell has a hole, no web is under 1 mm, and no hole under 0.5 mm.')
    const one = checkWords({ id: 'smallHoles', count: 1, worst: 0.3, threshold: 0.5, marks: { spots: [] } }, clear, fine.s)
    expect(one.label).toBe('1 hole under the smallest feature')
    expect(one.tip).toMatch(/^This hole is narrower than your smallest feature \(0\.5 mm\)/)
  })
})
