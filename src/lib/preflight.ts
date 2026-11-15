// Ready to cut?: checks what Laser SVG and DXF will hold against the laser's kerf and the material's smallest web
// and smallest feature, so problems show, with where they are, before the laser runs. It only warns. The one block,
// cut files with no hole left in Holes style, is the File tab's own.
// - Holes style: cells left solid; webs (the material between two holes, or between a hole and the outline when the
//   outline is cut) no wider than the kerf, which the laser burns away, or under the smallest web; holes under the
//   smallest feature.
// - Lines style, which cuts every cell out as a piece: cells, the border and veins (strips cut along both sides) under
//   the smallest web, and, as a note, edges shorter than the smallest feature.
// - Both: hole outlines that cross themselves or are too small to write, and, as a note, sites or Delaunay lines in
//   the files.
// Notes are worth knowing before cutting but aren't problems: the summary still reads "Ready to cut", and they're
// listed after the problems.
// Webs are measured exactly. A convex hole is its core polygon grown by its corner radius, so the gap between two is
// the gap between their cores less both radii; other holes are measured on their outlines. Lengths are millimetres.
import { cellArea, cellCentroid, type Cell } from '../voronoi/diagram'
import { convexHull, isConvex, minWidth, signedArea, type Polygon, type Segment, type Vec } from '../voronoi/geometry'
import { arcFromBulge, type Hole, type Outline } from '../voronoi/holes'
import type { Geometry } from '../voronoi/pattern'
import { insetRegion, regionCenter, regionHeight, regionRings, regionWidth, type Region } from '../voronoi/region'
import { cutContents, MIN_CUT, MIN_PIECE, tidyOutline } from './cutPaths'
import type { Settings } from './settings'
import { siteRadius } from './style'
import { decimals, formatSmall, toUnits, trimZeros, UNIT_LABEL } from './units'

export type CheckId = 'solid' | 'burnWebs' | 'thinWebs' | 'smallHoles' | 'shortCuts' | 'thinCells' | 'border' | 'thinVeins'
  | 'crossing' | 'collapsed' | 'marks'
// Where a problem is, for the markers on the sheet: its centre and its size, mm.
export type Spot = { x: number; y: number; size: number }
// What to highlight on the sheet for a check: spots get ring markers; cells are filled; outlines, segments and rings
// are drawn over the design.
export type Marks = { spots: Spot[]; cells?: Cell[]; outlines?: Outline[]; segments?: Segment[]; rings?: Polygon[] }
export type Check = {
  id: CheckId
  count: number
  worst: number // the thinnest web, the narrowest hole or piece, the shortest cut, mm
  threshold: number // the machine value it's checked against, mm
  marks: Marks
  burned?: number // of count, how many are no wider than the kerf (pieces and veins)
  frames?: number // webs: how many are between a hole and the outline
  uneven?: boolean // border: the frame's width varies round the sheet (an ellipse), and worst is where it's narrowest
  sites?: number; delaunay?: number // marks: how many of each are in the files
  note?: boolean // worth knowing before cutting, but not a problem
}
// What the cut files hold: holes, cell edges, only marks or the outline (Holes or Edges hidden), or nothing.
export type CutStyle = 'holes' | 'lines' | 'marks' | 'nothing'
export type Preflight = { style: CutStyle; checks: Check[]; holes: number; cells: number }
export type PreflightSettings = Pick<Settings, 'cellStyle' | 'showEdges' | 'showSites' | 'showDelaunay' | 'sheetOutline' | 'border'
  | 'kerf' | 'smallestWeb' | 'smallestFeature'>

// mm: a web, hole, cut or piece within 1 µm of a limit passes. The cut files are written to 1 µm, and Clipper's
// 0.1 µm grid and offsets leave walls up to about half a micrometre off what was asked, so before 1.13.3 a 1 mm web
// with a 1 mm smallest web could read "Thinnest 1 mm, under 1 mm" on an imported outline or with veins.
export const EPS = 1e-3
const ARC_TOLERANCE = 0.005 // mm: arcs are flattened to within this for the outline checks

