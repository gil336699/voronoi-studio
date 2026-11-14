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

function leafVeins(region: Region, base: Vec, count: number): { chains: Vec[][]; tips: number[][]; rootTips: number } {
  const a = Math.sqrt(regionArea(region) / Math.max(1, count * 10)) // spacing of the targets
  const flat = { mode: 'none' as const, strength: 1, angle: 0, invert: false }
  const targets = Array.from(poissonDisk(region, a, 30, flat, createRng(7919 + count)).points)
  const tx: number[] = [], ty: number[] = []
  for (let i = 0; i < targets.length; i += 2) { tx.push(targets[i]); ty.push(targets[i + 1]) }
  const D = a * 0.45, kill = a * 0.9, reach = a * 5
  const nx: number[] = [], ny: number[] = [], parent: number[] = []
  // Nodes in a grid of reach-sized cells, for nearest-node and too-close checks.
  const grid = new Map<string, number[]>()
  const cellOf = (x: number, y: number) => `${Math.floor(x / reach)},${Math.floor(y / reach)}`
  const add = (x: number, y: number, p: number) => { nx.push(x); ny.push(y); parent.push(p); const k = cellOf(x, y); const l = grid.get(k) ?? []; l.push(nx.length - 1); grid.set(k, l) }
  const near = (x: number, y: number, r: number): { n: number; d: number } => {
    let n = -1, d = r
    const cx = Math.floor(x / reach), cy = Math.floor(y / reach)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const m of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      const e = Math.hypot(nx[m] - x, ny[m] - y); if (e < d) { d = e; n = m }
    }
    return { n, d }
  }
  add(base[0], base[1], -1)
  const alive = new Uint8Array(tx.length).fill(1)
  for (let iter = 0; iter < 3000 && nx.length < 20000; iter++) {
    // Each target pulls on its nearest node within reach; the node grows one step toward the pull.
    const pull = new Map<number, Vec>()
    for (let t = 0; t < tx.length; t++) {
      if (!alive[t]) continue
      const { n, d } = near(tx[t], ty[t], reach)
      if (n < 0) continue
      if (d < kill) { alive[t] = 0; continue }
      const v = pull.get(n) ?? [0, 0]
      v[0] += (tx[t] - nx[n]) / d; v[1] += (ty[t] - ny[n]) / d
      pull.set(n, v)
    }
    let grew = 0
    for (const [n, [vx, vy]] of pull) {
      const len = Math.hypot(vx, vy)
      if (len < 1e-9) continue
      const x = nx[n] + (vx / len) * D, y = ny[n] + (vy / len) * D
      // Targets pulling opposite ways would pile nodes on one spot, and growth must stay inside.
      if (!contains(region, x, y) || near(x, y, D * 0.5).n >= 0) continue
      add(x, y, n); grew++
    }
    if (!grew) break
  }
  // Tips fed by each node (the pipe model), then keep the branches that feed enough tips for about `count` ends.
  const tips = new Array(nx.length).fill(0)
  const children: number[][] = nx.map(() => [])
  for (let n = 1; n < nx.length; n++) children[parent[n]].push(n)
  for (let n = nx.length - 1; n >= 0; n--) tips[n] = children[n].length ? children[n].reduce((s, c) => s + tips[c], 0) : 1
  const endsAt = (limit: number) => { let ends = 0; for (let n = 0; n < nx.length; n++) if (tips[n] >= limit && !children[n].some(c => tips[c] >= limit)) ends++; return ends }
  let lo = 1, hi = Math.max(1, tips[0])
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (endsAt(mid) >= count) lo = mid; else hi = mid - 1 }
  const limit = lo
  const chains: Vec[][] = [], chainTips: number[][] = []
  // Extensions drawn so far, so later ones stop where they meet them.
  const drawn: Vec[] = []
  const blocked = (x: number, y: number, own: Set<number>) => {
    const cx = Math.floor(x / reach), cy = Math.floor(y / reach)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const m of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (!own.has(m) && tips[m] >= limit && Math.hypot(nx[m] - x, ny[m] - y) < D * 0.7) return true
    }
    return drawn.some(([px, py]) => Math.hypot(px - x, py - y) < D * 0.7)
  }
  const walk = (start: number) => {
    for (const first of children[start].filter(c => tips[c] >= limit)) {
      const chain: Vec[] = [[nx[start], ny[start]]], t: number[] = [tips[start]]
      const own = new Set<number>([start])
      let n = first
      for (;;) {
        chain.push([nx[n], ny[n]]); t.push(tips[n]); own.add(n)
        const kept = children[n].filter(c => tips[c] >= limit)
        if (kept.length !== 1) {
          if (kept.length > 1) walk(n)
          else {
            // A tip: carry on in the same direction to the edge, so the veins close off their regions.
            const [px, py] = chain[chain.length - 2], [qx, qy] = chain[chain.length - 1]
            const len = Math.hypot(qx - px, qy - py) || 1, ux = (qx - px) / len, uy = (qy - py) / len
            let x = qx, y = qy, steps = 0, met = false
            while (contains(region, x + ux * D, y + uy * D) && steps++ < 2000) {
              x += ux * D; y += uy * D
              if (steps > 1 && blocked(x, y, own)) { met = true; break }
              drawn.push([x, y])
            }
            if (met) chain.push([x, y])
            else {
              let lo2 = 0, hi2 = D
              for (let k = 0; k < 20; k++) { const m = (lo2 + hi2) / 2; if (contains(region, x + ux * m, y + uy * m)) lo2 = m; else hi2 = m }
              chain.push([x + ux * (hi2 + D * 0.05), y + uy * (hi2 + D * 0.05)])
            }
            t.push(tips[n])
          }
          break
        }
        n = kept[0]
      }
      chains.push(chain); chainTips.push(t)
    }
  }
  walk(0)
  return { chains, tips: chainTips, rootTips: tips[0] }
}

