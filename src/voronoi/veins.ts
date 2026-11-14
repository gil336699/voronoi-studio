// Primary veins: lines that split the pattern into regions, the way an insect wing's main veins do, so cells
// fill each region on their own (Hoffmann et al. 2018, "A simple developmental model recapitulates complex
// insect wing venation patterns"). Three ways to get them:
// - Wing: veins follow a flow from a start point to the edge, the streamlines of a harmonic field (1 at the
//   start, 0 at the edge). Traced from evenly spaced points on the edge back toward the start, a vein that
//   comes close to one already drawn joins it, so veins run side by side, never cross, and branch.
// - Leaf: space colonization (Runions et al. 2005). Veins grow from the start toward scattered target points,
//   which vanish once reached; the branches that feed the most tips are kept, as thick as the tips they feed.
//   With loops (closed venation), veins from several sides head for each target and join there.
// - Imported: open lines from an SVG.
// Veins are as wide as Vein width at their start, narrowing by Taper toward their ends.
import { differenceD, EndType, FillRule, inflatePathsD, intersectD, JoinType, simplifyPathsD, unionD, type PathD, type PathsD } from 'clipper2-ts'
import { signedArea, type Polygon, type Vec } from './geometry'
import { createRng } from './random'
import { clampToRegion, contains, regionArea, regionCenter, regionHeight, regionRings, regionWidth, type Region } from './region'
import { poissonDisk } from './seeding'
import { boxOf, groupRings } from './shape'

export type VeinStyle = 'none' | 'wing' | 'leaf' | 'imported'
export type VeinStart = 'left' | 'right' | 'top' | 'bottom' | 'centre'
// width: mm at the start. taper: 0–0.9, how much narrower the far ends are. lines: imported veins, sheet mm.
// loops: Leaf veins join into loops (closed venation) instead of ending at the edge.
export type VeinSettings = { style: VeinStyle; count: number; start: VeinStart; width: number; taper: number; lines: Polygon[] | null; loops?: boolean }
// A vein: a polyline with a width at each point, from its start outward.
export type Vein = { points: Vec[]; widths: number[] }

const PRECISION = 4
const ARC_TOLERANCE = 0.005

// Where veins start: the point inside the pattern nearest the middle of the chosen side, or its centre.
export function veinBase(region: Region, start: VeinStart): Vec {
  const [cx, cy] = regionCenter(region)
  const target: Vec = start === 'left' ? [region.x0, cy] : start === 'right' ? [region.x1, cy]
    : start === 'top' ? [cx, region.y0] : start === 'bottom' ? [cx, region.y1] : [cx, cy]
  return clampToRegion(region, target[0], target[1])
}

// ---------- wing: streamlines of a harmonic field ----------

type Field = { x0: number; y0: number; h: number; nx: number; ny: number; phi: Float64Array }

// φ = 1 in a small disc at the base, relaxed to Laplace's equation inside (SOR). The edge near the base is a
// wall the flow runs along (no flux), and the rest of the edge is where it leaves (φ = 0), so veins run beside
// the edge near their start and fan out to the far edges, as a wing's veins do. wall: that near stretch, mm.
function harmonicField(region: Region, base: Vec, wall: number): Field {
  const size = Math.max(regionWidth(region), regionHeight(region))
  const h = size / 200
  const x0 = region.x0 - 2 * h, y0 = region.y0 - 2 * h
  const nx = Math.ceil(regionWidth(region) / h) + 5, ny = Math.ceil(regionHeight(region) / h) + 5
  // kind: 0 outside where the flow leaves, 1 inside, 2 fixed at the base, 3 outside along the wall.
  const phi = new Float64Array(nx * ny), kind = new Uint8Array(nx * ny)
  const rb = Math.max(3 * h, 0.02 * size)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * h, y = y0 + j * h, at = j * nx + i
    const away = Math.hypot(x - base[0], y - base[1])
    if (!contains(region, x, y)) kind[at] = away < wall ? 3 : 0
    else if (away <= rb) { kind[at] = 2; phi[at] = 1 }
    else kind[at] = 1
  }
  // A wall neighbour mirrors the cell itself, which is what no flux across it means.
  const val = (at: number, self: number) => (kind[at] === 3 ? self : phi[at])
  const omega = 2 / (1 + Math.sin(Math.PI / Math.max(nx, ny)))
  for (let iter = 0; iter < 6000; iter++) {
    let change = 0
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const at = j * nx + i
      if (kind[at] !== 1) continue
      const me = phi[at]
      const next = (val(at - 1, me) + val(at + 1, me) + val(at - nx, me) + val(at + nx, me)) / 4
      const d = omega * (next - phi[at])
      phi[at] += d
      if (Math.abs(d) > change) change = Math.abs(d)
    }
    if (change < 1e-7) break
  }
  return { x0, y0, h, nx, ny, phi }
}

