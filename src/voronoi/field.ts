// Stretch that follows a field: each place has its own stretch ellipse, from a vector field's direction there
// (rays or rings round a centre, a saddle, waves, swirling cells, noise, the veins, or a picture's contours).
// The cells are straight-edged and tile the sheet exactly:
// - Points are joined into Delaunay triangles, and edges are flipped until each is Delaunay in the average
//   ellipse of its four points (Lawson flips, with that ellipse as the metric).
// - Each cell's corners are its triangles' centres, each measured in that triangle's own ellipse, and kept
//   inside its triangle, so a cell's corners stay in order round its point and it can't cross itself.
// - For relaxing, each wall also bends twice, at points where its two cells' points are equally far in the
//   ellipse there (RELAX_BENDS): in a curving field a straight wall hands part of each cell to its outer
//   neighbour, and relaxing would crowd cells toward the curve's centre (found against exact Lloyd on pixels,
//   local/qa/field-reference.ts). Drawings and cut files keep only the bends that move a wall noticeably.
// - Relaxing moves each point to the place that minimises ∫ (x − p)ᵀ M(x) (x − p) over its cell, which is
//   the right Lloyd step when the ellipse varies; the plain centre drifts points into vortex eyes.
// With one ellipse everywhere this is the exact anisotropic Voronoi diagram the plain Stretch uses
// (stretch.ts), so One direction keeps that exact path. The field is read with a structure tensor (directions
// and their reverses count alike) over about a cell spacing, and the stretch fades where nearby directions
// disagree, and near a vortex's eye or a saddle, so cells there stay round instead of piling up (see NEAR).
import { Delaunay } from 'd3-delaunay'
import type { Cell, Cells } from './diagram'
import { normalize, signedArea, type Polygon, type Segment, type Vec } from './geometry'
import type { PictureTones } from './picture'
import { contains, regionArea, regionPolygon, type Region } from './region'
import { shapeIndex } from './shape'

export type FieldKind = 'fixed' | 'centre' | 'saddle' | 'wave' | 'cells' | 'noise' | 'curl' | 'veins' | 'picture'
// amount: how many times longer than wide (1 is off). angle: degrees, the overall direction (One direction, Saddle,
// Wave). centre: 0–1 of the sheet (Around a centre, Saddle). turn: degrees, 0 rays out of the centre to 90 rings round it. waves: full
// waves across the sheet. swing: degrees the waves turn. cells: swirling cells across. scale: noise features
// across. seed: for noise. veins / tones: the pattern's veins and the density picture, for those two kinds.
export type FieldSpec = {
  kind: FieldKind; amount: number; angle: number
  centre: [number, number]; turn: number; waves: number; swing: number; cells: number; scale: number; seed: number
  sheet: [number, number]
  veins?: Polygon[] | null; tones?: PictureTones | null
}

export type Sym = [number, number, number] // [[a, b], [b, c]]
// kept: the share of the region where cells get at least half the stretch (elsewhere the field turns too fast).
type MetricGrid = { x0: number; y0: number; step: number; nx: number; ny: number; a: Float32Array; b: Float32Array; c: Float32Array; kept: number }

// ---------- the fields ----------

// Smooth value noise, seeded, from an integer hash: the same seed and position always give the same value.
function hash(i: number, j: number, seed: number): number {
  let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function noise(x: number, y: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j
  const s = (t: number) => t * t * (3 - 2 * t), sa = s(a), sb = s(b)
  return (1 - sb) * ((1 - sa) * hash(i, j, seed) + sa * hash(i + 1, j, seed)) + sb * ((1 - sa) * hash(i, j + 1, seed) + sa * hash(i + 1, j + 1, seed))
}

const rad = (deg: number) => (deg * Math.PI) / 180
const rotate = ([x, y]: Vec, t: number): Vec => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]