// ---------- leaf with loops: closed venation ----------

// Closed venation (Runions et al. 2005) with marginal growth: the leaf grows out from the start as a copy of
// its outline, and sources (scattered inside, and spaced along the edge) switch on as that growing edge
// passes them. Each source pulls on its relative neighbourhood of vein points (a point counts unless another
// point is nearer both it and the source), so veins from several sides head for it, and once every one of
// them has arrived they join there, closing a loop. Veins are as thick as the tips they feed on the growth
// tree (the pipe model). Ends that stop inside the leaf are trimmed off, so every vein closes off a region.
// The sources' spacing `a` is set from the loop count by LOOP_SOURCES.
const LOOP_SOURCES = 2.2
type VeinGraph = { x: number[]; y: number[]; edges: [number, number][]; tips: number[]; rootTips: number }
function leafLoops(region: Region, base: Vec, count: number): VeinGraph {
  const size = Math.max(regionWidth(region), regionHeight(region))
  const a = Math.sqrt(regionArea(region) / Math.max(1, count * LOOP_SOURCES))
  const D = 0.45 * a, kill = 1.5 * D, reach = 4 * a
  const x: number[] = [], y: number[] = [], parent: number[] = [], along: number[] = []
  const loops: [number, number][] = []
  // Vein points in a grid of source-spacing cells.
  const cell = a, gx = region.x0 - size, gy = region.y0 - size
  const grid = new Map<number, number[]>()
  const keyOf = (i: number, j: number) => i * 65536 + j
  const add = (px: number, py: number, p: number) => {
    const n = x.length
    x.push(px); y.push(py); parent.push(p); along.push(p < 0 ? 0 : along[p] + Math.hypot(px - x[p], py - y[p]))
    const k = keyOf(Math.floor((px - gx) / cell), Math.floor((py - gy) / cell))
    const list = grid.get(k)
    if (list) list.push(n); else grid.set(k, [n])
    return n
  }
  const within = (px: number, py: number, r: number, visit: (n: number, d: number) => boolean | void) => {
    const i0 = Math.floor((px - r - gx) / cell), i1 = Math.floor((px + r - gx) / cell), j0 = Math.floor((py - r - gy) / cell), j1 = Math.floor((py + r - gy) / cell)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const n of grid.get(keyOf(i, j)) ?? []) {
      const d = Math.hypot(x[n] - px, y[n] - py)
      if (d <= r && visit(n, d) === true) return
    }
  }
  // Two vein points joined through a source make a loop only if the veins between them are long enough to
  // go round something; otherwise the join would close a sliver.
  const pathLength = (u: number, v: number) => {
    const seen = new Set<number>()
    for (let n = u; n >= 0; n = parent[n]) seen.add(n)
    let m = v
    while (m >= 0 && !seen.has(m)) m = parent[m]
    return m < 0 ? Infinity : along[u] + along[v] - 2 * along[m]
  }
  // Sources, each with the moment the growing edge reaches it: its distance from the start over the
  // distance from the start to the far edge in its direction.
  const rings = regionRings(region)
  const reachOf = (px: number, py: number) => {
    const dx = px - base[0], dy = py - base[1], L = Math.hypot(dx, dy)
    if (L < 1e-9) return 0
    const ux = dx / L, uy = dy / L
    let far = L
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]], ex = q[0] - p[0], ey = q[1] - p[1]
      const den = ux * ey - uy * ex
      if (Math.abs(den) < 1e-12) continue
      const wx = p[0] - base[0], wy = p[1] - base[1], t = (wx * ey - wy * ex) / den, u = (wx * uy - wy * ux) / den
      if (t > 0 && u >= 0 && u <= 1) far = Math.max(far, t)
    }
    return L / far
  }
  const sources: { x: number; y: number; at: number }[] = []
  const flat = { mode: 'none' as const, strength: 1, angle: 0, invert: false }
  const darts = poissonDisk(region, a, 30, flat, createRng(4099 + count * 31))
  for (let i = 0; i < darts.points.length; i += 2) sources.push({ x: darts.points[i], y: darts.points[i + 1], at: 0 })
  for (const ring of rings) {
    const L = ring.reduce((s, p, i) => s + Math.hypot(ring[(i + 1) % ring.length][0] - p[0], ring[(i + 1) % ring.length][1] - p[1]), 0)
    const n = Math.max(3, Math.round(L / a))
    let at = (L / n) / 2, s = 0
    for (let i = 0; i < ring.length && at < L; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], e = Math.hypot(q[0] - p[0], q[1] - p[1])
      while (at <= s + e && at < L) { const t = e > 0 ? (at - s) / e : 0; sources.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, at: 0 }); at += L / n }
      s += e
    }
  }
  // Edge sources too near a scattered one would leave slivers between them.
  const kept = sources.filter((src, i) => i < darts.points.length / 2 || sources.slice(0, darts.points.length / 2).every(o => Math.hypot(o.x - src.x, o.y - src.y) > 0.5 * a))
  for (const src of kept) src.at = Math.min(1, reachOf(src.x, src.y))
  kept.sort((p, q) => p.at - q.at)
  add(base[0], base[1], -1)
  let live: number[] = [], next = 0, front = 0
  const step = D / Math.max(1e-9, Math.max(...kept.map(src => Math.hypot(src.x - base[0], src.y - base[1]))))
  const neighbourhood = (t: number) => {
    const near: { n: number; d: number }[] = []
    within(kept[t].x, kept[t].y, reach, (n, d) => { near.push({ n, d }) })
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
    const j = add(kept[t].x, kept[t].y, arrived[0].n)
    const joined = [arrived[0].n]
    for (const { n } of arrived.slice(1)) {
      if (joined.some(m => pathLength(n, m) < 2 * a)) continue
      loops.push([n, j]); joined.push(n)
    }
  }
  for (let iter = 0; iter < 5000 && x.length < 30000 && (next < kept.length || live.length); iter++) {
    front += step
    while (next < kept.length && kept[next].at <= front) {
      // A source switching on next to a vein that's already there is spent: the vein feeds it.
      let clear = true
      within(kept[next].x, kept[next].y, 0.5 * a, () => { clear = false; return true })
      if (clear) live.push(next)
      next++
    }
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
        p[0] += (kept[t].x - x[v.n]) / v.d; p[1] += (kept[t].y - y[v.n]) / v.d
        pull.set(v.n, p)
      }
    }
    live = still
    let grew = 0
    for (const [n, [vx, vy]] of pull) {
      const len = Math.hypot(vx, vy)
      if (len < 1e-9) continue
      const px = x[n] + (vx / len) * D, py = y[n] + (vy / len) * D
      let crowded = !contains(region, px, py)
      if (!crowded) within(px, py, 0.5 * D, () => { crowded = true; return true })
      if (!crowded) { add(px, py, n); grew++ }
    }
    if (!grew && !joined && next >= kept.length) {
      // Stuck: each source joins the veins that did arrive, and the rest are dropped.
      for (const t of live) join(t, neighbourhood(t).filter(v => v.d < kill))
      live = []
    }
  }
  // The graph: growth edges and the joins that close loops.
  const degree = new Array<number>(x.length).fill(0)
  const edges: [number, number][] = []
  for (let n = 1; n < x.length; n++) edges.push([parent[n], n])
  edges.push(...loops)
  for (const [u, v] of edges) { degree[u]++; degree[v]++ }
  // Trim ends that stop inside the leaf, back to the junction they hang from, over and over.
  const onEdge = (n: number) => !contains(region, x[n], y[n]) || rings.some(ring => ring.some((p, i) => {
    const q = ring[(i + 1) % ring.length], ex = q[0] - p[0], ey = q[1] - p[1], L2 = ex * ex + ey * ey || 1
    const t = Math.max(0, Math.min(1, ((x[n] - p[0]) * ex + (y[n] - p[1]) * ey) / L2))
    return Math.hypot(x[n] - p[0] - t * ex, y[n] - p[1] - t * ey) < 1e-6 * size
  }))
  const adj: number[][] = x.map(() => [])
  edges.forEach(([u, v], e) => { adj[u].push(e); adj[v].push(e) })
  const gone = new Uint8Array(edges.length)
  const ends = x.map((_, n) => n).filter(n => n > 0 && degree[n] === 1 && !onEdge(n))
  while (ends.length) {
    const n = ends.pop()!
    if (degree[n] !== 1) continue
    const e = adj[n].find(f => !gone[f])
    if (e === undefined) continue
    gone[e] = 1
    const m = edges[e][0] === n ? edges[e][1] : edges[e][0]
    degree[n]--; degree[m]--
    if (m > 0 && degree[m] === 1 && !onEdge(m)) ends.push(m)
  }
  const live2 = edges.filter((_, e) => !gone[e])
  // Tips each point feeds on what's left of the growth tree (the pipe model). A point is only ever added after
  // its parent, so going down the indices visits children before parents.
  const children: number[][] = x.map(() => [])
  for (let n = 1; n < x.length; n++) if (!gone[n - 1]) children[parent[n]].push(n) // edge n − 1 is parent[n] → n
  const tips = new Array<number>(x.length).fill(1)
  for (let n = x.length - 1; n >= 0; n--) tips[n] = children[n].length ? children[n].reduce((s, c) => s + tips[c], 0) : 1
  return { x, y, edges: live2, tips, rootTips: tips[0] }
}