export function preflight(g: Geometry, points: Float64Array, s: PreflightSettings): Preflight {
  const kerf = Math.max(0, s.kerf), web = Math.max(0, s.smallestWeb), feature = Math.max(0, s.smallestFeature)
  const material = Math.max(kerf, web)
  const checks: Check[] = []
  const cells = g.cells.reduce((n, c) => n + (c ? 1 : 0), 0)
  const style: CutStyle = !cutContents(s).length ? 'nothing' : !s.showEdges ? 'marks' : s.cellStyle === 'holes' ? 'holes' : 'lines'

  if (style === 'holes') {
    // Cells left solid, and pieces of a cell an outline cuts apart that are too narrow for a hole of their own while
    // another piece has one (each piece gets its own hole; before 1.13.3 such pieces weren't listed).
    const holesOf = new Map<number, Hole[]>()
    for (const h of g.holes) { const list = holesOf.get(h.cell); if (list) list.push(h); else holesOf.set(h.cell, [h]) }
    const solid: Cell[] = [], solidSpots: Spot[] = []
    g.cells.forEach((cell, i) => {
      if (!cell) return
      const mine = holesOf.get(i)
      for (const bare of mine ? barePieces(cell, mine) : [cell]) {
        solid.push(bare)
        const [x, y] = cellCentroid(bare)
        solidSpots.push({ x, y, size: Math.sqrt(Math.abs(cellArea(bare))) })
      }
    })
    if (solid.length) checks.push({ id: 'solid', count: solid.length, worst: NaN, threshold: NaN, marks: { spots: solidSpots, cells: solid } })

    // The holes as the cut files write them; those too small to write are left out of them.
    const cut: { hole: Hole; outline: Outline }[] = [], collapsed: Spot[] = []
    for (const hole of g.holes) {
      const outline = tidyOutline(hole.outline)
      if (outline) cut.push({ hole, outline })
      else collapsed.push(spotOf(hole))
    }

    // Webs, and the frame between holes and the outline when the outline is cut.
    const frame = s.sheetOutline ? regionRings(g.sheet) : []
    const webs = findWebs(cut.map(c => c.hole), frame, material + 2 * EPS)
    const burn = webs.filter(w => w.width <= kerf + EPS), thin = webs.filter(w => w.width > kerf + EPS && w.width < web - EPS)
    for (const [id, list, threshold] of [['burnWebs', burn, kerf], ['thinWebs', thin, web]] as const) {
      if (!list.length) continue
      checks.push({
        id, count: list.length, worst: Math.max(0, least(list.map(w => w.width))), threshold, frames: list.filter(w => w.b < 0).length,
        marks: {
          spots: list.map(w => ({ x: (w.p[0] + w.q[0]) / 2, y: (w.p[1] + w.q[1]) / 2, size: Math.max(0, w.width) })),
          segments: list.map((w): Segment => [w.p[0], w.p[1], w.q[0], w.q[1]]),
        },
      })
    }

    // Holes under the smallest feature.
    const small = cut.filter(c => c.hole.width < feature - EPS)
    if (small.length) checks.push({
      id: 'smallHoles', count: small.length, worst: least(small.map(c => c.hole.width)), threshold: feature,
      marks: { spots: small.map(c => spotOf(c.hole)), outlines: small.map(c => c.outline) },
    })

    // Outlines that cross themselves, and holes too small to write. A convex hole that tidying left as it was is its
    // core grown by its radius, which can't cross itself.
    const crossing = cut.filter(c => !(c.hole.core && c.outline.points.length === c.hole.outline.points.length)
      && !provablySimple(c.outline) && crosses(flatten(c.outline)))
    if (crossing.length) checks.push({ id: 'crossing', count: crossing.length, worst: NaN, threshold: NaN, marks: { spots: crossing.map(c => spotOf(c.hole)), outlines: crossing.map(c => c.outline) } })
    if (collapsed.length) checks.push({ id: 'collapsed', count: collapsed.length, worst: NaN, threshold: MIN_PIECE, marks: { spots: collapsed } })
  }

  if (style === 'lines') {
    // Walls shorter than the smallest feature (walls under 5 µm aren't in the files at all). A wall is measured whole:
    // with a stretch that follows a field it's drawn as several straight pieces, which before 1.13.3 were each
    // counted as a short cut. They're a note: the laser cuts one as little more than a dot, which changes how the
    // corner looks but not the pieces. Before 1.13.4 they were a problem, and every new design had 10 to 17.
    const short = wallsOf(g.edges.internal).filter(w => w.length >= MIN_CUT && w.length < feature - EPS)
    if (short.length) checks.push({
      id: 'shortCuts', count: short.length, worst: least(short.map(w => w.length)), threshold: feature, note: true,
      marks: {
        spots: short.map(w => { const e = w.pieces[0]; return { x: (e[0] + e[2]) / 2, y: (e[1] + e[3]) / 2, size: w.length } }),
        segments: short.flatMap(w => w.pieces),
      },
    })

    // Every cell is cut out as a piece: pieces under the smallest web.
    const thin: Cell[] = [], thinSpots: Spot[] = []
    let narrowest = Infinity, burned = 0
    for (const cell of g.cells) {
      if (!cell) continue
      const width = cellWidth(cell)
      if (!(width < material - EPS)) continue
      thin.push(cell)
      const [x, y] = cellCentroid(cell)
      thinSpots.push({ x, y, size: width })
      narrowest = Math.min(narrowest, width)
      if (width <= kerf + EPS) burned++
    }
    if (thin.length) checks.push({ id: 'thinCells', count: thin.length, worst: narrowest, threshold: material, burned, marks: { spots: thinSpots, cells: thin } })

    // The frame between the pattern and the sheet outline, a piece of its own when both are cut. Round an ellipse it
    // narrows toward the ends of the long axis, so it's measured there (before 1.13.3 it was taken to be the border).
    if (s.sheetOutline && s.border > 1e-9) {
      const ellipse = g.sheet.shape === 'ellipse' ? ellipseFrame(g.sheet, insetRegion(g.sheet, s.border)) : null
      const width = ellipse ? ellipse.width : s.border
      if (width < material - EPS) checks.push({
        id: 'border', count: 1, worst: width, threshold: material, burned: width <= kerf + EPS ? 1 : 0, uneven: Boolean(ellipse),
        marks: { spots: ellipse ? ellipse.at.map(([x, y]) => ({ x, y, size: width })) : [], rings: regionRings(g.sheet) },
      })
    }

    // Veins: Lines style cuts along both sides of each, so each is a strip of material.
    const veins = thinVeins(g.region.lines ?? [], g.region.widths ?? [], material - EPS, kerf + EPS)
    if (veins.count) checks.push({ id: 'thinVeins', count: veins.count, worst: veins.worst, threshold: material, burned: veins.burned, marks: { spots: veins.spots, segments: veins.spans } })
  }

  // Sites and Delaunay lines go in the cut files as marks, on their own layers.
  if (style !== 'nothing') {
    const sites = s.showSites ? points.length / 2 : 0
    const delaunay = s.showDelaunay ? g.delaunay.filter(e => Math.hypot(e[2] - e[0], e[3] - e[1]) >= MIN_CUT) : []
    if (sites || delaunay.length) {
      const r = sites ? siteRadius(g.region, sites) : 0
      const spots: Spot[] = []
      for (let i = 0; i < sites * 2; i += 2) spots.push({ x: points[i], y: points[i + 1], size: 2 * r })
      checks.push({ id: 'marks', count: sites + delaunay.length, worst: NaN, threshold: NaN, sites, delaunay: delaunay.length, note: true, marks: { spots, segments: delaunay } })
    }
  }
  // Problems first, then notes.
  return { style, checks: [...checks.filter(c => !c.note), ...checks.filter(c => c.note)], holes: g.holes.length, cells }
}