function sample(f: Field, x: number, y: number): number {
  const u = (x - f.x0) / f.h, v = (y - f.y0) / f.h
  const i = Math.max(0, Math.min(f.nx - 2, Math.floor(u))), j = Math.max(0, Math.min(f.ny - 2, Math.floor(v)))
  const a = u - i, b = v - j, p = f.phi, n = f.nx
  return (1 - b) * ((1 - a) * p[j * n + i] + a * p[j * n + i + 1]) + b * ((1 - a) * p[(j + 1) * n + i] + a * p[(j + 1) * n + i + 1])
}

// The uphill direction, toward the base, as a unit vector (or null where the field is flat).
function uphill(f: Field, x: number, y: number): Vec | null {
  const e = f.h / 2
  const gx = sample(f, x + e, y) - sample(f, x - e, y), gy = sample(f, x, y + e) - sample(f, x, y - e)
  const len = Math.hypot(gx, gy)
  return len > 1e-14 ? [gx / len, gy / len] : null
}

// Whether segment ab crosses segment cd away from their ends.
function crossing(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o = (p: Vec, q: Vec, r: Vec) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return o(c, d, a) * o(c, d, b) < -1e-12 && o(a, b, c) * o(a, b, d) < -1e-12
}

// Points on the pattern's outer edges, evenly spaced, leaving out the wall near the base.
function edgePoints(region: Region, base: Vec, count: number, skip: number): Vec[] {
  const outer = regionRings(region).filter(ring => signedArea(ring) > 0)
  const pieces: [Vec, Vec][] = []
  for (const ring of outer) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    if (Math.hypot(mid[0] - base[0], mid[1] - base[1]) > skip) pieces.push([a, b])
  }
  const total = pieces.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0)
  if (!(total > 0) || count < 1) return []
  const gap = total / count
  const out: Vec[] = []
  let next = gap / 2, walked = 0
  for (const [a, b] of pieces) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    while (next <= walked + len && out.length < count) {
      const t = (next - walked) / len
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      next += gap
    }
    walked += len
  }
  return out
}

function wingVeins(region: Region, base: Vec, count: number, centre: boolean): { points: Vec[]; from: number; at: number }[] {
  const size = Math.max(regionWidth(region), regionHeight(region))
  // From a side, the nearest 30 % of the edge (by distance from the base) is wall; from the centre, none is.
  // Veins don't end just past the wall either, where they'd run along it.
  const reachOut = Math.max(...regionRings(region).flat().map(([x, y]) => Math.hypot(x - base[0], y - base[1])))
  const wall = centre ? 0 : 0.3 * reachOut
  const f = harmonicField(region, base, wall)
  const skip = Math.max(wall * 1.25, 0.12 * size)
  const ends = edgePoints(region, base, count, skip).sort((p, q) => Math.hypot(q[0] - base[0], q[1] - base[1]) - Math.hypot(p[0] - base[0], p[1] - base[1]))
  const perimeter = regionRings(region).filter(r => signedArea(r) > 0).reduce((s, r) => s + r.reduce((t, p, i) => t + Math.hypot(r[(i + 1) % r.length][0] - p[0], r[(i + 1) % r.length][1] - p[1]), 0), 0)
  // Veins run side by side toward the base, bundling there like a wing's main veins, and join only where they
  // would touch, so they branch at shallow angles instead of feeding one trunk.
  const merge = Math.max(2.5 * f.h, 0.06 * (perimeter / Math.max(1, count)))
  const rb = Math.max(3 * f.h, 0.02 * size)
  // Points of the veins drawn so far, in a grid of merge-distance cells: [vein, index].
  const grid = new Map<string, [number, number][]>()
  const key = (x: number, y: number) => `${Math.floor(x / merge)},${Math.floor(y / merge)}`
  const done: { points: Vec[]; from: number; at: number }[] = [] // points run from the base (or the join) outward; at: the join's index on `from`
  const nearest = (x: number, y: number): { vein: number; index: number; d: number } | null => {
    let best: { vein: number; index: number; d: number } | null = null
    const cx = Math.floor(x / merge), cy = Math.floor(y / merge)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const [vein, index] of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      const p = done[vein].points[index], d = Math.hypot(p[0] - x, p[1] - y)
      if (!best || d < best.d) best = { vein, index, d }
    }
    return best
  }
  const step = f.h / 2
  for (const end of ends) {
    const path: Vec[] = [end]
    let [x, y] = end
    let joined: { vein: number; index: number } | null = null
    for (let k = 0; k < 20000; k++) {
      const d1 = uphill(f, x, y)
      if (!d1) break
      const d2 = uphill(f, x + d1[0] * step / 2, y + d1[1] * step / 2) ?? d1
      x += d2[0] * step; y += d2[1] * step
      path.push([x, y])
      if (Math.hypot(x - base[0], y - base[1]) <= rb) { path.push(base); break }
      if (path.length > 4) {
        const near = nearest(x, y)
        if (near && near.d < merge) {
          // Meet the other vein a little nearer the base, so the join is a shallow merge, not a sideways step,
          // but never so far back that the joining stretch cuts across that vein where it bends.
          const ref = done[near.vein].points
          let index = near.index
          for (const reach of [4, 3, 2, 1, 0]) {
            let i = near.index, back = 0
            while (i > 0 && back < reach * merge) { back += Math.hypot(ref[i][0] - ref[i - 1][0], ref[i][1] - ref[i - 1][1]); i-- }
            let clear = true
            for (let k = i; k < near.index + 1 && k < ref.length - 1 && clear; k++) if (k !== i && crossing([x, y], ref[i], ref[k], ref[k + 1])) clear = false
            if (clear) { index = i; break }
          }
          joined = { vein: near.vein, index }
          path.push(ref[index])
          break
        }
      }
    }
    if (path.length < 3) continue
    path.reverse()
    const id = done.length
    done.push({ points: path, from: joined ? joined.vein : -1, at: joined ? joined.index : -1 })
    path.forEach(([px, py], i) => { const k = key(px, py); const list = grid.get(k) ?? []; list.push([id, i]); grid.set(k, list) })
  }
  return done
}

