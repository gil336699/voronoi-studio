// Cut-out holes: each cell shrunk by half the web width, with its corners rounded. Convex cells are shrunk by
// (half web + radius) and grown back by the radius with arcs, which gives exact round corners. Outlines are
// stored like a DXF polyline: points plus a "bulge" per segment (0 = straight, tan(angle/4) = arc), so SVG,
// canvas and DXF all draw the same true arcs.
// Cells clipped by a custom shape can be concave or in pieces. Those go through Clipper2's offsets instead,
// with corners rounded to within 5 µm by short straight segments.
import type { Cell } from './diagram'
import { area, convexHull, insetConvex, isConvex, minWidth, normalize, perimeter, signedArea, type Polygon, type Vec } from './geometry'
import { boxOf, difference, groupRings, offset } from './shape'

export type Outline = { points: Vec[]; bulges: number[] }
export type Hole = { cell: number; outline: Outline; width: number; area: number; length: number }
export type HoleSettings = { web: number; radius: number; minHole: number }

// The largest inset between lo and hi that still leaves a shape, found by halving the range.
function maxInset(poly: Polygon, lo: number, hi: number): number {
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (insetConvex(poly, mid).length) lo = mid
    else hi = mid
  }
  return lo
}

export function makeHole(cell: Polygon, index: number, settings: HoleSettings): Hole | null {
  const poly = normalize(cell)
  if (poly.length < 3) return null
  const half = Math.max(0, settings.web / 2)
  // A hole can be at most the cell's width less the web, so cells that can't reach the smallest hole stop here.
  const cellWidth = minWidth(poly)
  if (cellWidth - 2 * half < Math.max(settings.minHole, 1e-9)) return null
  let radius = Math.max(0, settings.radius)
  // No shape survives an inset of half its width or more, so skip straight to fitting the radius.
  let core = half + radius < cellWidth / 2 ? insetConvex(poly, half + radius) : []
  if (!core.length) {
    // The corners are rounder than the hole is wide: use the largest radius that fits.
    if (!insetConvex(poly, half).length) return null
    const limit = maxInset(poly, half, Math.min(half + radius, cellWidth / 2))
    radius = (limit - half) * 0.98
    core = insetConvex(poly, half + radius)
    if (!core.length) return null
  }
  const width = minWidth(core) + 2 * radius
  if (width < settings.minHole) return null
  return {
    cell: index,
    outline: roundOutline(core, radius),
    width,
    // Steiner's formula: growing a convex shape by r adds perimeter·r + πr² of area and 2πr of length.
    area: area(core) + perimeter(core) * radius + Math.PI * radius * radius,
    length: perimeter(core) + 2 * Math.PI * radius,
  }
}

// Grow a convex polygon (positive area) outward by r, turning each corner into an arc.
export function roundOutline(core: Polygon, r: number): Outline {
  if (r <= 1e-9) return { points: core.map(([x, y]) => [x, y]), bulges: core.map(() => 0) }
  const n = core.length
  const normals: Vec[] = []
  for (let i = 0; i < n; i++) {
    const a = core[i], b = core[(i + 1) % n]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    normals.push([(b[1] - a[1]) / len, -(b[0] - a[0]) / len]) // right normal points out for positive area
  }
  const points: Vec[] = [], bulges: number[] = []
  for (let i = 0; i < n; i++) {
    const v = core[i]
    const before = normals[(i - 1 + n) % n], after = normals[i]
    const turn = Math.atan2(before[0] * after[1] - before[1] * after[0], before[0] * after[0] + before[1] * after[1])
    points.push([v[0] + before[0] * r, v[1] + before[1] * r])
    bulges.push(Math.tan(turn / 4))
    points.push([v[0] + after[0] * r, v[1] + after[1] * r])
    bulges.push(0)
  }
  return { points, bulges }
}

export type Arc = { cx: number; cy: number; r: number; start: number; end: number; positive: boolean }

// The circle behind a bulged segment from a to b. "positive" means the angle increases from start to end.
export function arcFromBulge(a: Vec, b: Vec, bulge: number): Arc {
  const theta = 4 * Math.atan(bulge)
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const chord = Math.hypot(dx, dy)
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2))
  // The centre sits on the chord's perpendicular, to the left for positive bulges.
  const h = r * Math.cos(theta / 2) * Math.sign(theta)
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
  const cx = mx - (dy / chord) * h, cy = my + (dx / chord) * h
  return { cx, cy, r, start: Math.atan2(a[1] - cy, a[0] - cx), end: Math.atan2(b[1] - cy, b[0] - cx), positive: theta > 0 }
}

// Total length of an outline, counting arcs as arcs.
export function outlineLength(outline: Outline): number {
  const { points, bulges } = outline
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1])
    const theta = 4 * Math.atan(Math.abs(bulges[i]))
    sum += theta > 1e-12 ? (chord / (2 * Math.sin(theta / 2))) * theta : chord
  }
  return sum
}

// All holes for one cell: one for a convex cell, possibly several for a cell a custom shape cut into pieces.
export function makeHoles(cell: Cell, index: number, settings: HoleSettings): Hole[] {
  if (cell.length === 1 && isConvex(cell[0])) {
    const hole = makeHole(cell[0], index, settings)
    return hole ? [hole] : []
  }
  return solidPieces(cell).flatMap(piece => roundHoles(piece, index, settings))
}

// The cell's pieces with no holes in them. Where a cell wraps right round a hole in the shape, a hairline slot
// cuts through to that hole; once the web is taken off both sides, the slot becomes a bridge of web, so the
// frame around the hole stays joined to the sheet instead of falling out with the cut.
function solidPieces(cell: Cell): Polygon[] {
  if (cell.every(ring => signedArea(ring) > 0)) return cell
  const pieces: Polygon[] = []
  for (const { outer, holes } of groupRings(cell)) {
    if (!holes.length) { pieces.push(outer); continue }
    const top = boxOf([outer])[1] - 1
    const slots = holes.map((hole): Polygon => {
      const [x0, y0, x1, y1] = boxOf([hole])
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = 1e-3
      return [[cx - w, top], [cx + w, top], [cx + w, cy], [cx - w, cy]]
    })
    pieces.push(...difference([outer, ...holes], slots).filter(ring => signedArea(ring) > 0))
  }
  return pieces
}

function roundHoles(piece: Polygon, index: number, { web, radius, minHole }: HoleSettings): Hole[] {
  const half = Math.max(0, web / 2)
  let r = Math.max(0, radius)
  let core = offset([piece], -(half + r), 'miter')
  if (!core.length) {
    // The corners are rounder than the piece is wide: use the largest radius that fits.
    if (!offset([piece], -half, 'miter').length) return []
    let lo = 0, hi = r
    for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (offset([piece], -(half + mid), 'miter').length) lo = mid; else hi = mid }
    r = lo * 0.98
    core = offset([piece], -(half + r), 'miter')
    if (!core.length) return []
  }
  const grown = r > 1e-9 ? offset(core, r, 'round') : core
  const out: Hole[] = []
  for (const ring of grown) {
    if (signedArea(ring) <= 0) continue
    if (minHole > 0 && !offset([ring], -minHole / 2 + 1e-6, 'miter').length) continue
    out.push({
      cell: index,
      outline: { points: ring, bulges: ring.map(() => 0) },
      width: minWidth(convexHull(ring)), // across its convex outline: a slight overestimate for concave holes
      area: signedArea(ring),
      length: perimeter(ring),
    })
  }
  return out
}