// The smallest of many values (spreading tens of thousands into Math.min can overflow the stack).
const least = (values: number[]) => values.reduce((m, v) => (v < m ? v : m), Infinity)

// ---------- webs ----------

// A hole or an outline ring for measuring gaps: its ring (a convex hole's core) and how far its outline is grown
// from it. Boxes: the ring's, and the outline's (grown by r).
type Body = { xs: Float64Array; ys: Float64Array; r: number; rx0: number; ry0: number; rx1: number; ry1: number; x0: number; y0: number; x1: number; y1: number }
// A web: where holes a and b (or the outline, b = −1) come within the limit, with the closest points of their outlines.
export type Web = { a: number; b: number; width: number; p: Vec; q: Vec }

function bodyOf(ring: Vec[], r: number): Body {
  const n = ring.length, xs = new Float64Array(n), ys = new Float64Array(n)
  let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity
  ring.forEach(([x, y], i) => { xs[i] = x; ys[i] = y; rx0 = Math.min(rx0, x); ry0 = Math.min(ry0, y); rx1 = Math.max(rx1, x); ry1 = Math.max(ry1, y) })
  return { xs, ys, r, rx0, ry0, rx1, ry1, x0: rx0 - r, y0: ry0 - r, x1: rx1 + r, y1: ry1 + r }
}

// A hole as a body: a convex hole's core and radius, or the polygon through its outline, arcs flattened.
export function holeBody(hole: Hole): Body {
  return hole.core && hole.core.length >= 3 ? bodyOf(hole.core, hole.radius ?? 0) : bodyOf(flatten(hole.outline), 0)
}

// Every web under `limit`: hole to hole, and hole to outline. Pairs are found through a grid of the holes' boxes, and
// each pair only compares the edges within reach of the other's box.
export function findWebs(holes: Hole[], outline: Polygon[], limit: number): Web[] {
  const bodies = holes.map(holeBody)
  const webs: Web[] = []
  const n = bodies.length
  if (!n) return webs
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity, area = 0
  for (const b of bodies) { X0 = Math.min(X0, b.x0); Y0 = Math.min(Y0, b.y0); X1 = Math.max(X1, b.x1); Y1 = Math.max(Y1, b.y1); area += (b.x1 - b.x0) * (b.y1 - b.y0) }
  X0 -= limit; Y0 -= limit; X1 += limit; Y1 += limit
  // Grid cells about the size of a hole, and never more than a few per hole.
  let size = Math.max(limit, Math.sqrt(area / n), 1e-3)
  while (Math.ceil((X1 - X0) / size) * Math.ceil((Y1 - Y0) / size) > 4 * n + 64) size *= 1.5
  const grid = makeGrid(X0, Y0, X1, Y1, size, n, i => bodies[i], limit / 2)
  const seen = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const a = bodies[i]
    grid.visit(a.x0 - limit / 2, a.y0 - limit / 2, a.x1 + limit / 2, a.y1 + limit / 2, j => {
      if (j <= i || seen[j] === i) return
      seen[j] = i
      const b = bodies[j]
      if (b.x0 - a.x1 >= limit || a.x0 - b.x1 >= limit || b.y0 - a.y1 >= limit || a.y0 - b.y1 >= limit) return
      const width = bodyGap(a, b, limit)
      if (width < limit) webs.push({ a: i, b: j, width, p: [gapP[0], gapP[1]], q: [gapQ[0], gapQ[1]] })
    })
  }
  // The frame: each hole's gap to the nearest outline edge. Edges go in a grid of their own.
  if (outline.length) {
    const edges: Body[] = []
    for (const ring of outline) for (let k = 0; k < ring.length; k++) edges.push(bodyOf([ring[k], ring[(k + 1) % ring.length]], 0))
    const egrid = makeGrid(X0, Y0, X1, Y1, size, edges.length, k => edges[k], 0)
    const stamp = new Int32Array(edges.length).fill(-1)
    for (let i = 0; i < n; i++) {
      const a = bodies[i]
      let best = limit, p: Vec = [0, 0], q: Vec = [0, 0]
      egrid.visit(a.x0 - limit, a.y0 - limit, a.x1 + limit, a.y1 + limit, k => {
        if (stamp[k] === i) return
        stamp[k] = i
        const width = bodyGap(a, edges[k], best, true)
        if (width < best) { best = width; p = [gapP[0], gapP[1]]; q = [gapQ[0], gapQ[1]] }
      })
      if (best < limit) webs.push({ a: i, b: -1, width: best, p, q })
    }
  }
  return webs
}