// The raw field at a sheet point, in screen coordinates (y down), with its strength. Analytic fields are written
// in maths coordinates (y up, both −1 to 1 across the sheet), as they're usually drawn.
function rawField(f: FieldSpec, x: number, y: number): Vec {
  const [w, h] = f.sheet, half = Math.max(w, h) / 2
  const moves = f.kind === 'centre' || f.kind === 'saddle'
  const cx = moves ? f.centre[0] * w : w / 2, cy = moves ? f.centre[1] * h : h / 2
  const X = (x - cx) / half, Y = -(y - cy) / half
  let v: Vec
  switch (f.kind) {
    case 'centre': v = rotate([X, Y], rad(f.turn)); break
    case 'saddle': { const [p, q] = rotate([X, Y], -rad(f.angle)); v = rotate([p, -q], rad(f.angle)); break }
    case 'wave': {
      const u = rotate([1, 0], rad(f.angle)), along = X * u[0] + Y * u[1]
      v = rotate(u, rad(f.swing) * Math.sin(Math.PI * f.waves * along)); break
    }
    case 'cells': { const k = (Math.PI * f.cells) / 2; v = [Math.sin(k * X) * Math.cos(k * Y), -Math.cos(k * X) * Math.sin(k * Y)]; break }
    // Noise: two smooth noises as the field's two parts, so no direction is favoured, with `scale` noise cells
    // along the sheet's longer side. Swirling noise: along the contours of one noise, so its streamlines wrap
    // round its hills and hollows; half as many noise cells, so its eddies are about as big as Noise's turns.
    case 'noise': { const p = ((X + 1) * f.scale) / 2, q = ((Y + 1) * f.scale) / 2; v = [noise(p, q, f.seed) - 0.5, noise(p, q, f.seed + 7919) - 0.5]; break }
    case 'curl': {
      const e = 0.01, n = (p: number, q: number) => noise(((p + 1) * f.scale) / 4, ((q + 1) * f.scale) / 4, f.seed)
      v = [(n(X, Y + e) - n(X, Y - e)) / (2 * e), -(n(X + e, Y) - n(X - e, Y)) / (2 * e)]; break
    }
    default: v = rotate([1, 0], rad(f.angle))
  }
  return [v[0], -v[1]]
}

// Along the veins: the direction of the nearest edge of the veins' outline, through a grid of its edges.
function veinDirections(veins: Polygon[], nodes: Vec[], step: number): Vec[] {
  const segs: [Vec, Vec][] = []
  for (const ring of veins) for (let i = 0; i < ring.length; i++) segs.push([ring[i], ring[(i + 1) % ring.length]])
  if (!segs.length) return nodes.map(() => [0, 0])
  const cell = Math.max(step * 4, 1e-6), grid = new Map<string, number[]>()
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
  segs.forEach(([a, b], i) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cell))
    const seen = new Set<string>()
    for (let k = 0; k <= n; k++) { const t = k / n, kk = key(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); if (!seen.has(kk)) { seen.add(kk); const l = grid.get(kk) ?? []; l.push(i); grid.set(kk, l) } }
  })
  return nodes.map(([x, y]) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell)
    for (let r = 0; r < 64; r++) {
      let best = -1, bd = Infinity
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const [a, b] = segs[i], ex = b[0] - a[0], ey = b[1] - a[1], L = ex * ex + ey * ey || 1
          const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / L))
          const d = Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey)
          if (d < bd) { bd = d; best = i }
        }
      }
      if (best >= 0 && bd <= r * cell) { const [a, b] = segs[best]; return [b[0] - a[0], b[1] - a[1]] }
    }
    return [0, 0]
  })
}

// Along the picture: the contour direction, across its gradient (dark meets light), strength from the gradient.
function pictureDirection(t: PictureTones, x: number, y: number): Vec {
  const tone = (px: number, py: number) => {
    const i = Math.max(0, Math.min(t.cols - 1, Math.floor((px - t.ox) / t.k))), j = Math.max(0, Math.min(t.rows - 1, Math.floor((py - t.oy) / t.k)))
    return t.tone[j * t.cols + i]
  }
  const e = t.k
  const gx = (tone(x + e, y) - tone(x - e, y)) / (2 * e), gy = (tone(x, y + e) - tone(x, y - e)) / (2 * e)
  return [-gy, gx] // along the contour
}

