// Where the first points go. Four placements: random, even (Poisson-disk), hex grid and square grid.
// All of them are seeded, so the same settings and seed give the same points.
import { densityField, integrateDensity, type DensitySettings } from './density'
import { createRng, type Rng } from './random'
import { clampToRegion, contains, regionArea, regionHeight, regionWidth, type Region } from './region'

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
}
export type SeedResult = { points: Float64Array; capped: boolean }

export const MAX_POINTS = 20_000
// Bridson's method fills about this share of the hexagonal-packing count, so it sets the starting spacing.
const POISSON_FILL = 0.62

export function seedPoints(settings: SeedSettings, region: Region): SeedResult {
  const rng = createRng(settings.seed)
  const count = Math.max(2, Math.min(MAX_POINTS, Math.round(settings.count)))
  switch (settings.placement) {
    case 'random': return { points: randomPoints(count, region, settings.density, rng), capped: false }
    case 'even': return evenPoints(settings, count, region, rng)
    case 'hex': return gridPoints(settings, count, region, rng, true)
    case 'square': return gridPoints(settings, count, region, rng, false)
  }
}

// The average spacing that a count of points would have in a region, used for auto sizes and readouts.
export function typicalSpacing(region: Region, count: number): number {
  return Math.sqrt(regionArea(region) / Math.max(1, count))
}

function randomPoints(count: number, region: Region, density: DensitySettings, rng: Rng): Float64Array {
  const field = densityField(density, region)
  const top = Math.max(1, density.mode === 'none' ? 1 : density.strength)
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
export function poissonDisk(region: Region, spacing: number, tries: number, density: DensitySettings, rng: Rng, limit = MAX_POINTS): SeedResult {
  const field = densityField(density, region)
  const top = Math.max(1, density.mode === 'none' ? 1 : density.strength)
  const radius = (x: number, y: number) => spacing / Math.sqrt(field(x, y))
  const rMin = spacing / Math.sqrt(top), rMax = spacing
  const cell = rMin / Math.SQRT2
  const w = regionWidth(region), h = regionHeight(region)
  const gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell))
  if (gw * gh > 40_000_000) return poissonDisk(region, spacing * 2, tries, density, rng, limit) // keeps memory bounded
  const grid = new Int32Array(gw * gh).fill(-1)
  const reach = Math.ceil(rMax / cell)
  const xs: number[] = [], ys: number[] = [], active: number[] = []
  const gx = (x: number) => Math.min(gw - 1, Math.floor((x - region.x0) / cell))
  const gy = (y: number) => Math.min(gh - 1, Math.floor((y - region.y0) / cell))
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
  const add = (x: number, y: number) => {
    grid[gy(y) * gw + gx(x)] = xs.length
    active.push(xs.length); xs.push(x); ys.push(y)
  }
  for (let attempt = 0; attempt < 1000 && !xs.length; attempt++) {
    const x = region.x0 + rng() * w, y = region.y0 + rng() * h
    if (contains(region, x, y)) add(x, y)
  }
  let capped = false
  while (active.length) {
    if (xs.length >= limit) { capped = true; break }
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
  const points = new Float64Array(xs.length * 2)
  for (let i = 0; i < xs.length; i++) { points[i * 2] = xs[i]; points[i * 2 + 1] = ys[i] }
  return { points, capped }
}

function evenPoints(settings: SeedSettings, count: number, region: Region, rng: Rng): SeedResult {
  const tries = Math.max(1, Math.min(100, Math.round(settings.tries)))
  if (!settings.autoSpacing) return poissonDisk(region, Math.max(1e-3, settings.spacing), tries, settings.density, rng)
  // Pick the spacing that should give the count, then tighten it until there are enough points.
  const field = densityField(settings.density, region)
  const mass = integrateDensity(field, region, (x, y) => contains(region, x, y))
  let spacing = Math.sqrt((POISSON_FILL * 2 / Math.sqrt(3)) * mass / count)
  let best = poissonDisk(region, spacing, tries, settings.density, rng, count * 3)
  for (let round = 0; round < 4 && best.points.length / 2 < count; round++) {
    spacing *= Math.sqrt((best.points.length / 2) / count) * 0.97
    best = poissonDisk(region, spacing, tries, settings.density, rng, count * 3)
  }
  return { points: trim(best.points, count, rng), capped: false }
}

// Drop random points until the count is met, or top up with random points if a sample fell short.
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

function gridPoints(settings: SeedSettings, count: number, region: Region, rng: Rng, hex: boolean): SeedResult {
  const w = regionWidth(region), h = regionHeight(region)
  const area = regionArea(region)
  let spacing = settings.autoSpacing
    ? (hex ? Math.sqrt((2 * area) / (Math.sqrt(3) * count)) : Math.sqrt(area / count))
    : Math.max(1e-3, settings.spacing)
  let capped = false
  const estimate = (s: number) => area / (hex ? (Math.sqrt(3) / 2) * s * s : s * s)
  if (estimate(spacing) > MAX_POINTS) { spacing *= Math.sqrt(estimate(spacing) / MAX_POINTS) * 1.01; capped = true }
  const dy = hex ? spacing * (Math.sqrt(3) / 2) : spacing
  const cols = Math.max(1, Math.floor(w / spacing)), rows = Math.max(1, Math.floor(h / dy))
  // Centre the lattice so the margins are equal on both sides.
  const ox = region.x0 + (w - (cols - 1) * spacing - (hex ? spacing / 2 : 0)) / 2
  const oy = region.y0 + (h - (rows - 1) * dy) / 2
  const jitter = Math.max(0, Math.min(1, settings.jitter)) * spacing * 0.5
  const xs: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols + (hex ? 1 : 0); c++) {
      let x = ox + c * spacing + (hex && r % 2 ? spacing / 2 : 0)
      let y = oy + r * dy
      if (hex && (x < region.x0 || x > region.x1)) continue
      if (!contains(region, x, y)) continue
      if (jitter > 0) {
        const angle = rng() * Math.PI * 2, dist = Math.sqrt(rng()) * jitter
        ;[x, y] = clampToRegion(region, x + Math.cos(angle) * dist, y + Math.sin(angle) * dist)
      }
      xs.push(x, y)
    }
  }
  return { points: Float64Array.from(xs), capped }
}