// ---------- leaf: space colonization ----------

// Segments in a grid, for nearest-segment queries against the region's outline.
class SegmentGrid {
  private map = new Map<number, number[]>()
  private segs: number[][] = []
  constructor(private cell: number) {}
  private key(i: number, j: number) { return (i + 30000) * 60001 + (j + 30000) }
  add(ax: number, ay: number, bx: number, by: number) {
    const id = this.segs.length, c = this.cell
    this.segs.push([ax, ay, bx, by])
    for (let i = Math.floor(Math.min(ax, bx) / c); i <= Math.floor(Math.max(ax, bx) / c); i++)
      for (let j = Math.floor(Math.min(ay, by) / c); j <= Math.floor(Math.max(ay, by) / c); j++) {
        const k = this.key(i, j), list = this.map.get(k)
        if (list) list.push(id); else this.map.set(k, [id])
      }
  }
  // The nearest point within r on any segment.
  nearest(x: number, y: number, r: number): { d: number; x: number; y: number } | null {
    let best: { d: number; x: number; y: number } | null = null
    const c = this.cell
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++)
        for (const id of this.map.get(this.key(i, j)) ?? []) {
          const [ax, ay, bx, by] = this.segs[id], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0
          const px = ax + ex * t, py = ay + ey * t, d = Math.hypot(x - px, y - py)
          if (d <= r && (!best || d < best.d)) best = { d, x: px, y: py }
        }
    return best
  }
}

// Space colonization (Runions et al. 2005) set up like Jason Webb's "bounds" experiment, at its proportions:
// attractors fill the leaf densely (blue noise, 1/75 of its size apart), and veins grow from the start in short steps
// (1/140 of the size), each toward the attractors within 1/23 of the size that have no nearer vein, with a little
// jitter; an attractor goes once a vein comes within a step of it. That grows a dense, smooth tree, the same for every
// vein count, so it's kept for the last few regions and starts.
type Tree = { x: number[]; y: number[]; parent: number[]; children: number[][]; tips: number[]; D: number; spacing: number }
const trees: { key: string; rings: unknown; tree: Tree }[] = []
function growTree(region: Region, base: Vec): Tree {
  const key = [region.shape, region.x0, region.y0, region.x1, region.y1, base[0], base[1]].join('|')
  const hit = trees.find(t => t.key === key && t.rings === region.rings)
  if (hit) return hit.tree
  const size = Math.max(regionWidth(region), regionHeight(region))
  const spacing = size / 75, D = size / 140, reach = size / 23, kill = D
  const flat = { mode: 'none' as const, strength: 1, angle: 0, invert: false }
  const targets = Array.from(poissonDisk(region, spacing, 30, flat, createRng(7919)).points)
  const tx: number[] = [], ty: number[] = []
  for (let i = 0; i < targets.length; i += 2) { tx.push(targets[i]); ty.push(targets[i + 1]) }
  const x: number[] = [], y: number[] = [], parent: number[] = []
  // Points in a grid of reach-sized cells, for nearest-point and too-close checks.
  const grid = new Map<number, number[]>()
  const keyOf = (i: number, j: number) => (i + 30000) * 60001 + (j + 30000)
  const add = (px: number, py: number, p: number) => {
    x.push(px); y.push(py); parent.push(p)
    const k = keyOf(Math.floor(px / reach), Math.floor(py / reach)), list = grid.get(k)
    if (list) list.push(x.length - 1); else grid.set(k, [x.length - 1])
  }
  const near = (px: number, py: number, r: number): { n: number; d: number } => {
    let n = -1, d = r
    const cx = Math.floor(px / reach), cy = Math.floor(py / reach)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const m of grid.get(keyOf(cx + dx, cy + dy)) ?? []) {
      const e = Math.hypot(x[m] - px, y[m] - py); if (e < d) { d = e; n = m }
    }
    return { n, d }
  }
  const rng = createRng(104729)
  add(base[0], base[1], -1)
  const alive = new Uint8Array(tx.length).fill(1)
  for (let iter = 0; iter < 4000 && x.length < 60000; iter++) {
    // Each attractor pulls on its nearest vein point within reach; that point grows one step toward its pulls.
    const pull = new Map<number, Vec>()
    for (let t = 0; t < tx.length; t++) {
      if (!alive[t]) continue
      const { n, d } = near(tx[t], ty[t], reach)
      if (n < 0) continue
      if (d < kill) { alive[t] = 0; continue }
      const v = pull.get(n)
      if (v) { v[0] += (tx[t] - x[n]) / d; v[1] += (ty[t] - y[n]) / d } else pull.set(n, [(tx[t] - x[n]) / d, (ty[t] - y[n]) / d])
    }
    let grew = 0
    for (const [n, [vx, vy]] of pull) {
      const len = Math.hypot(vx, vy)
      if (len < 1e-9) continue
      // Webb's jitter, a tenth of a unit each way, so veins don't run dead straight.
      const jx = vx / len + (rng() - 0.5) * 0.2, jy = vy / len + (rng() - 0.5) * 0.2, j = Math.hypot(jx, jy)
      const px = x[n] + (jx / j) * D, py = y[n] + (jy / j) * D
      // Attractors pulling opposite ways would pile points on one spot, and growth must stay inside.
      if (!contains(region, px, py) || near(px, py, D * 0.45).n >= 0) continue
      add(px, py, n); grew++
    }
    if (!grew) break
  }
  // Tips fed by each point (the pipe model). A point is only added after its parent, so going down the indices
  // visits children first.
  const children: number[][] = x.map(() => [])
  for (let n = 1; n < x.length; n++) children[parent[n]].push(n)
  const tips = new Array<number>(x.length).fill(0)
  for (let n = x.length - 1; n >= 0; n--) tips[n] = children[n].length ? children[n].reduce((s, c) => s + tips[c], 0) : 1
  const tree = { x, y, parent, children, tips, D, spacing }
  trees.unshift({ key, rings: region.rings, tree })
  if (trees.length > 4) trees.pop()
  return tree
}