// ---------- the metric grid ----------

// How the field is read, in cell spacings. NEAR: the direction cells follow, short so waves and swirls a few
// cells across still show. WIDE: the eye gate, which fades the stretch where directions over this wider patch
// go most of the way round (coherence under GATE[0], full stretch above GATE[1]), as at a vortex's eye or a
// saddle. Without it points creep into eyes over long relaxing; measured in local/qa/field-reach2.ts.
const NEAR = 1, WIDE = 2.5, GATE = [0.25, 0.75] as const
// Bends in each wall for relaxing. One left points 30 % denser near a vortex's eye than 55–85 mm out after
// 2,000 steps (1,200 cells at 3×), two 12 %, three 6 %, for 11, 15 and 18 ms a step; straight walls 3.6 times.
export const RELAX_BENDS = 2
const metricCache: { key: string; veins: unknown; tones: unknown; rings: unknown; grid: MetricGrid }[] = []
export function metricGrid(f: FieldSpec, region: Region, spacing: number): MetricGrid {
  const N = 128
  const w = Math.max(1e-9, region.x1 - region.x0), h = Math.max(1e-9, region.y1 - region.y0)
  const step = Math.max(w, h) / (N - 1)
  // The readings' reach in grid steps. Keyed on them rather than the spacing, so erasing or adding a few points,
  // and seeding and relaxing the same count, share one grid.
  const near = Math.max(1, Math.round((NEAR * spacing) / step)), wide = Math.max(1, Math.round((WIDE * spacing) / step))
  const key = JSON.stringify([f.kind, f.amount, f.angle, f.centre, f.turn, f.waves, f.swing, f.cells, f.scale, f.seed, f.sheet,
    region.x0, region.y0, region.x1, region.y1, near, wide])
  const hit = metricCache.find(m => m.key === key && m.veins === f.veins && m.tones === f.tones && m.rings === region.rings)
  if (hit) return hit.grid
  const nx = Math.ceil(w / step) + 3, ny = Math.ceil(h / step) + 3
  const x0 = region.x0 - step, y0 = region.y0 - step
  const nodes: Vec[] = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nodes.push([x0 + i * step, y0 + j * step])
  const raw: Vec[] = f.kind === 'veins' ? veinDirections(f.veins ?? [], nodes, step)
    : f.kind === 'picture' ? nodes.map(([x, y]) => (f.tones ? pictureDirection(f.tones, x, y) : [0, 0]))
      : nodes.map(([x, y]) => rawField(f, x, y))
  // Structure tensor (unit directions; the picture's weighted by gradient strength) and strength, each box
  // blurred twice: over NEAR cell spacings for the direction cells follow, and over WIDE for the eye gate.
  const T11 = new Float32Array(nodes.length), T12 = new Float32Array(nodes.length), T22 = new Float32Array(nodes.length), mag = new Float32Array(nodes.length)
  raw.forEach(([vx, vy], i) => {
    const len = Math.hypot(vx, vy)
    mag[i] = len
    if (len < 1e-12) return
    const ux = vx / len, uy = vy / len, wgt = f.kind === 'picture' ? len * len : 1
    T11[i] = ux * ux * wgt; T12[i] = ux * uy * wgt; T22[i] = uy * uy * wgt
  })
  const W11 = Float32Array.from(T11), W12 = Float32Array.from(T12), W22 = Float32Array.from(T22)
  for (const arr of [T11, T12, T22, mag]) for (let pass = 0; pass < 2; pass++) boxBlur(arr, nx, ny, near)
  for (const arr of [W11, W12, W22]) for (let pass = 0; pass < 2; pass++) boxBlur(arr, nx, ny, wide)
  const sorted = Float32Array.from(mag).sort()
  const typical = Math.max(1e-12, sorted[Math.floor(sorted.length * (f.kind === 'picture' ? 0.9 : 0.5))])
  const a = new Float32Array(nodes.length), b = new Float32Array(nodes.length), c = new Float32Array(nodes.length)
  let inside = 0, strong = 0
  for (let i = 0; i < nodes.length; i++) {
    const j11 = T11[i], j12 = T12[i], j22 = T22[i], tr = j11 + j22
    const coherence = tr > 1e-12 ? Math.hypot(j11 - j22, 2 * j12) / tr : 0
    const ang = Math.atan2(2 * j12, j11 - j22) / 2
    const wt = W11[i] + W22[i], around = wt > 1e-12 ? Math.hypot(W11[i] - W22[i], 2 * W12[i]) / wt : 0
    const gate = Math.max(0, Math.min(1, (around - GATE[0]) / (GATE[1] - GATE[0])))
    const s = 1 + (f.amount - 1) * Math.min(1, mag[i] / (0.35 * typical)) * coherence * coherence * gate * gate * (3 - 2 * gate)
    const m = metricOf(Math.cos(ang), Math.sin(ang), s)
    a[i] = m[0]; b[i] = m[1]; c[i] = m[2]
    if (contains(region, nodes[i][0], nodes[i][1])) { inside++; if (s >= 1 + (f.amount - 1) / 2) strong++ }
  }
  const grid = { x0, y0, step, nx, ny, a, b, c, kept: inside ? strong / inside : 0 }
  metricCache.unshift({ key, veins: f.veins, tones: f.tones, rings: region.rings, grid })
  if (metricCache.length > 4) metricCache.pop()
  return grid
}

