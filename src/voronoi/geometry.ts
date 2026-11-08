// Small 2D helpers for convex polygons. Voronoi cells are convex, so clipping, insetting and measuring
// can all use simple half-plane methods that never produce self-intersections.
// Coordinates are millimetres with y pointing down, as on screen and in SVG.

export type Vec = [number, number]
export type Polygon = Vec[] // open ring: the last point is not repeated
export type Segment = [number, number, number, number] // x0, y0, x1, y1

const EPS = 1e-9

export function signedArea(poly: Polygon): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]
  return a / 2
}

export function area(poly: Polygon): number { return Math.abs(signedArea(poly)) }

// Area-weighted centre of a polygon. Falls back to the vertex average for degenerate shapes.
export function centroid(poly: Polygon): Vec {
  let a = 0, cx = 0, cy = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x0, y0] = poly[j], [x1, y1] = poly[i]
    const f = x0 * y1 - x1 * y0
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f
  }
  if (Math.abs(a) < EPS) {
    let sx = 0, sy = 0
    for (const [x, y] of poly) { sx += x; sy += y }
    return [sx / Math.max(1, poly.length), sy / Math.max(1, poly.length)]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

export function perimeter(poly: Polygon): number {
  let p = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) p += Math.hypot(poly[i][0] - poly[j][0], poly[i][1] - poly[j][1])
  return p
}

// Positive signed area, so "left of each edge" is inside. Also drops repeated points.
export function normalize(poly: Polygon): Polygon {
  const out: Polygon = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > EPS) out.push([p[0], p[1]])
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= EPS) out.pop()
  return signedArea(out) < 0 ? out.reverse() : out
}

// Keep the part of the polygon where nx·x + ny·y >= c (Sutherland–Hodgman against one line).
export function clipHalfPlane(poly: Polygon, nx: number, ny: number, c: number): Polygon {
  const out: Polygon = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c
    if (da >= 0) out.push(a)
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

// Intersection of a polygon with a convex clip polygon (both normalized).
export function clipConvex(poly: Polygon, clip: Polygon): Polygon {
  let out = poly
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length]
    const nx = -(b[1] - a[1]), ny = b[0] - a[0] // left normal points inside for positive area
    out = clipHalfPlane(out, nx, ny, nx * a[0] + ny * a[1])
  }
  return out
}

// Move every edge of a convex polygon inward by d. Returns [] when nothing is left.
export function insetConvex(poly: Polygon, d: number): Polygon {
  const p = normalize(poly)
  if (p.length < 3) return []
  if (d <= 0) return p
  let out = p
  for (let i = 0; i < p.length && out.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < EPS) continue
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len
    out = clipHalfPlane(out, nx, ny, nx * a[0] + ny * a[1] + d)
  }
  out = normalize(out)
  return out.length >= 3 && area(out) > EPS ? out : []
}

// The narrowest width of a convex polygon: the smallest gap between two parallel lines that hold it.
export function minWidth(poly: Polygon): number {
  const p = normalize(poly)
  if (p.length < 3) return 0
  let best = Infinity
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < EPS) continue
    let far = 0
    for (const q of p) far = Math.max(far, Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / len)
    best = Math.min(best, far)
  }
  return Number.isFinite(best) ? best : 0
}

// A polygon approximating an ellipse, starting at the right and going round with positive area.
export function ellipsePolygon(cx: number, cy: number, rx: number, ry: number, segments = 256): Polygon {
  const out: Polygon = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
  }
  return out
}

export function segmentLength(s: Segment): number { return Math.hypot(s[2] - s[0], s[3] - s[1]) }

// Whether a ring turns the same way at every corner (straight runs allowed).
export function isConvex(poly: Polygon): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cross) < 1e-12) continue
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

// The convex hull (Andrew's monotone chain), with positive area.
export function convexHull(points: Vec[]): Polygon {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Vec[] = [], upper: Vec[] = []
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q) }
  return normalize(lower.slice(0, -1).concat(upper.slice(0, -1)))
}