// A uniform grid of boxes (grown by `pad`), listing which fall in each cell.
function makeGrid(X0: number, Y0: number, X1: number, Y1: number, size: number, count: number, box: (i: number) => Body, pad: number) {
  const cols = Math.max(1, Math.ceil((X1 - X0) / size)), rows = Math.max(1, Math.ceil((Y1 - Y0) / size))
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - X0) / size)))
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - Y0) / size)))
  const start = new Int32Array(cols * rows + 1)
  const span = (i: number) => { const b = box(i); return [col(b.x0 - pad), row(b.y0 - pad), col(b.x1 + pad), row(b.y1 + pad)] as const }
  for (let i = 0; i < count; i++) { const [c0, r0, c1, r1] = span(i); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) start[r * cols + c + 1]++ }
  for (let k = 0; k < cols * rows; k++) start[k + 1] += start[k]
  const items = new Int32Array(start[cols * rows]), fill = start.slice(0, cols * rows)
  for (let i = 0; i < count; i++) { const [c0, r0, c1, r1] = span(i); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) items[fill[r * cols + c]++] = i }
  return {
    visit(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void) {
      const c0 = col(x0), c1 = col(x1), r0 = row(y0), r1 = row(y1)
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (let k = start[r * cols + c]; k < start[r * cols + c + 1]; k++) fn(items[k])
    },
  }
}

// The closest points of the last bodyGap: on a's outline and on b's.
const gapP: Vec = [0, 0], gapQ: Vec = [0, 0]
let nearX = 0, nearY = 0

// Squared distance from a point to a segment; the closest point goes in nearX, nearY.
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey
  let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  nearX = ax + ex * t; nearY = ay + ey * t
  return (px - nearX) ** 2 + (py - nearY) ** 2
}
const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
let segP0 = 0, segP1 = 0, segQ0 = 0, segQ1 = 0
// Squared gap between segments ab and cd, 0 where they cross; the closest points go in segP and segQ.
function segmentGap2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const d1 = orient(ax, ay, bx, by, cx, cy), d2 = orient(ax, ay, bx, by, dx, dy)
  const d3 = orient(cx, cy, dx, dy, ax, ay), d4 = orient(cx, cy, dx, dy, bx, by)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d3 / (d3 - d4)
    segP0 = segQ0 = ax + (bx - ax) * t; segP1 = segQ1 = ay + (by - ay) * t
    return 0
  }
  let best = toSegment(ax, ay, cx, cy, dx, dy); segP0 = ax; segP1 = ay; segQ0 = nearX; segQ1 = nearY
  let d = toSegment(bx, by, cx, cy, dx, dy); if (d < best) { best = d; segP0 = bx; segP1 = by; segQ0 = nearX; segQ1 = nearY }
  d = toSegment(cx, cy, ax, ay, bx, by); if (d < best) { best = d; segP0 = nearX; segP1 = nearY; segQ0 = cx; segQ1 = cy }
  d = toSegment(dx, dy, ax, ay, bx, by); if (d < best) { best = d; segP0 = nearX; segP1 = nearY; segQ0 = dx; segQ1 = dy }
  return best
}

// Edges of a body within `reach` of a box, as indices into a shared buffer.
let edgeBuffer = new Int32Array(256)
function edgesNear(body: Body, x0: number, y0: number, x1: number, y1: number, reach: number, into: number): number {
  const { xs, ys } = body, n = xs.length, open = n === 2
  let count = 0
  for (let i = 0; i < (open ? 1 : n); i++) {
    const j = i + 1 === n ? 0 : i + 1
    if (Math.min(xs[i], xs[j]) > x1 + reach || Math.max(xs[i], xs[j]) < x0 - reach || Math.min(ys[i], ys[j]) > y1 + reach || Math.max(ys[i], ys[j]) < y0 - reach) continue
    if (into + count >= edgeBuffer.length) { const grown = new Int32Array(edgeBuffer.length * 2); grown.set(edgeBuffer); edgeBuffer = grown }
    edgeBuffer[into + count++] = i
  }
  return count
}

// The width of material between two bodies, if under `limit` (else Infinity): the gap between their rings less both
// radii, with the closest points of their outlines in gapP and gapQ. `segment`: b is a single outline edge.
function bodyGap(a: Body, b: Body, limit: number, segment = false): number {
  const reach = limit + a.r + b.r
  const na = edgesNear(a, b.rx0, b.ry0, b.rx1, b.ry1, reach, 0)
  const nb = segment ? 1 : edgesNear(b, a.rx0, a.ry0, a.rx1, a.ry1, reach, na)
  if (!na || !nb) return Infinity
  let best = reach * reach, found = false, px = 0, py = 0, qx = 0, qy = 0
  const an = a.xs.length, bn = b.xs.length
  for (let s = 0; s < na; s++) {
    const i = edgeBuffer[s], i2 = i + 1 === an ? 0 : i + 1
    const ax = a.xs[i], ay = a.ys[i], bx = a.xs[i2], by = a.ys[i2]
    const ex0 = Math.min(ax, bx), ex1 = Math.max(ax, bx), ey0 = Math.min(ay, by), ey1 = Math.max(ay, by)
    for (let t = 0; t < nb; t++) {
      const j = segment ? 0 : edgeBuffer[na + t], j2 = j + 1 === bn ? 0 : j + 1
      const cx = b.xs[j], cy = b.ys[j], dx = b.xs[j2], dy = b.ys[j2]
      // Edges whose boxes are already farther apart than the best gap can't beat it.
      const gx = Math.max(0, Math.min(cx, dx) - ex1, ex0 - Math.max(cx, dx)), gy = Math.max(0, Math.min(cy, dy) - ey1, ey0 - Math.max(cy, dy))
      if (gx * gx + gy * gy >= best) continue
      const d = segmentGap2(ax, ay, bx, by, cx, cy, dx, dy)
      if (d < best) { best = d; found = true; px = segP0; py = segP1; qx = segQ0; qy = segQ1 }
    }
  }
  if (!found) return Infinity
  const gap = Math.sqrt(best)
  // From the rings to the outlines: each closest point moves its body's radius toward the other.
  const ux = gap > 1e-12 ? (qx - px) / gap : 0, uy = gap > 1e-12 ? (qy - py) / gap : 0
  gapP[0] = px + ux * a.r; gapP[1] = py + uy * a.r
  gapQ[0] = qx - ux * b.r; gapQ[1] = qy - uy * b.r
  return gap - a.r - b.r
}