function boxBlur(arr: Float32Array, nx: number, ny: number, r: number) {
  const tmp = new Float32Array(Math.max(nx, ny))
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) tmp[i] = arr[j * nx + i]
    let sum = 0, n = 0
    for (let i = -r; i <= r; i++) if (i >= 0 && i < nx) { sum += tmp[i]; n++ }
    for (let i = 0; i < nx; i++) {
      arr[j * nx + i] = sum / n
      const add = i + r + 1, drop = i - r
      if (add < nx) { sum += tmp[add]; n++ }
      if (drop >= 0) { sum -= tmp[drop]; n-- }
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) tmp[j] = arr[j * nx + i]
    let sum = 0, n = 0
    for (let j = -r; j <= r; j++) if (j >= 0 && j < ny) { sum += tmp[j]; n++ }
    for (let j = 0; j < ny; j++) {
      arr[j * nx + i] = sum / n
      const add = j + r + 1, drop = j - r
      if (add < ny) { sum += tmp[add]; n++ }
      if (drop >= 0) { sum -= tmp[drop]; n-- }
    }
  }
}

// Squeeze by 1/√s along (ux, uy) and stretch by √s across, as in stretch.ts: M = T·T, determinant 1.
function metricOf(ux: number, uy: number, s: number): Sym {
  const K = Math.sqrt(s), k = 1 / K
  const a = K + (k - K) * ux * ux, b = (k - K) * ux * uy, c = K + (k - K) * uy * uy
  return [a * a + b * b, a * b + b * c, b * b + c * c]
}

export function metricAt(g: MetricGrid, x: number, y: number): Sym {
  const u = (x - g.x0) / g.step, v = (y - g.y0) / g.step
  if (u < 0 || v < 0 || u > g.nx - 1 || v > g.ny - 1) return [1, 0, 1]
  const i = Math.min(g.nx - 2, Math.floor(u)), j = Math.min(g.ny - 2, Math.floor(v)), s = u - i, t = v - j
  const at = (arr: Float32Array) => (1 - t) * ((1 - s) * arr[j * g.nx + i] + s * arr[j * g.nx + i + 1]) + t * ((1 - s) * arr[(j + 1) * g.nx + i] + s * arr[(j + 1) * g.nx + i + 1])
  return [at(g.a), at(g.b), at(g.c)]
}

