// Cut-out holes: each cell shrunk by half the web width, with its corners rounded. Cells are convex, so
// shrinking by (half web + radius) and then growing back by the radius with arcs gives exact round corners.
// Outlines are stored like a DXF polyline: points plus a "bulge" per segment (0 = straight,
// tan(angle/4) = arc), so SVG, canvas and DXF all draw the same true arcs.
import { area, insetConvex, minWidth, normalize, perimeter, type Polygon, type Vec } from './geometry'

export type Outline = { points: Vec[]; bulges: number[] }
export type Hole = { cell: number; outline: Outline; width: number; area: number; length: number }
export type HoleSettings = { web: number; radius: number; minHole: number }

// The largest inset that still leaves a shape, found by halving the search range.
function maxInset(poly: Polygon, upTo: number): number {
  let lo = 0, hi = upTo
  for (let i = 0; i < 16; i++) {
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
  if (minWidth(poly) - 2 * half < Math.max(settings.minHole, 1e-9)) return null
  let radius = Math.max(0, settings.radius)
  let core = insetConvex(poly, half + radius)
  if (!core.length) {
    // The corners are rounder than the hole is wide: use the largest radius that fits.
    const limit = maxInset(poly, half + radius)
    if (limit <= half + 1e-6) return null
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
