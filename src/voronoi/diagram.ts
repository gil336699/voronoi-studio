// The Voronoi diagram itself: one cell per point, clipped to the region. d3-delaunay builds the cells inside
// the region's box; ellipses are then clipped against a 256-sided polygon, and custom shapes with Clipper2.
// A cell is a list of rings: one convex polygon for rectangles and ellipses, and for custom shapes possibly
// several pieces, with holes (negative area) where the shape has holes. With a stretch, everything is built in
// the squeezed work space and stretched back (see stretch.ts).
import { Delaunay } from 'd3-delaunay'
import { centroid, clipConvex, normalize, signedArea, type Polygon, type Segment, type Vec } from './geometry'
import { clampToRegion, contains, regionArea, regionCenter, regionHeight, regionPolygon, regionWidth, type Region } from './region'
import { boxOf, shapeIndex } from './shape'
import { cellsToSheet, pointsToWork, segmentsToSheet, stretchFrame, varyingField, workRegion, type Stretch } from './stretch'
import { boxClip, fieldDiagram, metricAt, metricDistance2, metricGrid, RELAX_BENDS, type FieldDiagram, type FieldSpec } from './field'

export type Cell = Polygon[]
export type Cells = (Cell | null)[]

export const cellArea = (cell: Cell) => cell.reduce((a, ring) => a + signedArea(ring), 0)

// Area-weighted centre of all of a cell's rings (holes subtract).
export function cellCentroid(cell: Cell): Vec {
  if (cell.length === 1) return centroid(cell[0])
  let a = 0, cx = 0, cy = 0
  for (const ring of cell) {
    const ra = signedArea(ring), [rx, ry] = centroid(ring)
    a += ra; cx += rx * ra; cy += ry * ra
  }
  return Math.abs(a) > 1e-12 ? [cx / a, cy / a] : centroid(cell[0])
}

const empty = (region: Region) => region.shape === 'custom' && !region.rings?.length
type Voronoi = ReturnType<Delaunay<Float64Array>['voronoi']>

// ---------- regions split by veins ----------
// Each piece between veins is filled on its own, as the regions between an insect wing's primary veins are,
// so no cell reaches across a vein.

const pieceRegions = new WeakMap<Polygon[][], Region[]>()
export function regionParts(region: Region): Region[] | null {
  if (!region.parts?.length) return null
  let out = pieceRegions.get(region.parts)
  if (!out) {
    out = region.parts.map(rings => { const [x0, y0, x1, y1] = boxOf(rings); return { shape: 'custom', x0, y0, x1, y1, rings } })
    pieceRegions.set(region.parts, out)
  }
  return out
}

// Which piece each point is in. A point on a vein belongs to the nearest piece.
export function partOf(points: Float64Array, parts: Region[]): Int32Array {
  const n = points.length / 2, out = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const x = points[i * 2], y = points[i * 2 + 1]
    let found = parts.findIndex(p => contains(p, x, y))
    if (found < 0) {
      let bd = Infinity
      parts.forEach((p, k) => { const [cx, cy] = clampToRegion(p, x, y); const d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; found = k } })
    }
    out[i] = Math.max(0, found)
  }
  return out
}

// Run a build on each piece's own points, and gather the results by point.
function perPart(points: Float64Array, parts: Region[], each: (pts: Float64Array, part: Region, index: number[]) => void) {
  const owner = partOf(points, parts)
  parts.forEach((part, p) => {
    const index: number[] = []
    for (let i = 0; i < owner.length; i++) if (owner[i] === p) index.push(i)
    if (!index.length) return
    const pts = new Float64Array(index.length * 2)
    index.forEach((i, k) => { pts[k * 2] = points[i * 2]; pts[k * 2 + 1] = points[i * 2 + 1] })
    each(pts, part, index)
  })
}

// ---------- stretch that follows a field ----------

// How a segment is cut to a region, matching the plain diagram: the box, the ellipse, or the shape.
function segmentClip(region: Region): (s: Segment) => Segment[] {
  if (region.shape === 'custom') { const shape = shapeIndex(region.rings ?? []); return s => shape.clipSegment(s) }
  if (region.shape === 'ellipse') return s => { const c = clipToEllipse(s, region); return c ? [c] : [] }
  return boxClip(region)
}
// The last field diagram, since a rebuild asks for cells and then Delaunay lines of the same points.
const lastFields: ({ points: Float64Array; region: Region; field: FieldSpec; result: FieldDiagram } | null)[] = [null, null]
export function fieldMetric(field: FieldSpec, region: Region, n: number) {
  return metricGrid(field, region, Math.sqrt(regionArea(region) / Math.max(1, n)))
}
// relaxing: the cells relaxing works in, with every wall bent (see fieldDiagram); else the drawn ones. Each
// keeps its last result.
function fieldBuild(points: Float64Array, region: Region, field: FieldSpec, relaxing = false): FieldDiagram {
  const lastField = lastFields[relaxing ? 1 : 0]
  if (lastField && lastField.points === points && lastField.region === region && lastField.field === field) return lastField.result
  const n = points.length / 2
  const grid = fieldMetric(field, region, n)
  const parts = regionParts(region)
  let result: FieldDiagram
  if (parts) {
    const cells: Cells = new Array(n).fill(null), internal: Segment[] = [], delaunay: Segment[] = []
    perPart(points, parts, (pts, part, index) => {
      const d = fieldDiagram(pts, part, grid, segmentClip(part), RELAX_BENDS, !relaxing)
      d.cells.forEach((c, k) => { cells[index[k]] = c })
      internal.push(...d.internal); delaunay.push(...d.delaunay)
    })
    result = { cells, internal, delaunay }
  } else result = fieldDiagram(points, region, grid, segmentClip(region), RELAX_BENDS, !relaxing)
  lastFields[relaxing ? 1 : 0] = { points, region, field, result }
  return result
}