// The tree's main veins: the branches that feed the most tips, about `ends` of them. Each carries on along its own
// heaviest branch to where growth stopped, then curves the last little way to the edge, so its regions close. Widths follow Webb's canalization: each point is
// as thick as its longest run to a tip, so veins taper all along their length. Returns the veins between branch points,
// each point with its run to a tip (mm), and the longest run.
type Line = { points: Vec[]; run: number[] }
function mainVeins(region: Region, tree: Tree, ends: number): { lines: Line[]; longest: number } {
  const { x, y, parent, children, tips, D, spacing } = tree
  const n = x.length
  const endsAt = (limit: number) => { let e = 0; for (let i = 0; i < n; i++) if (tips[i] >= limit && !children[i].some(c => tips[c] >= limit)) e++; return e }
  let lo = 1, hi = Math.max(1, tips[0])
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (endsAt(mid) >= ends) lo = mid; else hi = mid - 1 }
  const kept = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (tips[i] >= lo) kept[i] = 1
  const size = Math.max(regionWidth(region), regionHeight(region))
  const edges = new SegmentGrid(size / 40)
  for (const ring of regionRings(region)) for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; edges.add(p[0], p[1], q[0], q[1]) }
  const dir = (a: number, b: number): Vec => { const ux = x[b] - x[a], uy = y[b] - y[a], L = Math.hypot(ux, uy) || 1; return [ux / L, uy / L] }
  const tails = new Map<number, Vec[]>()
  for (let e = 0; e < n; e++) {
    if (!kept[e] || children[e].some(c => tips[c] >= lo)) continue
    // Carry on along the heaviest branch to where growth stopped, as the real vein does.
    let last = e
    while (children[last].length) { last = children[last].reduce((b, k) => (tips[k] > tips[b] ? k : b)); kept[last] = 1 }
    // Then curve the last little way to the edge: steer from the vein's heading toward the nearest edge point.
    let back = last
    for (let k = 0; k < 6 && parent[back] >= 0; k++) back = parent[back]
    let h = dir(back, last), px = x[last], py = y[last]
    const tail: Vec[] = []
    for (let k = 0; k < 60; k++) {
      const near = edges.nearest(px, py, spacing * 8)
      if (!near) break
      const to = [near.x - px, near.y - py], L = Math.hypot(to[0], to[1]) || 1, w = Math.min(1, 0.25 + k * 0.08)
      const hx = h[0] * (1 - w) + (to[0] / L) * w, hy = h[1] * (1 - w) + (to[1] / L) * w, hl = Math.hypot(hx, hy) || 1
      h = [hx / hl, hy / hl]
      const qx = px + h[0] * D, qy = py + h[1] * D
      if (!contains(region, qx, qy)) {
        let a = 0, b = D
        for (let s = 0; s < 20; s++) { const m = (a + b) / 2; if (contains(region, px + h[0] * m, py + h[1] * m)) a = m; else b = m }
        tail.push([px + h[0] * (b + D * 0.05), py + h[1] * (b + D * 0.05)])
        tails.set(last, tail)
        break
      }
      px = qx; py = qy; tail.push([px, py])
    }
  }
  // Each kept point's longest run to a tip (its own tail included).
  const run = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    if (!kept[i]) continue
    let r = 0
    const tail = tails.get(i)
    if (tail) { let s = 0, p: Vec = [x[i], y[i]]; for (const q of tail) { s += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q } r = s }
    for (const c of children[i]) if (kept[c]) r = Math.max(r, run[c] + Math.hypot(x[c] - x[i], y[c] - y[i]))
    run[i] = r
  }
  const lines: Line[] = []
  const walk = (start: number) => {
    for (const first of children[start].filter(c => kept[c])) {
      const points: Vec[] = [[x[start], y[start]]], r: number[] = [run[start]]
      let c = first
      for (;;) {
        points.push([x[c], y[c]]); r.push(run[c])
        const next = children[c].filter(k => kept[k])
        if (next.length !== 1) {
          if (next.length > 1) walk(c)
          else {
            const tail = tails.get(c)
            if (tail) { let left = run[c], p = points[points.length - 1]; for (const q of tail) { left -= Math.hypot(q[0] - p[0], q[1] - p[1]); points.push(q); r.push(Math.max(0, left)); p = q } }
          }
          break
        }
        c = next[0]
      }
      lines.push({ points, run: r })
    }
  }
  walk(0)
  return { lines, longest: Math.max(1e-9, run[0]) }
}

