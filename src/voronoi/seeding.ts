// Where the first points go. Four placements: random, even (Poisson-disk), hex grid and square grid.
// All of them are seeded, so the same settings and seed give the same points.
import { densityField, densityPeak, integrateDensity, type DensityField, type DensitySettings } from './density'
import { createRng, type Rng } from './random'
import { clampToRegion, contains, regionArea, regionHeight, regionWidth, type Region } from './region'
import { pointsToSheet, stretchFrame, toSheet, workRegion, type Stretch } from './stretch'

export type Placement = 'random' | 'even' | 'hex' | 'square'
export type SeedSettings = {
  count: number
  placement: Placement
  autoSpacing: boolean
  spacing: number // mm between points when autoSpacing is off (at the sparse end of a gradient)
  tries: number // Poisson-disk attempts per point
  jitter: number // 0–1, share of the grid spacing that grid points may wander
  seed: number
  density: DensitySettings
  stretch?: Stretch | null
}
// A density to place points by: its value anywhere and its highest value, for rejection sampling.
type Field = { at: DensityField; peak: number }
const fieldOf = (density: DensitySettings | Field, region: Region): Field =>
  'at' in density ? density : { at: densityField(density, region), peak: densityPeak(density) }
// spacing: the spacing actually used (0 for random), so turning Auto spacing off keeps the same look.
export type SeedResult = { points: Float64Array; capped: boolean; spacing: number }

export const MAX_POINTS = 20_000
// Bridson's method fills about this share of the hexagonal-packing count, so it sets the starting spacing.
const POISSON_FILL = 0.62

// With a stretch, points are placed evenly in the squeezed work space and stretched back, so they sit farther
// apart along the stretch than across it. The squeeze keeps areas, so the density reads the same there.
export function seedPoints(settings: SeedSettings, region: Region): SeedResult {
  const f = stretchFrame(settings.stretch)
  const field = fieldOf(settings.density, region)
  if (!f) return seedIn(settings, region, field)
  const work = seedIn(settings, workRegion(region, f), { at: (x, y) => field.at(...toSheet(f, x, y)), peak: field.peak })
  const points = pointsToSheet(work.points, f)
  for (let i = 0; i < points.length; i += 2) {
    if (!contains(region, points[i], points[i + 1])) [points[i], points[i + 1]] = clampToRegion(region, points[i], points[i + 1])
  }
  return { ...work, points }
}

function seedIn(settings: SeedSettings, region: Region, field: Field): SeedResult {
  const rng = createRng(settings.seed)
  const count = Math.max(2, Math.min(MAX_POINTS, Math.round(settings.count)))
  switch (settings.placement) {
    case 'random': return { points: randomPoints(count, region, field, rng), capped: false, spacing: 0 }
    case 'even': return evenPoints(settings, count, region, rng, field)
    case 'hex': return gridPoints(settings, count, region, rng, true)
    case 'square': return gridPoints(settings, count, region, rng, false)
  }
}

// The average spacing that a count of points would have in a region, used for auto sizes and readouts.
export function typicalSpacing(region: Region, count: number): number {
  return Math.sqrt(regionArea(region) / Math.max(1, count))
}

function randomPoints(count: number, region: Region, density: Field, rng: Rng): Float64Array {
  const field = density.at, top = density.peak
  const out = new Float64Array(count * 2)
  const w = regionWidth(region), h = regionHeight(region)
  let n = 0
  for (let attempt = 0; n < count && attempt < count * 5000; attempt++) {
    const x = region.x0 + rng() * w, y = region.y0 + rng() * h
    if (!contains(region, x, y)) continue
    if (top > 1 && rng() * top > field(x, y)) continue
    out[n * 2] = x; out[n * 2 + 1] = y; n++
  }
  return out.slice(0, n * 2)
}

