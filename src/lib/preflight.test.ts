import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { convexHull, minWidth, signedArea, type Polygon, type Vec } from '../voronoi/geometry'
import { makeHole, type Hole, type Outline } from '../voronoi/holes'
import { buildGeometry, patternRegion, type Geometry } from '../voronoi/pattern'
import { regionHeight, regionRings, regionWidth } from '../voronoi/region'
import { seedPoints } from '../voronoi/seeding'
import { shapeFromOutlines } from '../voronoi/shape'
import { runJob } from '../worker/jobs'
import { MIN_CUT, tidyOutline } from './cutPaths'
import { checkWords, crosses, EPS, findWebs, flatten, preflight, provablySimple, summaryWords, wallsOf, type Check, type CheckId, type Preflight } from './preflight'
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
  // The same tolerance as the app: a web within 1 µm of a limit passes.
  const classify = (list: number[]) => ({ burn: list.filter(d => d <= s.kerf + EPS).length, thin: list.filter(d => d > s.kerf + EPS && d < s.smallestWeb - EPS).length })
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

describe('Ready to cut? 1.13.3', () => {
  const pill = () => shapeFromOutlines(readSvgOutlines(readFileSync(new URL('../../test-fixtures/pill-with-hole.svg', import.meta.url), 'utf8')).rings, 'pill')
  // A bar with 12 teeth 4 mm wide and 3 mm apart, so cells straddle the gaps and are cut into pieces.
  const comb = (): Polygon => {
    const pts: Vec[] = [[0, 0], [100, 0], [100, 20]]
    for (let i = 0; i < 12; i++) { const x = 100 - i * (100 / 12); pts.push([x, 60], [x - 4, 60], [x - 4, 20]) }
    pts.push([0, 20])
    return pts.slice(0, -1).concat([[0, 60]]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
  }
  const inside = (ring: Polygon, [x, y]: Vec) => {
    let yes = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > y) !== (ring[j][1] > y) && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) yes = !yes
    return yes
  }

  it('passes webs set exactly to the smallest web, though offsets leave them a fraction of a micrometre thin', () => {
    const setups: Partial<Settings>[] = [
      { shape: 'custom', customShape: pill(), width: 160, height: 80, border: 1, cornerRadius: 0.8, count: 150 },
      { veins: 'leaf', veinLoops: true },
      { veins: 'wing' },
      { stretch: 3, stretchAngle: 30 },
      { shape: 'ellipse', border: 3, web: 3, smallestWeb: 3 },
    ]
    for (const over of setups) {
      const { s, points, g } = design({ cellStyle: 'holes', web: 1, smallestWeb: 1, showSites: false, ...over }, 3)
      const r = preflight(g, points, s)
      expect(find(r.checks, 'thinWebs'), JSON.stringify(Object.keys(over))).toBeUndefined()
      // ...while a web a hundredth of a millimetre under the limit is still listed.
      const under = design({ cellStyle: 'holes', web: 1, showSites: false, ...over, smallestWeb: (over.web ?? 1) + 0.01 }, 3)
      expect(find(preflight(under.g, under.points, under.s).checks, 'thinWebs')).toBeDefined()
    }
  })

  it('tells the worst from its limit when they would read the same', () => {
    const p: Preflight = { style: 'holes', checks: [], holes: 300, cells: 300 }
    const mm = { ...DEFAULTS, units: 'mm' as const }
    const check = (worst: number, threshold = 1): Check => ({ id: 'thinWebs', count: 3, worst, threshold, marks: { spots: [] } })
    expect(checkWords(check(0.997), p, mm).detail).toBe('Thinnest 0.997 mm, under 1 mm')
    expect(checkWords(check(0.9999), p, mm).detail).toBe('Thinnest 0.9999 mm, under 1 mm')
    expect(checkWords(check(0.8), p, mm).detail).toBe('Thinnest 0.8 mm, under 1 mm')
    expect(checkWords(check(0.99), p, { ...mm, units: 'in' }).detail).toBe('Thinnest 0.039 in, under 0.0394 in')
  })

  it('measures a wall bent into straight pieces whole, as the laser cuts it', () => {
    const { s, points, g } = design({ stretch: 3, stretchField: 'wave', showSites: false }, 3)
    const edges = g.edges.internal
    // Join pieces through every point where exactly two meet, by union-find.
    const parent = edges.map((_, i) => i)
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
    const at = new Map<string, number[]>()
    edges.forEach((e, i) => { for (const k of [`${Math.round(e[0] * 1e5)},${Math.round(e[1] * 1e5)}`, `${Math.round(e[2] * 1e5)},${Math.round(e[3] * 1e5)}`]) at.set(k, [...(at.get(k) ?? []), i]) })
    for (const list of at.values()) if (list.length === 2) parent[root(list[0])] = root(list[1])
    const lengths = new Map<number, number>()
    edges.forEach((e, i) => lengths.set(root(i), (lengths.get(root(i)) ?? 0) + Math.hypot(e[2] - e[0], e[3] - e[1])))
    const shortWalls = [...lengths.values()].filter(l => l >= MIN_CUT && l < s.smallestFeature - 1e-3).length
    const shortPieces = edges.filter(e => { const l = Math.hypot(e[2] - e[0], e[3] - e[1]); return l >= MIN_CUT && l < s.smallestFeature - 1e-3 }).length
    expect(lengths.size).toBeLessThan(edges.length)
    expect(wallsOf(edges).length).toBe(lengths.size)
    expect(find(preflight(g, points, s).checks, 'shortCuts')?.count ?? 0).toBe(shortWalls)
    expect(shortPieces).toBeGreaterThan(shortWalls)
    // A plain pattern's walls are single pieces.
    const plain = design({ showSites: false }, 3)
    expect(wallsOf(plain.g.edges.internal).length).toBe(plain.g.edges.internal.length)
  })

  it('measures the border of an elliptical sheet where it is narrowest', () => {
    const { s, points, g } = design({ shape: 'ellipse', width: 600, height: 60, border: 2, smallestWeb: 1.5, showSites: false })
    const border = find(preflight(g, points, s).checks, 'border')
    // Brute force: points round the inner ellipse (both semi-axes 2 mm shorter) to a 40,000-point outer one.
    const a = regionWidth(g.sheet) / 2, b = regionHeight(g.sheet) / 2
    let brute = Infinity
    for (let i = 0; i <= 1000; i++) {
      const t = (i / 1000) * (Math.PI / 2), qx = (a - 2) * Math.cos(t), qy = (b - 2) * Math.sin(t)
      for (let j = 0; j <= 10000; j++) { const u = (j / 10000) * (Math.PI / 2); brute = Math.min(brute, Math.hypot(a * Math.cos(u) - qx, b * Math.sin(u) - qy)) }
    }
    expect(border).toBeDefined()
    expect(border!.worst).toBeCloseTo(brute, 2)
    expect(border!.worst).toBeLessThan(1.2)
    expect(checkWords(border!, preflight(g, points, s), s).detail).toMatch(/^1\.1\d mm wide at its narrowest$/)
    // A circle's frame is the border all round.
    const circle = design({ shape: 'ellipse', border: 2, smallestWeb: 1.5, showSites: false })
    expect(find(preflight(circle.g, circle.points, circle.s).checks, 'border')).toBeUndefined()
  })

  it('checks each piece of a cell an outline cuts apart', () => {
    const base: Partial<Settings> = { shape: 'custom', customShape: shapeFromOutlines([comb()], 'comb'), width: 100, height: 60, border: 0, count: 150, showSites: false }
    // Lines style cuts each piece out on its own: a cell is as narrow as its narrowest piece.
    const lines = design({ ...base, smallestWeb: 1.5 }, 2)
    const narrow = lines.g.cells.filter(c => c && Math.min(...c.filter(r => signedArea(r) > 0).map(r => minWidth(convexHull(r)))) < 1.5 - 1e-3).length
    expect(find(preflight(lines.g, lines.points, lines.s).checks, 'thinCells')?.count ?? 0).toBe(narrow)
    const together = lines.g.cells.filter(c => c && minWidth(convexHull(c.flat())) < 1.5 - 1e-3).length
    expect(narrow).toBeGreaterThan(together)
    // Holes style: a piece with none of its cell's holes is left solid.
    const holes = design({ ...base, cellStyle: 'holes' }, 2)
    // A cell with no hole counts once, as before; a cell with a hole in one piece also lists its other pieces.
    let bare = 0, noHole = 0
    holes.g.cells.forEach((c, i) => {
      if (!c) return
      const mine = holes.g.holes.filter(h => h.cell === i)
      if (!mine.length) { bare++; noHole++; return }
      for (const ring of c.filter(r => signedArea(r) > 0)) if (!mine.some(h => inside(ring, h.outline.points[0]))) bare++
    })
    expect(bare).toBeGreaterThan(noHole)
    expect(find(preflight(holes.g, holes.points, holes.s).checks, 'solid')?.count ?? 0).toBe(bare)
  })

  it('words: one of several veins reaches the kerf, the only cell, and marks with the outline off', () => {
    const s = { ...DEFAULTS }
    const veins: Check = { id: 'thinVeins', count: 5, worst: 0.1, threshold: 1, burned: 1, marks: { spots: [] } }
    expect(checkWords(veins, { style: 'lines', checks: [], holes: 0, cells: 300 }, s).tip).toMatch(/and 1 reaches the 0\.15 mm kerf/)
    const solid: Check = { id: 'solid', count: 1, worst: NaN, threshold: NaN, marks: { spots: [] } }
    expect(checkWords(solid, { style: 'holes', checks: [solid], holes: 0, cells: 1 }, s).detail).toBe('The only cell is left solid')
    const marks: Preflight = { style: 'marks', checks: [], holes: 0, cells: 300 }
    expect(summaryWords(marks, { ...s, cellStyle: 'holes', sheetOutline: false })).toBe('Holes are hidden, so the cut files hold only the marks.')
    expect(summaryWords(marks, { ...s, cellStyle: 'holes', sheetOutline: true })).toBe('Holes are hidden, so the cut files hold only the sheet outline and any marks.')
  })
})