// ---------- outlines ----------

// An outline as a polygon, arcs flattened to within ARC_TOLERANCE.
export function flatten({ points, bulges }: Outline, tolerance = ARC_TOLERANCE): Vec[] {
  const out: Vec[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], bulge = bulges[i]
    out.push([a[0], a[1]])
    if (Math.abs(bulge) < 1e-9) continue
    const arc = arcFromBulge(a, b, bulge)
    const sweep = 4 * Math.atan(bulge) // signed, the way the outline turns
    const step = arc.r > tolerance ? 2 * Math.acos(1 - tolerance / arc.r) : Math.PI / 2
    const pieces = Math.min(256, Math.max(1, Math.ceil(Math.abs(sweep) / step)))
    for (let k = 1; k < pieces; k++) {
      const t = arc.start + (sweep * k) / pieces
      out.push([arc.cx + arc.r * Math.cos(t), arc.cy + arc.r * Math.sin(t)])
    }
  }
  return out
}

// Whether an outline is convex all the way round, arcs included, turning once: then it can't cross itself.
export function provablySimple({ points, bulges }: Outline): boolean {
  const n = points.length
  if (n < 3) return false
  let total = 0, sign = 0
  const turn = (t: number) => {
    if (Math.abs(t) < 1e-9) return true
    if (!sign) sign = Math.sign(t)
    total += t
    return Math.sign(t) === sign
  }
  const chord = (i: number) => { const a = points[i], b = points[(i + 1) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]) }
  for (let i = 0; i < n; i++) {
    // The turn at point i, from the end of the piece before it to the start of the piece after it, then along the piece.
    const before = (i - 1 + n) % n
    const sweepBefore = 4 * Math.atan(bulges[before]), sweep = 4 * Math.atan(bulges[i])
    let corner = (chord(i) - sweep / 2) - (chord(before) + sweepBefore / 2)
    corner = Math.atan2(Math.sin(corner), Math.cos(corner))
    if (!turn(corner) || !turn(sweep)) return false
  }
  return Math.abs(Math.abs(total) - 2 * Math.PI) < 1e-6
}

// Whether a closed polygon crosses itself (pieces that only touch at their shared ends don't count).
export function crosses(ring: Vec[]): boolean {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n]
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1])
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const c = ring[j], d = ring[(j + 1) % n]
      if (Math.max(c[0], d[0]) < x0 || Math.min(c[0], d[0]) > x1 || Math.max(c[1], d[1]) < y0 || Math.min(c[1], d[1]) > y1) continue
      const d1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]), d2 = orient(a[0], a[1], b[0], b[1], d[0], d[1])
      const d3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]), d4 = orient(c[0], c[1], d[0], d[1], b[0], b[1])
      if (d1 * d2 < -1e-12 && d3 * d4 < -1e-12) return true
    }
  }
  return false
}

function spotOf(hole: Hole): Spot {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of hole.outline.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, size: hole.width }
}

// A cell's separate pieces (an outline can cut a cell apart): its outer rings, each with the inner rings inside it.
function piecesOf(cell: Cell): Cell[] {
  if (cell.length === 1) return [cell]
  const outer = cell.filter(ring => signedArea(ring) > 0), inner = cell.filter(ring => signedArea(ring) < 0)
  if (outer.length <= 1) return [cell]
  return outer.map(ring => [ring, ...inner.filter(hole => inside(ring, hole[0]))])
}

// The pieces of a cell with none of its holes in them.
function barePieces(cell: Cell, holes: Hole[]): Cell[] {
  const pieces = piecesOf(cell)
  if (pieces.length === 1) return []
  return pieces.filter(piece => !holes.some(h => h.outline.points.length > 0 && inside(piece[0], h.outline.points[0])))
}

// The narrowest width of a cell, across each piece's convex outline (a slight overestimate for concave ones). Lines style
// cuts each piece out on its own, so a cell an outline cuts apart is as narrow as its narrowest piece (before 1.13.3
// all its pieces were measured as one).
function cellWidth(cell: Cell): number {
  let narrowest = Infinity
  for (const [ring] of piecesOf(cell)) narrowest = Math.min(narrowest, isConvex(ring) ? minWidth(ring) : minWidth(convexHull(ring)))
  return narrowest
}