// ---------- leaf with loops: closed venation between the main veins ----------

// Loops grow between the main veins by closed venation (Runions et al. 2005): sources scattered between them pull on
// their relative neighbourhood of vein points (a point counts unless another point is nearer both it and the source),
// so veins from both sides head for a source, and once every one of them has arrived they join there, closing a loop.
// Ends left inside the leaf are trimmed back. The sources' spacing `a` is set from the loop count by LOOP_SOURCES.
// Loop sources per region asked for, measured so regions land near the Loops count (16 → 18–22, 30 → 29–43 over a
// circle, a square and a wide sheet); and how much heading a growing loop vein keeps, so it curves into its join.
const LOOP_SOURCES = 6.5, INERTIA = 0.5
// Returns the loop veins, and where each one starts on a main vein (that vein's index and the distance along it).
function loopVeins(region: Region, main: Line[], count: number, D: number): { chains: Vec[][]; attach: { line: number; at: number }[] } {
  const a = Math.sqrt(regionArea(region) / Math.max(1, count * LOOP_SOURCES))
  const kill = 1.5 * D, reach = 2.5 * a
  const x: number[] = [], y: number[] = [], parent: number[] = [], line: number[] = [], index: number[] = [], along: number[] = []
  const cell = a, grid = new Map<number, number[]>()
  const keyOf = (i: number, j: number) => (i + 30000) * 60001 + (j + 30000)
  const add = (px: number, py: number, p: number, l: number, k: number, s: number) => {
    const id = x.length
    x.push(px); y.push(py); parent.push(p); line.push(l); index.push(k); along.push(s)
    const key = keyOf(Math.floor(px / cell), Math.floor(py / cell)), list = grid.get(key)
    if (list) list.push(id); else grid.set(key, [id])
    return id
  }
  const within = (px: number, py: number, r: number, visit: (id: number, d: number) => boolean | void) => {
    for (let i = Math.floor((px - r) / cell); i <= Math.floor((px + r) / cell); i++)
      for (let j = Math.floor((py - r) / cell); j <= Math.floor((py + r) / cell); j++)
        for (const id of grid.get(keyOf(i, j)) ?? []) { const d = Math.hypot(x[id] - px, y[id] - py); if (d <= r && visit(id, d) === true) return }
  }
  // The main veins, resampled every step, are where loops start; they're never trimmed.
  main.forEach((l, li) => {
    let carry = 0
    add(l.points[0][0], l.points[0][1], -1, li, 0, 0)
    for (let i = 1, k = 1; i < l.points.length; i++) {
      const [p, q] = [l.points[i - 1], l.points[i]], seg = Math.hypot(q[0] - p[0], q[1] - p[1])
      for (let t = D - carry; t < seg; t += D) add(p[0] + ((q[0] - p[0]) * t) / seg, p[1] + ((q[1] - p[1]) * t) / seg, -1, li, k++, 0)
      carry = (carry + seg) % D
    }
  })
  const mainCount = x.length
  const flat = { mode: 'none' as const, strength: 1, angle: 0, invert: false }
  const darts = poissonDisk(region, a, 30, flat, createRng(4099 + count * 31)).points
  const sx: number[] = [], sy: number[] = []
  for (let i = 0; i < darts.length; i += 2) {
    let clear = true
    within(darts[i], darts[i + 1], 0.6 * a, () => { clear = false; return true })
    if (clear) { sx.push(darts[i]); sy.push(darts[i + 1]) }
  }
  // A loop joins veins grown from two different main veins: two from one main vein would close a bulb beside it.
  const loops: [number, number][] = []
  const neighbourhood = (t: number) => {
    const near: { n: number; d: number }[] = []
    within(sx[t], sy[t], reach, (n, d) => { near.push({ n, d }) })
    near.sort((p, q) => p.d - q.d)
    const rn: { n: number; d: number }[] = []
    for (let i = 0; i < near.length && i < 48; i++) {
      const v = near[i]
      let open = true
      for (let k = 0; k < i && open; k++) if (Math.hypot(x[near[k].n] - x[v.n], y[near[k].n] - y[v.n]) < v.d) open = false
      if (open) rn.push(v)
    }
    return rn
  }
  const join = (t: number, arrived: { n: number; d: number }[]) => {
    if (!arrived.length) return
    const first = arrived[0].n
    const j = add(sx[t], sy[t], first, line[first], index[first], along[first] + arrived[0].d)
    const joined = [first]
    for (const { n } of arrived.slice(1)) {
      if (joined.some(m => line[m] === line[n])) continue
      loops.push([n, j]); joined.push(n)
    }
  }
  let live = sx.map((_, i) => i)
  for (let iter = 0; iter < 3000 && x.length < 40000 && live.length; iter++) {
    const pull = new Map<number, Vec>()
    const still: number[] = []
    let joined = 0
    for (const t of live) {
      const rn = neighbourhood(t)
      if (!rn.length) { still.push(t); continue }
      const waiting = rn.filter(v => v.d >= kill)
      if (!waiting.length) { join(t, rn); joined++; continue }
      still.push(t)
      for (const v of waiting) {
        const p = pull.get(v.n) ?? [0, 0]
        p[0] += (sx[t] - x[v.n]) / v.d; p[1] += (sy[t] - y[v.n]) / v.d
        pull.set(v.n, p)
      }
    }
    live = still
    let grew = 0
    for (const [n, [vx, vy]] of pull) {
      const len = Math.hypot(vx, vy)
      if (len < 1e-9) continue
      // A growing loop vein keeps some of its heading (main veins start fresh), so loop veins curve into their joins.
      let dx = vx / len, dy = vy / len
      if (n >= mainCount && parent[n] >= 0) { const hx = x[n] - x[parent[n]], hy = y[n] - y[parent[n]], hl = Math.hypot(hx, hy) || 1; dx += (hx / hl) * INERTIA; dy += (hy / hl) * INERTIA }
      const dl = Math.hypot(dx, dy) || 1
      const px = x[n] + (dx / dl) * D, py = y[n] + (dy / dl) * D
      let crowded = !contains(region, px, py)
      if (!crowded) within(px, py, 0.5 * D, () => { crowded = true; return true })
      if (!crowded) { add(px, py, n, line[n], index[n], along[n] + D); grew++ }
    }
    if (!grew && !joined) {
      // Stuck: each source joins the veins that did arrive, and the rest are dropped.
      for (const t of live) join(t, neighbourhood(t).filter(v => v.d < kill))
      live = []
    }
  }
  // The loop veins as a graph: growth edges from the main veins out, and the joins.
  const edges: [number, number][] = []
  for (let n = mainCount; n < x.length; n++) edges.push([parent[n], n])
  edges.push(...loops)
  const degree = new Array<number>(x.length).fill(0)
  for (const [u, v] of edges) { degree[u]++; degree[v]++ }
  const adj: number[][] = x.map(() => [])
  edges.forEach(([u, v], e) => { adj[u].push(e); adj[v].push(e) })
  // Trim ends that stop inside the leaf, back to the vein they hang from, over and over.
  const gone = new Uint8Array(edges.length)
  const ends = [] as number[]
  for (let n = mainCount; n < x.length; n++) if (degree[n] === 1) ends.push(n)
  while (ends.length) {
    const n = ends.pop()!
    if (degree[n] !== 1 || n < mainCount) continue
    const e = adj[n].find(f => !gone[f])
    if (e === undefined) continue
    gone[e] = 1
    const m = edges[e][0] === n ? edges[e][1] : edges[e][0]
    degree[n]--; degree[m]--
    if (m >= mainCount && degree[m] === 1) ends.push(m)
  }
  // Polylines between joins and the main veins, so smoothing keeps every join in place.
  const used = new Uint8Array(edges.length), chains: Vec[][] = [], attach: { line: number; at: number }[] = []
  const other = (e: number, v: number) => (edges[e][0] === v ? edges[e][1] : edges[e][0])
  const isEnd = (v: number) => v < mainCount || degree[v] !== 2
  const follow = (start: number, e: number) => {
    const chain: Vec[] = [[x[start], y[start]]]
    let v = start
    for (;;) {
      used[e] = 1
      v = other(e, v)
      chain.push([x[v], y[v]])
      if (isEnd(v)) break
      const next = adj[v].find(f => !used[f] && !gone[f])
      if (next === undefined) break
      e = next
    }
    if (chain.length < 2) return
    chains.push(chain)
    for (const end of [start, v]) if (end < mainCount) attach.push({ line: line[end], at: index[end] * D })
  }
  for (let v = 0; v < x.length; v++) if (isEnd(v)) for (const e of adj[v]) if (!used[e] && !gone[e]) follow(v, e)
  for (let v = 0; v < x.length; v++) for (const e of adj[v]) if (!used[e] && !gone[e]) follow(v, e)
  return { chains, attach }
}