// The cells relaxing moves points within. With a field stretch their walls bend to follow it (see field.ts).
export function buildCells(points: Float64Array, region: Region, stretch?: Stretch | null): Cells {
  const field = varyingField(stretch)
  if (field) return points.length ? fieldBuild(points, region, field, true).cells : []
  const f = stretchFrame(stretch)
  if (f) return cellsToSheet(buildCells(pointsToWork(points, f), workRegion(region, f)), f)
  const n = points.length / 2
  if (n === 0) return []
  if (empty(region)) return new Array(n).fill(null)
  const parts = regionParts(region)
  if (parts) {
    const cells: Cells = new Array(n).fill(null)
    perPart(points, parts, (pts, part, index) => buildCells(pts, part).forEach((c, k) => { cells[index[k]] = c }))
    return cells
  }
  return cellsOf(new Delaunay(points).voronoi([region.x0, region.y0, region.x1, region.y1]), n, region)
}

// Cells and each inner edge once, for drawing and cutting. d3 lists every shared edge exactly once, which
// is much faster than matching the edges of neighbouring cells.
export function buildDiagram(points: Float64Array, region: Region, stretch?: Stretch | null): { cells: Cells; internal: Segment[] } {
  const field = varyingField(stretch)
  if (field) { if (!points.length) return { cells: [], internal: [] }; const d = fieldBuild(points, region, field); return { cells: d.cells, internal: d.internal } }
  const f = stretchFrame(stretch)
  if (f) {
    const work = buildDiagram(pointsToWork(points, f), workRegion(region, f))
    return { cells: cellsToSheet(work.cells, f), internal: segmentsToSheet(work.internal, f) }
  }
  const n = points.length / 2
  if (n === 0) return { cells: [], internal: [] }
  if (empty(region)) return { cells: new Array(n).fill(null), internal: [] }
  const parts = regionParts(region)
  if (parts) {
    const cells: Cells = new Array(n).fill(null), internal: Segment[] = []
    perPart(points, parts, (pts, part, index) => {
      const d = buildDiagram(pts, part)
      d.cells.forEach((c, k) => { cells[index[k]] = c })
      internal.push(...d.internal)
    })
    return { cells, internal }
  }
  const voronoi = new Delaunay(points).voronoi([region.x0, region.y0, region.x1, region.y1])
  const raw: Segment[] = []
  let x = 0, y = 0
  voronoi.render({ moveTo(px: number, py: number) { x = px; y = py }, lineTo(px: number, py: number) { raw.push([x, y, px, py]); x = px; y = py } })
  const internal: Segment[] = []
  const shape = region.shape === 'custom' ? shapeIndex(region.rings ?? []) : null
  const keep = (s: Segment | null) => { if (s && Math.hypot(s[2] - s[0], s[3] - s[1]) > 1e-9) internal.push(s) }
  for (const s of raw) {
    if (shape) for (const piece of shape.clipSegment(s)) keep(piece)
    else keep(region.shape === 'ellipse' ? clipToEllipse(s, region) : s)
  }
  return { cells: cellsOf(voronoi, n, region), internal }
}

// The part of a segment inside the region's ellipse, or null.
function clipToEllipse(s: Segment, region: Region): Segment | null {
  const [cx, cy] = regionCenter(region), rx = regionWidth(region) / 2, ry = regionHeight(region) / 2
  const ux = (s[0] - cx) / rx, uy = (s[1] - cy) / ry, dx = (s[2] - s[0]) / rx, dy = (s[3] - s[1]) / ry
  const a = dx * dx + dy * dy, b = 2 * (ux * dx + uy * dy), c = ux * ux + uy * uy - 1
  if (a < 1e-18) return c <= 0 ? s : null
  const disc = b * b - 4 * a * c
  if (disc <= 0) return null
  const root = Math.sqrt(disc)
  const t0 = Math.max(0, (-b - root) / (2 * a)), t1 = Math.min(1, (-b + root) / (2 * a))
  if (t1 <= t0) return null
  const ex = s[2] - s[0], ey = s[3] - s[1]
  return [s[0] + ex * t0, s[1] + ey * t0, s[0] + ex * t1, s[1] + ey * t1]
}