// The square root of a symmetric positive 2 × 2 matrix, and its inverse.
function sqrtm([a, b, c]: Sym): { S: Sym; Si: Sym } {
  const d = Math.sqrt(Math.max(1e-18, a * c - b * b)), t = Math.sqrt(Math.max(1e-18, a + c + 2 * d))
  const S: Sym = [(a + d) / t, b / t, (c + d) / t]
  const det = S[0] * S[2] - S[1] * S[1]
  return { S, Si: [S[2] / det, -S[1] / det, S[0] / det] }
}
const mul = ([a, b, c]: Sym, x: number, y: number): Vec => [a * x + b * y, b * x + c * y]

// The metric distance squared between two points, in the ellipse at the first.
export function metricDistance2(m: Sym, dx: number, dy: number): number {
  return m[0] * dx * dx + 2 * m[1] * dx * dy + m[2] * dy * dy
}
// A step of metric length `len` at `angle` from a point, as a sheet offset (the ellipse's own unit circle).
export function metricStep(m: Sym, angle: number, len: number): Vec {
  const { Si } = sqrtm(m)
  return mul(Si, Math.cos(angle) * len, Math.sin(angle) * len)
}

// ---------- the cells ----------

function inCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number) {
  const dx = ax - px, dy = ay - py, ex = bx - px, ey = by - py, fx = cx - px, fy = cy - py
  const ap = dx * dx + dy * dy, bp = ex * ex + ey * ey, cp = fx * fx + fy * fy
  return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0
}
function circumcentre(a: Vec, b: Vec, c: Vec): Vec {
  const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1]
  const d = 2 * (bx * cy - by * cx)
  if (Math.abs(d) < 1e-14) return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]
  const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
  return [a[0] + (cy * b2 - by * c2) / d, a[1] + (bx * c2 - cx * b2) / d]
}
// Keep a point inside triangle abd: barycentric weights of at least 2 %.
function insideTriangle(p: Vec, a: Vec, b: Vec, d: Vec): Vec {
  const det = (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1])
  if (Math.abs(det) < 1e-14) return [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3]
  let l1 = ((b[1] - d[1]) * (p[0] - d[0]) + (d[0] - b[0]) * (p[1] - d[1])) / det
  let l2 = ((d[1] - a[1]) * (p[0] - d[0]) + (a[0] - d[0]) * (p[1] - d[1])) / det
  let l3 = 1 - l1 - l2
  const m = 0.02
  if (l1 >= m && l2 >= m && l3 >= m) return p
  l1 = Math.max(m, l1); l2 = Math.max(m, l2); l3 = Math.max(m, l3)
  const t = l1 + l2 + l3
  return [(l1 * a[0] + l2 * b[0] + l3 * d[0]) / t, (l1 * a[1] + l2 * b[1] + l3 * d[1]) / t]
}

// Liang–Barsky: the part of a segment inside a box, or null.
function clipToBox(s: Segment, r: Region): Segment | null {
  let t0 = 0, t1 = 1
  const dx = s[2] - s[0], dy = s[3] - s[1]
  for (const [p, q] of [[-dx, s[0] - r.x0], [dx, r.x1 - s[0]], [-dy, s[1] - r.y0], [dy, r.y1 - s[1]]] as [number, number][]) {
    if (Math.abs(p) < 1e-15) { if (q < 0) return null; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t } else { if (t < t0) return null; if (t < t1) t1 = t }
  }
  return [s[0] + dx * t0, s[1] + dy * t0, s[0] + dx * t1, s[1] + dy * t1]
}

export type FieldDiagram = { cells: Cells; internal: Segment[]; delaunay: Segment[] }