// A vein made smooth: a few passes of averaging each point with its neighbours (taking out the step-to-step jitter),
// then Chaikin's corner cutting. Both ends stay where they are, so joins stay joined.
function relaxLine(points: Vec[], passes = 4): Vec[] {
  let p = points
  for (let k = 0; k < passes && p.length > 2; k++) p = p.map((q, i) => (i === 0 || i === p.length - 1 ? q : [(p[i - 1][0] + 2 * q[0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * q[1] + p[i + 1][1]) / 4]))
  return smooth(p)
}
// Points put into a polyline at distances along it (with values interpolated), and their indices, to keep them.
function insertAlong(points: Vec[], values: number[], at: number[]): { points: Vec[]; values: number[]; fixed: number[] } {
  const out: Vec[] = [points[0]], vals: number[] = [values[0]], fixed: number[] = []
  const want = [...at].sort((p, q) => p - q)
  let s = 0, k = 0
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]], seg = Math.hypot(q[0] - p[0], q[1] - p[1])
    while (k < want.length && want[k] <= s + seg) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (want[k] - s) / seg)) : 0
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); vals.push(values[i - 1] + (values[i] - values[i - 1]) * t); fixed.push(out.length - 1)
      k++
    }
    out.push(q); vals.push(values[i]); s += seg
  }
  return { points: out, values: vals, fixed }
}
// Values given at a polyline's points, carried over to a smoothed copy of it by the fraction of the way along.
function resampleOnto(points: Vec[], values: number[], onto: Vec[]): number[] {
  const s = [0]; for (let i = 1; i < points.length; i++) s.push(s[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  const t = [0]; for (let i = 1; i < onto.length; i++) t.push(t[i - 1] + Math.hypot(onto[i][0] - onto[i - 1][0], onto[i][1] - onto[i - 1][1]))
  const S = s[s.length - 1] || 1, T = t[t.length - 1] || 1
  let j = 1
  return t.map(u => {
    const at = (u / T) * S
    while (j < s.length - 1 && s[j] < at) j++
    const f = s[j] > s[j - 1] ? (at - s[j - 1]) / (s[j] - s[j - 1]) : 0
    return values[j - 1] + (values[j] - values[j - 1]) * Math.max(0, Math.min(1, f))
  })
}

// Chaikin smoothing that keeps both ends.
function smooth(points: Vec[], passes = 2): Vec[] {
  let p = points
  for (let k = 0; k < passes && p.length > 2; k++) {
    const out: Vec[] = [p[0]]
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b] = [p[i], p[i + 1]]
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
    }
    out.push(p[p.length - 1])
    p = out
  }
  return p
}