// Whether a point is inside a ring (even-odd).
function inside(ring: Polygon, [x, y]: Vec): boolean {
  let yes = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) yes = !yes
  }
  return yes
}

// A cell wall as the laser cuts it, from one corner where three or more cells meet (or the border) to the next.
export type Wall = { length: number; pieces: Segment[] }

// The walls the edges make. With a stretch that follows a field a wall is drawn as several straight pieces, which meet
// only each other, so pieces are joined through every point where exactly two meet. Ends are matched on a 10 nm grid
// in a hash table of their own (a Map of text keys made the Lines check 3.5 times slower).
export function wallsOf(edges: Segment[]): Wall[] {
  const m = edges.length, size = 1 << Math.max(4, Math.ceil(Math.log2(4 * m + 1))), mask = size - 1
  const kx = new Int32Array(size), ky = new Int32Array(size), count = new Int32Array(size)
  const first = new Int32Array(size), second = new Int32Array(size) // the first two pieces at each point
  const at = new Int32Array(2 * m) // the table slot of each piece's two ends
  for (let i = 0; i < 2 * m; i++) {
    const e = edges[i >> 1], ix = Math.round(e[(i & 1) * 2] * 1e5), iy = Math.round(e[(i & 1) * 2 + 1] * 1e5)
    let slot = ((Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca77)) >>> 0) & mask
    while (count[slot] && (kx[slot] !== ix || ky[slot] !== iy)) slot = (slot + 1) & mask
    if (!count[slot]) { kx[slot] = ix; ky[slot] = iy; first[slot] = i >> 1 } else if (count[slot] === 1) second[slot] = i >> 1
    count[slot]++
    at[i] = slot
  }
  const used = new Uint8Array(m), walls: Wall[] = []
  for (let i = 0; i < m; i++) {
    if (used[i]) continue
    used[i] = 1
    const pieces = [edges[i]]
    for (let end = 0; end < 2; end++) {
      let slot = at[2 * i + end], from = i
      while (count[slot] === 2) {
        const next = first[slot] === from ? second[slot] : first[slot]
        if (used[next]) break
        used[next] = 1; pieces.push(edges[next])
        slot = at[2 * next] === slot ? at[2 * next + 1] : at[2 * next]
        from = next
      }
    }
    let length = 0
    for (const e of pieces) length += Math.hypot(e[2] - e[0], e[3] - e[1])
    walls.push({ length, pieces })
  }
  return walls
}

// The narrowest frame between an elliptical sheet and the ellipse its pattern fills, which has both semi-axes shortened
// by the border. It narrows toward the ends of the long axis: a 600 × 60 mm sheet with a 2 mm border is 1.14 mm wide
// there. Points round a quarter of the inner ellipse are each measured to the outer one by Newton's method, from two
// starting angles (each result is a true distance, so the smaller is kept); `at` is where it's narrowest, all four ways.
export function ellipseFrame(sheet: Region, inner: Region): { width: number; at: Vec[] } {
  const [cx, cy] = regionCenter(sheet)
  const a = regionWidth(sheet) / 2, b = regionHeight(sheet) / 2, ia = regionWidth(inner) / 2, ib = regionHeight(inner) / 2
  const toOuter = (qx: number, qy: number, t: number) => {
    for (let k = 0; k < 20; k++) {
      const c = Math.cos(t), s = Math.sin(t), px = a * c - qx, py = b * s - qy
      const g = -a * s * px + b * c * py, dg = a * a * s * s + b * b * c * c - a * c * px - b * s * py
      if (!(Math.abs(dg) > 1e-15)) break
      const step = g / dg
      t -= step
      if (Math.abs(step) < 1e-13) break
    }
    return Math.hypot(a * Math.cos(t) - qx, b * Math.sin(t) - qy)
  }
  const N = 2048
  let width = Infinity, best = 0
  for (let i = 0; i <= N; i++) {
    const phi = (i / N) * (Math.PI / 2), qx = ia * Math.cos(phi), qy = ib * Math.sin(phi)
    const d = Math.min(toOuter(qx, qy, phi), toOuter(qx, qy, Math.atan2(a * qy, b * qx)))
    if (d < width) { width = d; best = phi }
  }
  const x = ia * Math.cos(best), y = ib * Math.sin(best)
  return { width, at: [[cx + x, cy + y], [cx - x, cy + y], [cx + x, cy - y], [cx - x, cy - y]] }
}

// Veins under `limit` somewhere along their length: how many, the thinnest, how many reach `burn`, the stretches
// under the limit, and each one's thinnest point. Stretches of no width aren't drawn, so they don't count.
function thinVeins(lines: Polygon[], widths: number[][], limit: number, burn: number) {
  const spans: Segment[] = [], spots: Spot[] = []
  let count = 0, burned = 0, worst = Infinity
  lines.forEach((line, k) => {
    const w = widths[k]
    if (!w || w.length !== line.length) return
    let least = Infinity, at: Vec = line[0]
    for (let i = 0; i + 1 < line.length; i++) {
      const [a, b] = [line[i], line[i + 1]], w0 = w[i], w1 = w[i + 1]
      for (const [p, v] of [[a, w0], [b, w1]] as const) if (v > 1e-6 && v < least) { least = v; at = p }
      if (Math.min(w0, w1) >= limit || Math.max(w0, w1) <= 1e-6) continue
      // The part of the piece where the width is under the limit (widths change linearly along it).
      const t = (limit - w0) / (w1 - w0 || 1e-12)
      const [t0, t1] = w0 < limit && w1 < limit ? [0, 1] : w0 < limit ? [0, t] : [t, 1]
      spans.push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1])
    }
    if (least < limit) {
      count++
      if (least <= burn) burned++
      worst = Math.min(worst, least)
      spots.push({ x: at[0], y: at[1], size: least })
    }
  })
  return { count, burned, worst, spans, spots }
}