function cellsOf(voronoi: Voronoi, n: number, region: Region): Cells {
  const clip = region.shape === 'ellipse' ? regionPolygon(region) : null
  const shape = region.shape === 'custom' ? shapeIndex(region.rings ?? []) : null
  const cells: Cells = new Array(n)
  for (let i = 0; i < n; i++) {
    const ring = voronoi.cellPolygon(i)
    if (!ring) { cells[i] = null; continue }
    let poly = normalize(ring.slice(0, -1).map(([x, y]) => [x, y]))
    if (clip && poly.length >= 3) poly = normalize(clipConvex(poly, clip))
    if (poly.length < 3) { cells[i] = null; continue }
    cells[i] = shape ? shape.clipCell(poly) : [poly]
  }
  return cells
}

// Index of the point nearest to x, y, which is also the cell that contains it. With a stretch, nearest is
// measured with the stretch's ellipse, so it's still the cell under x, y; leave it out to find the dot itself.
// A field stretch needs the region too, to read the field's ellipse at x, y.
export function nearestPoint(points: Float64Array, x: number, y: number, stretch?: Stretch | null, region?: Region): { index: number; distance: number } {
  const f = stretchFrame(stretch)
  const field = varyingField(stretch)
  const m = field && region ? metricAt(fieldMetric(field, region, points.length / 2), x, y) : null
  let index = -1, best = Infinity
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - x, dy = points[i + 1] - y
    const d = m ? metricDistance2(m, dx, dy) : f ? (f.a * dx + f.b * dy) ** 2 + (f.b * dx + f.c * dy) ** 2 : dx * dx + dy * dy
    if (d < best) { best = d; index = i / 2 }
  }
  return { index, distance: Math.sqrt(best) }
}

// Each edge once, found by matching cell sides. Edges shared by two cells are inside the pattern; edges used
// by one cell lie on the region's boundary. Slower than buildDiagram, so the tests use it as a check.
export function uniqueEdges(cells: Cells): { internal: Segment[]; boundary: Segment[] } {
  const seen = new Map<string, { s: Segment; n: number }>()
  const key = (x: number, y: number) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`
  for (const ring of cells.flatMap(cell => cell ?? [])) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      const ka = key(a[0], a[1]), kb = key(b[0], b[1])
      if (ka === kb) continue
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const hit = seen.get(k)
      if (hit) hit.n++
      else seen.set(k, { s: [a[0], a[1], b[0], b[1]], n: 1 })
    }
  }
  const internal: Segment[] = [], boundary: Segment[] = []
  for (const { s, n } of seen.values()) (n > 1 ? internal : boundary).push(s)
  return { internal, boundary }
}

// Delaunay edges, as the old Voronoi Lab drew them: long stretched edges along the hull and edges whose
// middle falls outside the region are left out, so the border doesn't fill with dark bands. In a custom
// shape, the rest are clipped to it, so no line crosses one of its holes or notches.
export function delaunayEdges(points: Float64Array, region: Region, stretch?: Stretch | null): Segment[] {
  const field = varyingField(stretch)
  if (field) return points.length >= 4 ? fieldBuild(points, region, field).delaunay : []
  const f = stretchFrame(stretch)
  if (f) return segmentsToSheet(delaunayEdges(pointsToWork(points, f), workRegion(region, f)), f)
  const n = points.length / 2
  if (n < 2) return []
  const parts = regionParts(region)
  if (parts) {
    const out: Segment[] = []
    perPart(points, parts, (pts, part) => out.push(...delaunayEdges(pts, part)))
    return out
  }
  const shape = region.shape === 'custom' ? shapeIndex(region.rings ?? []) : null
  const { triangles } = new Delaunay(points)
  const typical = Math.sqrt(regionArea(region) / (Math.PI * n)) * 0.9
  const maxLength = typical * 4
  const drawn = new Set<number>()
  const out: Segment[] = []
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const u = triangles[t + e], v = triangles[t + (e + 1) % 3]
      const lo = Math.min(u, v), hi = Math.max(u, v)
      const k = lo * n + hi
      if (drawn.has(k)) continue
      drawn.add(k)
      const x0 = points[lo * 2], y0 = points[lo * 2 + 1], x1 = points[hi * 2], y1 = points[hi * 2 + 1]
      if (Math.hypot(x1 - x0, y1 - y0) > maxLength) continue
      if (!contains(region, (x0 + x1) / 2, (y0 + y1) / 2)) continue
      if (shape) out.push(...shape.clipSegment([x0, y0, x1, y1]))
      else out.push([x0, y0, x1, y1])
    }
  }
  return out
}