// Douglas–Peucker, so cut files don't carry a point every few microns. `fixed`: points to keep, such as where
// other veins join, so a joining vein starts exactly on this one.
function simplify(points: Vec[], widths: number[], tol: number, fixed: Iterable<number> = []): Vein {
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1
  for (const i of fixed) if (i >= 0 && i < points.length) keep[i] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const [a, b] = [points[i], points[j]], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-12
    let far = 0, at = -1
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - points[k][1]) - (a[0] - points[k][0]) * (b[1] - a[1])) / L
      if (d > far) { far = d; at = k }
    }
    if (at >= 0 && far > tol) { keep[at] = 1; stack.push([i, at], [at, j]) }
  }
  return { points: points.filter((_, i) => keep[i]), widths: widths.filter((_, i) => keep[i]) }
}

const length = (p: Vec[]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0)

export function makeVeins(region: Region, v: VeinSettings): Vein[] {
  if (v.style === 'none' || !(v.width > 0) || (region.shape === 'custom' && !region.rings?.length)) return []
  const taper = Math.min(0.95, Math.max(0, v.taper))
  const size = Math.max(regionWidth(region), regionHeight(region))
  const tol = size / 4000
  if (v.style === 'imported') {
    return (v.lines ?? []).filter(l => l.length >= 2).map(line => {
      const L = length(line) || 1
      let s = 0
      const widths = line.map((q, i) => { if (i) s += Math.hypot(q[0] - line[i - 1][0], q[1] - line[i - 1][1]); return v.width * (1 - taper * (s / L)) })
      return simplify(line, widths, tol)
    })
  }
  const base = veinBase(region, v.start)
  const count = Math.max(1, Math.round(v.count))
  if (v.style === 'leaf') {
    // Main veins, smoothed and tapering along their length; with loops (fewer main veins: a third of the loops, plus
    // two), thinner veins grown between the smoothed main veins, each join a point kept in the main vein it meets.
    const tree = growTree(region, base)
    const { lines, longest } = mainVeins(region, tree, v.loops ? Math.min(14, Math.max(3, Math.round(count / 3) + 2)) : count)
    const smoothed: Line[] = lines.map(l => { const pts = relaxLine(l.points); return { points: pts, run: resampleOnto(l.points, l.run, pts) } })
    const width = (r: number) => v.width * ((1 - taper) + taper * (r / longest))
    if (!v.loops) return smoothed.map(l => simplify(l.points, l.run.map(width), tol))
    const { chains, attach } = loopVeins(region, smoothed, count, tree.D)
    const veins = smoothed.map((l, i) => {
      const { points, values, fixed } = insertAlong(l.points, l.run, attach.filter(a => a.line === i).map(a => a.at))
      return simplify(points, values.map(width), tol, fixed)
    })
    const fine = v.width * Math.max(0.15, (1 - taper) * 0.75)
    for (const chain of chains) { const pts = relaxLine(chain, 12); veins.push(simplify(pts, pts.map(() => fine), tol)) }
    return veins
  }
  // Wing: distance along the veins from the base sets each point's width.
  const traced = wingVeins(region, base, count, v.start === 'centre')
  const along: number[][] = []
  traced.forEach(({ points, from }, id) => {
    let s = 0
    if (from >= 0) {
      const join = points[0], ref = traced[from].points
      let best = 0, bd = Infinity
      ref.forEach((p, i) => { const d = Math.hypot(p[0] - join[0], p[1] - join[1]); if (d < bd) { bd = d; best = i } })
      s = along[from][best]
    }
    along[id] = points.map((q, i) => { if (i) s += Math.hypot(q[0] - points[i - 1][0], q[1] - points[i - 1][1]); return s })
  })
  const far = Math.max(1e-9, ...along.map(a => a[a.length - 1] ?? 0))
  const joins = traced.map(() => [] as number[])
  traced.forEach(({ from, at }) => { if (from >= 0) joins[from].push(at) })
  return traced.map(({ points }, id) => simplify(points, along[id].map(s => v.width * (1 - taper * (s / far))), tol, joins[id]))
}

