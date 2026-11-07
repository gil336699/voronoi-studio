// The Voronoi diagram itself: one convex cell per point, clipped to the region. d3-delaunay builds the
// cells inside the region's box; ellipses are then clipped against a 256-sided polygon.
import { Delaunay } from 'd3-delaunay'
import { clipConvex, normalize, type Polygon, type Segment } from './geometry'
import { contains, regionArea, regionCenter, regionHeight, regionPolygon, regionWidth, type Region } from './region'

export type Cells = (Polygon | null)[]
type Voronoi = ReturnType<Delaunay<Float64Array>['voronoi']>

export function buildCells(points: Float64Array, region: Region): Cells {
  const n = points.length / 2
  if (n === 0) return []
  return cellsOf(new Delaunay(points).voronoi([region.x0, region.y0, region.x1, region.y1]), n, region)
}

// Cells and each inner edge once, for drawing and cutting. d3 lists every shared edge exactly once, which
// is much faster than matching the edges of neighbouring cells.
export function buildDiagram(points: Float64Array, region: Region): { cells: Cells; internal: Segment[] } {
  const n = points.length / 2
  if (n === 0) return { cells: [], internal: [] }
  const voronoi = new Delaunay(points).voronoi([region.x0, region.y0, region.x1, region.y1])
  const raw: Segment[] = []
  let x = 0, y = 0
  voronoi.render({ moveTo(px: number, py: number) { x = px; y = py }, lineTo(px: number, py: number) { raw.push([x, y, px, py]); x = px; y = py } })
  const internal: Segment[] = []
  for (const s of raw) {
    const clipped = region.shape === 'ellipse' ? clipToEllipse(s, region) : s
    if (clipped && Math.hypot(clipped[2] - clipped[0], clipped[3] - clipped[1]) > 1e-9) internal.push(clipped)
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
  const cells: Cells = new Array(n)
  for (let i = 0; i < n; i++) {
    const ring = voronoi.cellPolygon(i)
    if (!ring) { cells[i] = null; continue }
    let poly = normalize(ring.slice(0, -1).map(([x, y]) => [x, y]))
    if (clip && poly.length >= 3) poly = normalize(clipConvex(poly, clip))
    cells[i] = poly.length >= 3 ? poly : null
  }
  return cells
}

// Index of the point nearest to x, y, which is also the cell that contains it.
export function nearestPoint(points: Float64Array, x: number, y: number): { index: number; distance: number } {
  let index = -1, best = Infinity
  for (let i = 0; i < points.length; i += 2) {
    const d = (points[i] - x) ** 2 + (points[i + 1] - y) ** 2
    if (d < best) { best = d; index = i / 2 }
  }
  return { index, distance: Math.sqrt(best) }
}

// Each edge once, found by matching cell sides. Edges shared by two cells are inside the pattern; edges used
// by one cell lie on the region's boundary. Slower than buildDiagram, so the tests use it as a check.
export function uniqueEdges(cells: Cells): { internal: Segment[]; boundary: Segment[] } {
  const seen = new Map<string, { s: Segment; n: number }>()
  const key = (x: number, y: number) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`
  for (const cell of cells) {
    if (!cell) continue
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i], b = cell[(i + 1) % cell.length]
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
// middle falls outside the region are left out, so the border doesn't fill with dark bands.
export function delaunayEdges(points: Float64Array, region: Region): Segment[] {
  const n = points.length / 2
  if (n < 2) return []
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
      out.push([x0, y0, x1, y1])
    }
  }
  return out
}
