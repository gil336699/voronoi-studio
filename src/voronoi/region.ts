// The area a pattern fills: a rectangle, or the ellipse that fits inside it. Everything is in millimetres
// with the sheet's top-left corner at 0, 0.
import { ellipsePolygon, type Polygon, type Vec } from './geometry'

export type Shape = 'rect' | 'ellipse'
export type Region = { shape: Shape; x0: number; y0: number; x1: number; y1: number }

const ELLIPSE_SEGMENTS = 256

export function sheetRegion(width: number, height: number, shape: Shape): Region {
  return { shape, x0: 0, y0: 0, x1: width, y1: height }
}

// Shrink a region evenly on all sides. It never shrinks below a sliver at its centre.
export function insetRegion(region: Region, d: number): Region {
  const half = Math.min(region.x1 - region.x0, region.y1 - region.y0) / 2
  const k = Math.min(Math.max(0, d), half * 0.98)
  return { ...region, x0: region.x0 + k, y0: region.y0 + k, x1: region.x1 - k, y1: region.y1 - k }
}

export const regionWidth = (r: Region) => r.x1 - r.x0
export const regionHeight = (r: Region) => r.y1 - r.y0
export const regionCenter = (r: Region): Vec => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]

export function regionArea(r: Region): number {
  const w = regionWidth(r), h = regionHeight(r)
  return r.shape === 'rect' ? w * h : Math.PI * (w / 2) * (h / 2)
}

// Ramanujan's approximation for the ellipse, which is within 0.01 % for any sheet shape here.
export function regionPerimeter(r: Region): number {
  const w = regionWidth(r), h = regionHeight(r)
  if (r.shape === 'rect') return 2 * (w + h)
  const a = w / 2, b = h / 2
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
}

export function contains(r: Region, x: number, y: number): boolean {
  if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return false
  if (r.shape === 'rect') return true
  const [cx, cy] = regionCenter(r)
  const dx = (x - cx) / (regionWidth(r) / 2), dy = (y - cy) / (regionHeight(r) / 2)
  return dx * dx + dy * dy <= 1
}

// The nearest point inside the region, pulled in very slightly so it is not exactly on the edge.
export function clampToRegion(r: Region, x: number, y: number): Vec {
  const inset = 1e-6 * Math.max(regionWidth(r), regionHeight(r))
  if (r.shape === 'rect') return [Math.min(r.x1 - inset, Math.max(r.x0 + inset, x)), Math.min(r.y1 - inset, Math.max(r.y0 + inset, y))]
  if (contains(r, x, y)) return [x, y]
  const [cx, cy] = regionCenter(r)
  const rx = regionWidth(r) / 2, ry = regionHeight(r) / 2
  const dx = (x - cx) / rx, dy = (y - cy) / ry
  const k = (1 - 1e-6) / Math.hypot(dx, dy)
  return [cx + dx * k * rx, cy + dy * k * ry]
}

// The region as a convex polygon, for clipping cells.
export function regionPolygon(r: Region): Polygon {
  if (r.shape === 'rect') return [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]
  const [cx, cy] = regionCenter(r)
  return ellipsePolygon(cx, cy, regionWidth(r) / 2, regionHeight(r) / 2, ELLIPSE_SEGMENTS)
}

// Map a point from one region to another, for keeping points when the sheet changes. Boxes scale
// proportionally; between a rectangle and an ellipse, the square-to-disc "elliptical grid" mapping
// spreads points smoothly instead of piling them up on the rim.
export function mapBetween(from: Region, to: Region, x: number, y: number): Vec {
  const [fx, fy] = regionCenter(from), [tx, ty] = regionCenter(to)
  let u = (x - fx) / Math.max(1e-9, regionWidth(from) / 2), v = (y - fy) / Math.max(1e-9, regionHeight(from) / 2)
  if (from.shape === 'rect' && to.shape === 'ellipse') {
    u = Math.max(-1, Math.min(1, u)); v = Math.max(-1, Math.min(1, v))
    ;[u, v] = [u * Math.sqrt(1 - (v * v) / 2), v * Math.sqrt(1 - (u * u) / 2)]
  } else if (from.shape === 'ellipse' && to.shape === 'rect') {
    const k = Math.hypot(u, v)
    if (k > 1) { u /= k; v /= k }
    const r2 = 2 * Math.SQRT2
    const a = 2 + u * u - v * v, b = 2 - u * u + v * v
    ;[u, v] = [
      (Math.sqrt(Math.max(0, a + r2 * u)) - Math.sqrt(Math.max(0, a - r2 * u))) / 2,
      (Math.sqrt(Math.max(0, b + r2 * v)) - Math.sqrt(Math.max(0, b - r2 * v))) / 2,
    ]
  }
  return clampToRegion(to, tx + u * (regionWidth(to) / 2), ty + v * (regionHeight(to) / 2))
}