// ---------- splitting the pattern ----------

const toPath = (poly: Vec[]): PathD => poly.map(([x, y]) => ({ x, y }))
const fromPaths = (paths: PathsD): Polygon[] => paths.filter(p => p.length >= 3).map(p => p.map(({ x, y }): Vec => [x, y])).filter(p => Math.abs(signedArea(p)) > 1e-9)

// The area the veins cover: each vein buffered by half its width, in short runs at their own width.
export function veinStrips(veins: Vein[]): Polygon[] {
  const paths: PathsD = []
  for (const { points, widths } of veins) {
    const total = length(points)
    const piece = Math.max(0.5, total / 400) // short enough that a tapering vein's width steps by little
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n = Math.max(1, Math.ceil(len / piece))
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, tm = (t0 + t1) / 2
        const w = widths[i] + (widths[i + 1] - widths[i]) * tm
        if (w <= 1e-6) continue
        const p: Vec = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], q: Vec = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]
        paths.push(...inflatePathsD([toPath([p, q])], w / 2, JoinType.Round, EndType.Round, 2, PRECISION, ARC_TOLERANCE))
      }
    }
  }
  // Simplified to within 10 µm, far finer than any cutter: the many short pieces leave thousands of points that
  // every cell along a vein would otherwise be clipped against.
  return paths.length ? fromPaths(simplifyPathsD(unionD(paths, FillRule.NonZero), 0.01, true)) : []
}

// The pattern with its veins taken out: one region whose rings are every remaining piece, with each piece
// listed in `parts` (outer outline first, then its holes) and the veins' own outline in `veins`.
export function splitByVeins(region: Region, veins: Vein[]): Region {
  if (!veins.length) return region
  const strips = veinStrips(veins)
  if (!strips.length) return region
  const rings = regionRings(region)
  const left = fromPaths(differenceD(rings.map(toPath), strips.map(toPath), FillRule.EvenOdd, PRECISION))
  const parts = groupRings(left).map(({ outer, holes }) => [
    signedArea(outer) > 0 ? outer : [...outer].reverse(),
    ...holes.map(h => (signedArea(h) < 0 ? h : [...h].reverse())),
  ]).filter(part => part.reduce((s, r) => s + signedArea(r), 0) > 1e-4)
  const shape = fromPaths(intersectD(strips.map(toPath), rings.map(toPath), FillRule.EvenOdd, PRECISION))
  const all = parts.flat()
  const [x0, y0, x1, y1] = all.length ? boxOf(all) : [region.x0, region.y0, region.x1, region.y1]
  return { shape: 'custom', x0, y0, x1, y1, rings: all, parts, veins: shape }
}

// The last few splits, so the worker's relax steps and the page's redraws reuse them.
const splits: { key: string; rings: Polygon[] | undefined; lines: Polygon[] | null; region: Region }[] = []
export function veinedRegion(region: Region, v: VeinSettings): Region {
  if (v.style === 'none') return region
  const key = [v.style, v.count, v.start, v.width, v.taper, v.style === 'leaf' && v.loops, region.shape, region.x0, region.y0, region.x1, region.y1].join('|')
  const lines = v.style === 'imported' ? v.lines : null
  const hit = splits.find(s => s.key === key && s.rings === region.rings && s.lines === lines)
  if (hit) return hit.region
  const out = splitByVeins(region, makeVeins(region, v))
  splits.unshift({ key, rings: region.rings, lines, region: out })
  if (splits.length > 6) splits.pop()
  return out
}