// Cells, inner edges and Delaunay lines for points in one region (no veins splitting it), with the metric.
// clipSegment: how to cut a segment to the region (the caller's, so ellipses and shapes match the rest of the app).
// bends: points added in each wall where it really runs (RELAX_BENDS). For drawing (draw), a wall keeps its
// bends only where one moves it by more than 6 % of its length, as near where the nearest vein changes;
// elsewhere walls stay straight. Holes cut files grow by a third at most instead of tripling (rings, 1,200
// cells), and no drawn cell differs from the one relaxing uses by more than 15 % instead of 57 % (veins).
export function fieldDiagram(points: Float64Array, region: Region, g: MetricGrid, clipSegment: (s: Segment) => Segment[], bends = 0, draw = false): FieldDiagram {
  const n = points.length / 2
  if (!n) return { cells: [], internal: [], delaunay: [] }
  if (region.shape === 'custom' && !region.rings?.length) return { cells: new Array(n).fill(null), internal: [], delaunay: [] }
  // Ghost points far outside, so every real cell is closed; clipping to the region removes them.
  const ghosts = 16, all = new Float64Array((n + ghosts) * 2)
  all.set(points)
  const cx = (region.x0 + region.x1) / 2, cy = (region.y0 + region.y1) / 2, R = 3 * Math.max(region.x1 - region.x0, region.y1 - region.y0, 1e-6)
  for (let k = 0; k < ghosts; k++) { const t = (2 * Math.PI * k) / ghosts; all[(n + k) * 2] = cx + R * Math.cos(t); all[(n + k) * 2 + 1] = cy + R * Math.sin(t) }
  const P = (i: number): Vec => [all[i * 2], all[i * 2 + 1]]
  const Ms: Sym[] = []
  for (let i = 0; i < n + ghosts; i++) Ms.push(i < n ? metricAt(g, all[i * 2], all[i * 2 + 1]) : [1, 0, 1])
  const d = new Delaunay(all)
  const tri = Int32Array.from(d.triangles), he = Int32Array.from(d.halfedges)
  const link = (a: number, b: number) => { he[a] = b; if (b !== -1) he[b] = a }
  for (let pass = 0; pass < 40; pass++) {
    let flipped = 0
    for (let a = 0; a < tri.length; a++) {
      const b = he[a]
      if (b < a) continue
      const a0 = a - (a % 3), b0 = b - (b % 3)
      const ar = a0 + ((a + 2) % 3), al = a0 + ((a + 1) % 3), bl = b0 + ((b + 2) % 3)
      const p0 = tri[ar], pr = tri[a], pl = tri[al], p1 = tri[bl]
      const m: Sym = [(Ms[p0][0] + Ms[pr][0] + Ms[pl][0] + Ms[p1][0]) / 4, (Ms[p0][1] + Ms[pr][1] + Ms[pl][1] + Ms[p1][1]) / 4, (Ms[p0][2] + Ms[pr][2] + Ms[pl][2] + Ms[p1][2]) / 4]
      const { S } = sqrtm(m)
      const [x0, y0] = mul(S, ...P(p0)), [xr, yr] = mul(S, ...P(pr)), [xl, yl] = mul(S, ...P(pl)), [x1, y1] = mul(S, ...P(p1))
      if (!inCircle(x0, y0, xr, yr, xl, yl, x1, y1)) continue
      tri[a] = p1; tri[b] = p0
      const hbl = he[bl], har = he[ar]
      link(a, hbl); link(b, har); link(ar, bl)
      flipped++
    }
    if (!flipped) break
  }
  const T = tri.length / 3, centres: Vec[] = new Array(T)
  for (let t = 0; t < T; t++) {
    const i = tri[3 * t], j = tri[3 * t + 1], k = tri[3 * t + 2]
    const m: Sym = [(Ms[i][0] + Ms[j][0] + Ms[k][0]) / 3, (Ms[i][1] + Ms[j][1] + Ms[k][1]) / 3, (Ms[i][2] + Ms[j][2] + Ms[k][2]) / 3]
    const { S, Si } = sqrtm(m)
    const c = circumcentre(mul(S, ...P(i)), mul(S, ...P(j)), mul(S, ...P(k)))
    centres[t] = insideTriangle(mul(Si, c[0], c[1]), P(i), P(j), P(k))
  }
  // Bends: points evenly along each wall between two real points, moved to where the wall really runs. In a
  // curving field the true wall between two points curves, and the straight line between its corners would
  // hand a sliver of each cell's outer side to its neighbour, so relaxing would creep toward the curve's
  // centre. Each bend moves along the two points' direction to where both are equally far in the ellipse
  // there, and stays within the angle each point sees the wall under, so cells can't cross themselves.
  const nextOf = (e: number) => e - (e % 3) + ((e + 1) % 3)
  const orient = (p: Vec, q: Vec, r: Vec) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  // mids: for each half-edge, the wall's points in order from the corner of its own triangle to the other's.
  const mids = new Map<number, Vec[]>()
  if (bends > 0) for (let e = 0; e < tri.length; e++) {
    const o = he[e]
    if (o < e) continue
    const u = tri[e], v = tri[nextOf(e)]
    if (u >= n || v >= n) continue
    const c1 = centres[Math.floor(e / 3)], c2 = centres[Math.floor(o / 3)]
    const pu = P(u), pv = P(v), dx = pv[0] - pu[0], dy = pv[1] - pu[1]
    const inSector = (q: Vec, from: Vec) => [pu, pv].every(p => { const side = orient(p, c1, c2); return orient(p, from, q) * side > 0 && orient(p, q, c2) * side > 0 })
    const pts: Vec[] = []
    let prev = c1, ok = true
    for (let k = 1; k <= bends && ok; k++) {
      const f = k / (bends + 1), m: Vec = [c1[0] + (c2[0] - c1[0]) * f, c1[1] + (c2[1] - c1[1]) * f]
      const gap = (t: number) => {
        const x = m[0] + t * dx, y = m[1] + t * dy, M = metricAt(g, x, y)
        return metricDistance2(M, x - pu[0], y - pu[1]) - metricDistance2(M, x - pv[0], y - pv[1])
      }
      // Secant steps from the chord; the gap changes steadily along the points' direction. They stop once a
      // step moves the bend less than a 10,000th of the two points' distance.
      let t0 = 0, f0 = gap(0), t1 = f0 > 0 ? 0.05 : -0.05, f1 = gap(t1)
      for (let it = 0; it < 6 && Math.abs(t1 - t0) > 1e-4 && Math.abs(f1 - f0) > 1e-15; it++) {
        const t2 = Math.max(-0.25, Math.min(0.25, t1 - (f1 * (t1 - t0)) / (f1 - f0)))
        t0 = t1; f0 = f1; t1 = t2; f1 = gap(t1)
      }
      let t = t1, q: Vec = [m[0] + t * dx, m[1] + t * dy]
      for (let h = 0; h < 12 && !inSector(q, prev); h++) { t /= 2; q = [m[0] + t * dx, m[1] + t * dy] }
      if (!inSector(q, prev)) ok = false
      else { pts.push(q); prev = q }
    }
    if (!ok || !pts.length) continue
    if (draw) {
      const len = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) || 1
      const off = Math.max(...pts.map(q => Math.abs(orient(c1, c2, q)) / len))
      if (off < 0.06 * len) continue
    }
    mids.set(e, pts); mids.set(o, [...pts].reverse())
  }
  const inedge = new Int32Array(n + ghosts).fill(-1)
  for (let e = 0; e < tri.length; e++) { const end = tri[e - (e % 3) + ((e + 1) % 3)]; if (inedge[end] < 0) inedge[end] = e }
  const clipPoly = region.shape === 'custom' ? null : regionPolygon(region)
  const shape = region.shape === 'custom' ? shapeIndex(region.rings ?? []) : null
  const cells: Cells = new Array(n)
  for (let i = 0; i < n; i++) {
    const start = inedge[i]
    if (start < 0) { cells[i] = null; continue }
    const ring: Polygon = []
    let e = start, guard = 0
    do {
      ring.push(centres[Math.floor(e / 3)])
      const out = nextOf(e), bend = mids.get(out) // from this triangle's corner toward the next one's
      if (bend) ring.push(...bend)
      e = he[out]
    } while (e !== -1 && e !== start && guard++ < 200)
    let poly = normalize(ring)
    if (poly.length < 3) { cells[i] = null; continue }
    if (signedArea(poly) < 0) poly = poly.reverse()
    let cell: Cell | null
    if (clipPoly) {
      const clipped = normalize(clipPolygon(poly, clipPoly))
      cell = clipped.length >= 3 ? [clipped] : null
    } else cell = shape!.clipCell(poly)
    cells[i] = cell
  }
  // Inner edges: between the centres of the two triangles on each side of an edge joining two real points.
  const internal: Segment[] = [], delaunay: Segment[] = []
  const typical = Math.sqrt(regionArea(region) / (Math.PI * n)) * 0.9
  for (let e = 0; e < tri.length; e++) {
    const o = he[e]
    if (o < e) continue
    const p = tri[e], q = tri[e - (e % 3) + ((e + 1) % 3)]
    if (p >= n || q >= n) continue
    const wall = [centres[Math.floor(e / 3)], ...(mids.get(e) ?? []), centres[Math.floor(o / 3)]]
    for (let w = 0; w + 1 < wall.length; w++)
      for (const piece of clipSegment([wall[w][0], wall[w][1], wall[w + 1][0], wall[w + 1][1]])) if (Math.hypot(piece[2] - piece[0], piece[3] - piece[1]) > 1e-9) internal.push(piece)
    const [x0, y0] = P(p), [x1, y1] = P(q)
    if (Math.hypot(x1 - x0, y1 - y0) > typical * 4 * Math.sqrt(5) || !contains(region, (x0 + x1) / 2, (y0 + y1) / 2)) continue
    delaunay.push(...clipSegment([x0, y0, x1, y1]))
  }
  return { cells, internal, delaunay }
}