// Bridson's Poisson-disk sampling with a spacing that can vary across the sheet.
export function poissonDisk(region: Region, spacing: number, tries: number, densityIn: DensitySettings | Field, rng: Rng, limit = MAX_POINTS): SeedResult {
  const density = fieldOf(densityIn, region)
  const field = density.at, top = density.peak
  const radius = (x: number, y: number) => spacing / Math.sqrt(field(x, y))
  const rMin = spacing / Math.sqrt(top), rMax = spacing
  const cell = rMin / Math.SQRT2
  const w = regionWidth(region), h = regionHeight(region)
  // No spacing means no region to fill. Without this, doubling a zero spacing below would never end.
  if (!(spacing > 0) || !Number.isFinite(spacing)) return { points: new Float64Array(), capped: false, spacing: 0 }
  const gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell))
  if (gw * gh > 40_000_000) return poissonDisk(region, spacing * 2, tries, density, rng, limit) // keeps memory bounded
  const grid = new Int32Array(gw * gh).fill(-1)
  const reach = Math.ceil(rMax / cell)
  const xs: number[] = [], ys: number[] = [], active: number[] = []
  const gx = (x: number) => Math.max(0, Math.min(gw - 1, Math.floor((x - region.x0) / cell)))
  const gy = (y: number) => Math.max(0, Math.min(gh - 1, Math.floor((y - region.y0) / cell)))
  const fits = (x: number, y: number) => {
    const r = radius(x, y), r2 = r * r
    const cx = gx(x), cy = gy(y)
    for (let j = Math.max(0, cy - reach); j <= Math.min(gh - 1, cy + reach); j++) {
      for (let i = Math.max(0, cx - reach); i <= Math.min(gw - 1, cx + reach); i++) {
        const k = grid[j * gw + i]
        if (k < 0) continue
        const dx = xs[k] - x, dy = ys[k] - y
        if (dx * dx + dy * dy < r2) return false
      }
    }
    return true
  }
  // Grid cells whose centre lies within twice the spacing of a point: the parts the growth has reached.
  const reached = new Uint8Array(gw * gh)
  const add = (x: number, y: number) => {
    grid[gy(y) * gw + gx(x)] = xs.length
    active.push(xs.length); xs.push(x); ys.push(y)
    const d = 2 * radius(x, y), k = Math.ceil(d / cell), cx = gx(x), cy = gy(y)
    for (let j = Math.max(0, cy - k); j <= Math.min(gh - 1, cy + k); j++) {
      const dy = region.y0 + (j + 0.5) * cell - y
      for (let i = Math.max(0, cx - k); i <= Math.min(gw - 1, cx + k); i++) {
        const dx = region.x0 + (i + 0.5) * cell - x
        if (dx * dx + dy * dy <= d * d) reached[j * gw + i] = 1
      }
    }
  }
  for (let attempt = 0; attempt < 1000 && !xs.length; attempt++) {
    const x = region.x0 + rng() * w, y = region.y0 + rng() * h
    if (contains(region, x, y)) add(x, y)
  }
  let capped = false
  const grow = () => {
    while (active.length) {
      if (xs.length >= limit) { capped = true; return }
      const slot = Math.floor(rng() * active.length)
      const base = active[slot]
      const r = radius(xs[base], ys[base])
      let placed = false
      for (let t = 0; t < tries; t++) {
        const angle = rng() * Math.PI * 2, dist = r * (1 + rng())
        const x = xs[base] + Math.cos(angle) * dist, y = ys[base] + Math.sin(angle) * dist
        if (contains(region, x, y) && fits(x, y)) { add(x, y); placed = true; break }
      }
      if (!placed) { active[slot] = active[active.length - 1]; active.pop() }
    }
  }
  grow()
  // Growth only spreads to nearby spots, so it can't jump to a separate piece of an imported shape, and with
  // very few tries it can die out early. Start it again anywhere it hasn't reached. A normal fill reaches
  // everywhere, and the restarts use no random numbers, so its points stay exactly as they were.
  const restart = (x: number, y: number) => {
    if (reached[gy(y) * gw + gx(x)] || !contains(region, x, y) || !fits(x, y)) return false
    add(x, y); grow(); return true
  }
  for (let c = 0; c < gw * gh && !capped; c++) {
    const i = c % gw, j = (c - i) / gw
    if (!reached[c]) restart(region.x0 + (i + 0.5) * cell, region.y0 + (j + 0.5) * cell)
  }
  // A piece thinner than a grid cell can miss every cell centre, so try just inside each edge of the shape too,
  // wherever no point is within three times the spacing. That's farther than growth reaches, so a normal
  // fill's small gaps along the edge are left as they were.
  const far = (x: number, y: number) => {
    const d = 3 * radius(x, y), k = Math.ceil(d / cell), cx = gx(x), cy = gy(y)
    for (let j = Math.max(0, cy - k); j <= Math.min(gh - 1, cy + k); j++) {
      for (let i = Math.max(0, cx - k); i <= Math.min(gw - 1, cx + k); i++) {
        const q = grid[j * gw + i]
        if (q >= 0 && (xs[q] - x) ** 2 + (ys[q] - y) ** 2 < d * d) return false
      }
    }
    return true
  }
  for (const ring of region.rings ?? []) {
    for (let a = 0; a < ring.length && !capped; a++) {
      const [x0, y0] = ring[a], [x1, y1] = ring[(a + 1) % ring.length]
      const len = Math.hypot(x1 - x0, y1 - y0)
      if (!len) continue
      const nx = (y0 - y1) / len, ny = (x1 - x0) / len
      for (let t = Math.min(len / 2, cell / 2); t < len && !capped; t += cell) {
        const px = x0 + ((x1 - x0) * t) / len, py = y0 + ((y1 - y0) * t) / len
        if (reached[gy(py) * gw + gx(px)]) continue
        for (const d of [cell / 4, -cell / 4, cell / 16, -cell / 16]) {
          const x = px + nx * d, y = py + ny * d
          if (contains(region, x, y) && far(x, y) && fits(x, y)) { add(x, y); grow(); break }
        }
      }
    }
  }
  const points = new Float64Array(xs.length * 2)
  for (let i = 0; i < xs.length; i++) { points[i * 2] = xs[i]; points[i * 2 + 1] = ys[i] }
  return { points, capped, spacing }
}