// ---------- words ----------

export type WordSettings = Pick<Settings, 'units' | 'dpi' | 'kerf' | 'smallestWeb' | 'smallestFeature' | 'minHole' | 'wallsFollow' | 'cellStyle'>
  & Partial<Pick<Settings, 'sheetOutline'>>
export type CheckWords = { label: string; detail: string; tip: string }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const counted = (n: number, one: string, many: string) => `${n.toLocaleString()} ${plural(n, one, many)}`

// A measured value and the limit it's under, each with up to two more decimals than usual when they would otherwise
// read the same: "0.997 mm, under 1 mm", never "1 mm, under 1 mm".
export function underWords(value: number, limit: number, s: Pick<Settings, 'units' | 'dpi'>): [string, string] {
  const shown = formatSmall(value, s.units, s.dpi), shownLimit = formatSmall(limit, s.units, s.dpi)
  if (shown !== shownLimit || !(value < limit)) return [shown, shownLimit]
  const at = (mm: number, digits: number) => `${trimZeros(toUnits(mm, s.units, s.dpi).toFixed(digits))} ${UNIT_LABEL[s.units]}`
  const digits = decimals(s.units, true)
  const v1 = at(value, digits + 1), l1 = at(limit, digits + 1)
  return v1 !== l1 ? [v1, l1] : [at(value, digits + 2), at(limit, digits + 2)]
}