// Sutherland–Hodgman against a convex clip polygon (positive area), for a cell that may be slightly concave.
function clipPolygon(poly: Polygon, clip: Polygon): Polygon {
  let out = poly
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length]
    const nx = -(b[1] - a[1]), ny = b[0] - a[0], c0 = nx * a[0] + ny * a[1]
    const input = out
    out = []
    for (let k = 0; k < input.length; k++) {
      const p = input[k], q = input[(k + 1) % input.length]
      const dp = nx * p[0] + ny * p[1] - c0, dq = nx * q[0] + ny * q[1] - c0
      if (dp >= 0) out.push(p)
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]) }
    }
  }
  return out
}

export const boxClip = (r: Region) => (s: Segment): Segment[] => { const c = clipToBox(s, r); return c ? [c] : [] }

// The Lloyd target for a cell: p = (∫ w·M)⁻¹ ∫ w·M·x, with w the density weight, by fan triangles from each
// ring's first corner and their edge midpoints (exact for weights varying quadratically).
export function metricCentroid(cell: Cell, g: MetricGrid, weight: (x: number, y: number) => number): Vec | null {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0
  for (const poly of cell) {
    const [ax, ay] = poly[0]
    for (let i = 1; i < poly.length - 1; i++) {
      const [bx, by] = poly[i], [qx, qy] = poly[i + 1]
      const area = ((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 6
      for (const [mx, my] of [[(ax + bx) / 2, (ay + by) / 2], [(bx + qx) / 2, (by + qy) / 2], [(qx + ax) / 2, (qy + ay) / 2]]) {
        const [m11, m12, m22] = metricAt(g, mx, my), k = area * weight(mx, my)
        a11 += k * m11; a12 += k * m12; a22 += k * m22
        b1 += k * (m11 * mx + m12 * my); b2 += k * (m12 * mx + m22 * my)
      }
    }
  }
  const det = a11 * a22 - a12 * a12
  return Math.abs(det) > 1e-18 ? [(a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det] : null
}