describe('Ready to cut? 1.13.4: short cuts are a note', () => {
  // The design the app opens with: the defaults, seeded and relaxed as the app does.
  const opening = (seed: number) => {
    const s = { ...DEFAULTS, seed }
    const points = runJob({ kind: 'generate', settings: s }).points
    return { s, points, g: buildGeometry(points, { ...s, stretchSpec: stretchOf(s) }) }
  }

  it('reads Ready to cut for a new design, with its short cuts as a note', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { s, points, g } = opening(seed)
      const r = preflight(g, points, s)
      const short = find(r.checks, 'shortCuts')
      // Every new design has some (10 to 17 in 40 seeds), and they were its only problem before 1.13.4.
      expect(short?.count, `seed ${seed}`).toBeGreaterThan(0)
      expect(short!.note).toBe(true)
      expect(r.checks.filter(c => !c.note).map(c => c.id), `seed ${seed}`).toEqual([])
      expect(summaryWords(r, s)).toBe('Ready to cut: no piece is narrower than 1 mm.')
    }
    // With no short cut the summary says so (this hex design's shortest wall is 0.39 mm, at the border).
    const hex = design({ placement: 'hex', showSites: false, smallestFeature: 0.3 })
    const clear = preflight(hex.g, hex.points, hex.s)
    expect(clear.checks).toEqual([])
    expect(summaryWords(clear, hex.s)).toBe('Ready to cut: no cut is shorter than 0.3 mm, and no piece narrower than 1 mm.')
  })

  it('lists problems before notes', () => {
    const { s, points, g } = design({ count: 3000, placement: 'random' })
    const r = preflight(g, points, s)
    const notes = r.checks.map(c => Boolean(c.note))
    expect(notes).toContain(true)
    expect(notes).toContain(false)
    expect(notes).toEqual([...notes].sort((a, b) => Number(a) - Number(b)))
    expect(r.checks.slice(-2).map(c => c.id)).toEqual(['shortCuts', 'marks'])
  })

  it('says the pieces are still cut out', () => {
    const { s, points, g } = opening(1)
    const r = preflight(g, points, s)
    const one = checkWords({ id: 'shortCuts', count: 1, worst: 0.2, threshold: 0.5, note: true, marks: { spots: [] } }, r, s)
    expect(one.label).toBe('1 cut shorter than the smallest feature')
    expect(one.detail).toBe('Shortest 0.2 mm, under 0.5 mm')
    expect(one.tip).toBe('This edge is shorter than your smallest feature (0.5 mm), so the laser cuts it as little more than a dot, and the cells around it seem to meet at one corner. Every piece is still cut out; only the look of that corner changes. Relax the pattern (R), or turn on Auto-relax (P), to lengthen it.')
    const many = checkWords(find(r.checks, 'shortCuts')!, r, s)
    expect(many.tip).toMatch(/^These edges are shorter than your smallest feature \(0\.5 mm\), so the laser cuts each as little more than a dot.* Every piece is still cut out; only the look of those corners changes\./)
  })
})