function evenPoints(settings: SeedSettings, count: number, region: Region, rng: Rng, density: Field): SeedResult {
  const tries = Math.max(1, Math.min(100, Math.round(settings.tries)))
  if (!settings.autoSpacing) return poissonDisk(region, Math.max(1e-3, settings.spacing), tries, density, rng)
  // Pick the spacing that should give the count, then tighten it until there are enough points.
  const mass = integrateDensity(density.at, region, (x, y) => contains(region, x, y))
  let spacing = Math.sqrt((POISSON_FILL * 2 / Math.sqrt(3)) * mass / count)
  let best = poissonDisk(region, spacing, tries, density, rng, count * 3)
  // Thin shapes hold more points than their area suggests. A sample that hit the limit may have left pieces
  // unseeded, so widen the spacing until it fits.
  for (let round = 0; round < 6 && best.capped; round++) {
    spacing *= Math.SQRT2
    best = poissonDisk(region, spacing, tries, density, rng, count * 3)
  }
  for (let round = 0; round < 4 && best.points.length && best.points.length / 2 < count; round++) {
    spacing *= Math.sqrt((best.points.length / 2) / count) * 0.97
    best = poissonDisk(region, spacing, tries, density, rng, count * 3)
  }
  return { points: trim(best.points, count, rng), capped: false, spacing: best.spacing }
}

// Drop random points until the count is met. A sample that fell short is returned as it is.
function trim(points: Float64Array, count: number, rng: Rng): Float64Array {
  const n = points.length / 2
  if (n === count) return points
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const keep = order.slice(0, Math.min(n, count)).sort((a, b) => a - b)
  const out = new Float64Array(count * 2)
  keep.forEach((k, i) => { out[i * 2] = points[k * 2]; out[i * 2 + 1] = points[k * 2 + 1] })
  return keep.length === count ? out : out.slice(0, keep.length * 2)
}

// A grid that tiles the region exactly: half a spacing from each edge, so border cells match the rest.
// Columns and rows are whole numbers, so the spacing stretches slightly in x or y to fit.
type Grid = { cols: number; rows: number }
const gridSteps = (region: Region, { cols, rows }: Grid, hex: boolean) => [regionWidth(region) / (cols + (hex ? 0.5 : 0)), regionHeight(region) / rows]

function lattice(region: Region, grid: Grid, hex: boolean, visit?: (x: number, y: number) => void): number {
  const [sx, sy] = gridSteps(region, grid, hex)
  if (region.shape === 'rect' && !visit) return grid.cols * grid.rows
  let n = 0
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const x = region.x0 + sx / 2 + c * sx + (hex && r % 2 ? sx / 2 : 0), y = region.y0 + sy / 2 + r * sy
      if (!contains(region, x, y)) continue
      n++
      visit?.(x, y)
    }
  }
  return n
}

function gridPoints(settings: SeedSettings, count: number, region: Region, rng: Rng, hex: boolean): SeedResult {
  const w = regionWidth(region), h = regionHeight(region)
  const area = regionArea(region)
  const rowStep = hex ? Math.sqrt(3) / 2 : 1 // row spacing as a share of column spacing for regular cells
  let spacing = settings.autoSpacing ? Math.sqrt(area / (count * rowStep)) : Math.max(1e-3, settings.spacing)
  let capped = false
  const estimate = (s: number) => area / (rowStep * s * s)
  if (estimate(spacing) > MAX_POINTS) { spacing *= Math.sqrt(estimate(spacing) / MAX_POINTS) * 1.01; capped = true }
  const fit = (cols: number): Grid => ({ cols, rows: Math.max(1, Math.round(h / (rowStep * w / (cols + (hex ? 0.5 : 0))))) })
  let grid = fit(Math.max(1, Math.round(w / spacing - (hex ? 0.5 : 0))))
  if (settings.autoSpacing && !capped) {
    // Search nearby column and row counts for the closest count, preferring cells that stay regular.
    let best = Infinity
    const guess = grid.cols
    for (let cols = Math.max(1, Math.floor(guess * 0.7)); cols <= Math.ceil(guess * 1.3) + 1; cols++) {
      const base = fit(cols).rows
      for (let rows = Math.max(1, base - 1); rows <= base + 1; rows++) {
        const [sx, sy] = gridSteps(region, { cols, rows }, hex)
        const stretch = Math.abs(Math.log(sy / (sx * rowStep)))
        if (stretch > 0.15) continue
        const miss = Math.abs(lattice(region, { cols, rows }, hex) - count) + stretch * count * 0.05
        if (miss < best) { best = miss; grid = { cols, rows } }
      }
    }
  }
  const [sx] = gridSteps(region, grid, hex)
  const jitter = Math.max(0, Math.min(1, settings.jitter)) * sx * 0.5
  const xs: number[] = []
  lattice(region, grid, hex, (x, y) => {
    if (jitter > 0) {
      const angle = rng() * Math.PI * 2, dist = Math.sqrt(rng()) * jitter
      ;[x, y] = clampToRegion(region, x + Math.cos(angle) * dist, y + Math.sin(angle) * dist)
    }
    xs.push(x, y)
  })
  return { points: Float64Array.from(xs), capped, spacing: sx }
}