// A vein graph as polylines that run between its junctions and ends (and the start, point 0), so smoothing
// keeps every join in place.
function graphChains(g: VeinGraph): number[][] {
  const adj: number[][] = g.x.map(() => [])
  g.edges.forEach(([u, v], e) => { adj[u].push(e); adj[v].push(e) })
  const used = new Uint8Array(g.edges.length), chains: number[][] = []
  const other = (e: number, n: number) => (g.edges[e][0] === n ? g.edges[e][1] : g.edges[e][0])
  const follow = (start: number, e: number) => {
    const chain = [start]
    let n = start
    for (;;) {
      used[e] = 1
      n = other(e, n)
      chain.push(n)
      if (adj[n].length !== 2 || n === 0) break
      const next = adj[n].find(f => !used[f])
      if (next === undefined) break
      e = next
    }
    chains.push(chain)
  }
  for (let n = 0; n < g.x.length; n++) if (adj[n].length !== 2 || n === 0) for (const e of adj[n]) if (!used[e]) follow(n, e)
  // Loops with no junction on them at all.
  for (let n = 0; n < g.x.length; n++) for (const e of adj[n]) if (!used[e]) follow(n, e)
  return chains
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
  if (v.style === 'leaf' && v.loops) {
    const g = leafLoops(region, base, count)
    return graphChains(g).map(chain => {
      const pts = smooth(chain.map((n): Vec => [g.x[n], g.y[n]]))
      const widths = pts.map((_, i) => {
        const t = g.tips[chain[Math.min(chain.length - 1, Math.round((i / Math.max(1, pts.length - 1)) * (chain.length - 1)))]]
        return v.width * Math.max(1 - taper, Math.sqrt(t / Math.max(1, g.rootTips)))
      })
      return simplify(pts, widths, tol)
    })
  }
  if (v.style === 'leaf') {
    const { chains, tips, rootTips } = leafVeins(region, base, count)
    return chains.map((chain, c) => {
      const pts = smooth(chain)
      // Each original point's tip count, spread over the smoothed points.
      const widths = pts.map((_, i) => {
        const t = tips[c][Math.min(tips[c].length - 1, Math.round((i / Math.max(1, pts.length - 1)) * (tips[c].length - 1)))]
        return v.width * Math.max(1 - taper, Math.sqrt(t / Math.max(1, rootTips)))
      })
      return simplify(pts, widths, tol)
    })
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