// A check's row in the File tab: what's wrong, a short detail, and a tooltip that says why it fails and how to fix it.
export function checkWords(c: Check, p: Preflight, s: WordSettings): CheckWords {
  const L = (mm: number) => formatSmall(mm, s.units, s.dpi)
  const n = c.count, one = n === 1
  const kerf = L(s.kerf), web = L(Math.max(s.kerf, s.smallestWeb)), feature = L(s.smallestFeature)
  // "Thinnest 0.997 mm, under 1 mm": the worst and its limit, told apart.
  const under = (what: string, limit: number) => { const [v, l] = underWords(c.worst, limit, s); return `${what} ${v}, under ${l}` }
  switch (c.id) {
    case 'solid':
      if (!p.holes) return {
        label: 'No holes to cut', detail: one ? 'The only cell is left solid' : `All ${counted(n, 'cell is', 'cells are')} left solid`,
        tip: 'Every cell is narrower than Smallest hole once the web is taken out, so Laser SVG and DXF are off. Lower Web width or Smallest hole on the Style tab, or use fewer cells.',
      }
      return {
        label: `${counted(n, 'cell', 'cells')} left solid`, detail: 'Too narrow for a hole',
        tip: `${one ? 'This cell is' : 'These cells are'} narrower than Smallest hole (${L(s.minHole)}) once the web is taken out, so the cut files have no hole there. To cut ${one ? 'it' : 'them'}, lower Web width or Smallest hole on the Style tab, or relax the pattern.`,
      }
    case 'burnWebs': case 'thinWebs': {
      const burn = c.id === 'burnWebs'
      const frames = c.frames ?? 0, inner = n - frames
      const fixes = [
        inner > 0 && `raise Web width on the Style tab${s.wallsFollow > 0 ? ', or lower Walls follow cell size' : ''}`,
        frames > 0 && `widen Border on the Sheet tab, or turn off Include the sheet outline, for the ${counted(frames, 'web', 'webs')} along the outline`,
      ].filter(Boolean).join('; ')
      const which = one ? 'This web is' : 'These webs are'
      return burn ? {
        label: `${counted(n, 'web', 'webs')} the laser burns away`, detail: c.worst > 1e-9 ? `Thinnest ${L(c.worst)}, kerf ${kerf}` : 'Holes touch',
        tip: `${which} no wider than the ${kerf} kerf, so cutting the holes on both sides takes ${one ? 'it' : 'them'} away and the holes join. To keep ${one ? 'it' : 'them'}, ${fixes}.`,
      } : {
        label: `${counted(n, 'web', 'webs')} under the smallest web`, detail: under('Thinnest', c.threshold),
        tip: `${which} thinner than your smallest web (${web}), so ${one ? 'it' : 'they'} may char, warp or snap. To thicken ${one ? 'it' : 'them'}, ${fixes}.`,
      }
    }
    case 'smallHoles':
      return {
        label: `${counted(n, 'hole', 'holes')} under the smallest feature`, detail: under('Narrowest', c.threshold),
        tip: `${one ? 'This hole is' : 'These holes are'} narrower than your smallest feature (${feature}), so ${one ? 'it' : 'they'} may char shut or not drop out. Raise Smallest hole on the Style tab to ${feature} to leave ${one ? 'it' : 'them'} solid, or use fewer cells.`,
      }
    case 'shortCuts':
      return {
        label: `${counted(n, 'cut', 'cuts')} shorter than the smallest feature`, detail: under('Shortest', c.threshold),
        tip: `${one ? 'This edge is' : 'These edges are'} shorter than your smallest feature (${feature}), so the laser cuts ${one ? 'it' : 'each'} as little more than a dot, and the cells around ${one ? 'it' : 'each'} seem to meet at one corner. Every piece is still cut out; only the look of ${one ? 'that corner' : 'those corners'} changes. Relax the pattern (R), or turn on Auto-relax (P), to lengthen ${one ? 'it' : 'them'}.`,
      }
    case 'thinCells': {
      const burned = c.burned ?? 0
      return {
        label: `${counted(n, 'cell', 'cells')} narrower than the smallest web`, detail: under('Narrowest', c.threshold),
        tip: `Lines style cuts every cell out as a piece, and ${one ? 'this one is' : 'these are'} under your smallest web (${web}) across, so ${one ? 'it' : 'they'} may burn or fall through the bed${burned ? `. ${counted(burned, 'is', 'are')} no wider than the ${kerf} kerf, which the laser burns away` : ''}. Relax the pattern (R), use fewer cells, or move the points apart.`,
      }
    }
    case 'border': {
      const burns = (c.burned ?? 0) > 0
      return {
        label: burns ? 'The border burns away' : 'Border under the smallest web', detail: `${L(c.worst)} wide${c.uneven ? ' at its narrowest' : ''}`,
        tip: `The frame between the pattern and the sheet outline is ${L(c.worst)} wide${c.uneven ? ' where it’s narrowest, toward the ends of the long axis' : ''}, ${burns ? `no wider than the ${kerf} kerf, so the laser burns it away` : `under your smallest web (${web}), so it may snap`}. Widen Border on the Sheet tab, set it to 0, or turn off Include the sheet outline.`,
      }
    }
    case 'thinVeins': {
      const burned = c.burned ?? 0
      const reach = burned === n ? (one ? 'it reaches' : 'all reach') : counted(burned, 'reaches', 'reach')
      return {
        label: `${counted(n, 'vein', 'veins')} under the smallest web`, detail: under('Thinnest', c.threshold),
        tip: `Lines style cuts along both sides of each vein, so each vein is a strip of material. ${one ? 'This one narrows to' : 'These narrow to as little as'} ${L(c.worst)}, under your smallest web (${web})${burned ? `, and ${reach} the ${kerf} kerf, which the laser burns away` : ''}. Raise Vein width or lower Taper on the Pattern tab, or use Holes, where veins join the web.`,
      }
    }
    case 'crossing':
      return {
        label: `${counted(n, 'hole outline crosses', 'hole outlines cross')} ${one ? 'itself' : 'themselves'}`, detail: 'The laser may cut a loop twice',
        tip: `${one ? 'This outline crosses' : 'These outlines cross'} over ${one ? 'itself' : 'themselves'}, so the laser can cut a loop twice or leave a sliver. Change Corner radius or Smallest hole on the Style tab a little to rebuild ${one ? 'it' : 'them'}.`,
      }
    case 'collapsed':
      return {
        label: `${counted(n, 'hole is', 'holes are')} too small for the cut files`, detail: `Under ${L(MIN_PIECE)}`,
        tip: `${one ? 'This hole is' : 'These holes are'} under ${L(MIN_PIECE)} across, so Laser SVG and DXF leave ${one ? 'it' : 'them'} out though the view shows ${one ? 'it' : 'them'}. Raise Smallest hole on the Style tab so the view and the files match.`,
      }
    case 'marks': {
      const sites = c.sites ?? 0, delaunay = c.delaunay ?? 0
      const what = sites && delaunay ? 'Sites and Delaunay lines are' : sites ? `${counted(sites, 'site is', 'sites are')}` : 'Delaunay lines are'
      const layers = [sites && 'sites (green, layer SITES)', delaunay && 'Delaunay lines (magenta, layer DELAUNAY)'].filter(Boolean).join(' and ')
      const both = Boolean(sites && delaunay)
      return {
        label: `${what} in the cut files`, detail: 'Score them, or turn them off',
        tip: `Laser SVG and DXF keep ${layers} as marks on ${both ? 'their own layers' : 'a layer of their own'}. Before cutting, set ${both ? 'those layers' : 'that layer'} to score or off in your laser software, or hide ${both ? 'them' : sites ? 'Sites' : 'Delaunay'} in the bar above the sheet.`,
      }
    }
  }
}

// The line above the rows: all clear, or how many things need a look.
export function summaryWords(p: Preflight, s: WordSettings): string {
  const L = (mm: number) => formatSmall(mm, s.units, s.dpi)
  const problems = p.checks.filter(c => !c.note).length
  if (p.style === 'nothing') return 'Nothing to check: the cut files would be empty.'
  if (problems) return `${counted(problems, 'thing', 'things')} to check before cutting.`
  if (p.style !== 'marks' && !p.cells) return 'Nothing to check: no cells fit inside the border.'
  const web = L(Math.max(s.kerf, s.smallestWeb)), feature = L(s.smallestFeature)
  if (p.style === 'holes') return `Ready to cut: every cell has a hole, no web is under ${web}, and no hole under ${feature}.`
  // Short cuts are a note, listed below the summary, so it only claims what holds.
  if (p.style === 'lines') return p.checks.some(c => c.id === 'shortCuts')
    ? `Ready to cut: no piece is narrower than ${web}.`
    : `Ready to cut: no cut is shorter than ${feature}, and no piece narrower than ${web}.`
  return `${s.cellStyle === 'holes' ? 'Holes are' : 'Edges are'} hidden, so the cut files hold only ${s.sheetOutline === false ? 'the marks' : 'the sheet outline and any marks'}.`
}
