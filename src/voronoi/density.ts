// Density gradients: where cells should be smaller. Density runs from 1 (largest cells) up to the
// strength (cells that many times smaller in area). It changes geometrically, so cell sizes step evenly.
// Linear and radial gradients follow the pattern area; a picture follows the sheet (see picture.ts).
import { pictureDensityAt, pictureGrid, type PictureGrid, type PictureSettings } from './picture'
import { regionArea, regionCenter, regionHeight, regionWidth, type Region } from './region'

export type DensityMode = 'none' | 'linear' | 'radial' | 'picture'
// picture: set when the mode is 'picture' and a picture is loaded.
export type DensitySettings = { mode: DensityMode; strength: number; angle: number; invert: boolean; picture?: PictureSettings | null }
export type DensityField = (x: number, y: number) => number

// Whether the density is the same everywhere, as with no gradient, strength 1, or Picture with none loaded.
export function uniformDensity(settings: DensitySettings): boolean {
  return settings.mode === 'none' || settings.strength <= 1 || (settings.mode === 'picture' && !settings.picture)
}

// The highest density anywhere, for rejection sampling.
export const densityPeak = (settings: DensitySettings) => (uniformDensity(settings) ? 1 : settings.strength)

// The picture's density grid, or null for the other gradients.
export function densityPicture(settings: DensitySettings): PictureGrid | null {
  return settings.mode === 'picture' && settings.picture && !uniformDensity(settings) ? pictureGrid(settings.picture, settings.strength) : null
}

export function densityField(settings: DensitySettings, region: Region): DensityField {
  const s = Math.max(1, settings.strength)
  if (uniformDensity(settings)) return () => 1
  const grid = densityPicture(settings)
  if (grid) return (x, y) => pictureDensityAt(grid, x, y)
  const [cx, cy] = regionCenter(region)
  if (settings.mode === 'linear') {
    // Angle 0° points right and 90° points up. Cells get smaller toward that direction.
    const rad = (settings.angle * Math.PI) / 180
    const ux = Math.cos(rad), uy = -Math.sin(rad)
    const corners = [[region.x0, region.y0], [region.x1, region.y0], [region.x0, region.y1], [region.x1, region.y1]]
    const ts = corners.map(([x, y]) => x * ux + y * uy)
    const lo = Math.min(...ts), span = Math.max(1e-9, Math.max(...ts) - lo)
    return (x, y) => s ** Math.min(1, Math.max(0, (x * ux + y * uy - lo) / span))
  }
  const rx = Math.max(1e-9, regionWidth(region) / 2), ry = Math.max(1e-9, regionHeight(region) / 2)
  // Scaled so the farthest point of the sheet is at 1: a rectangle's corners, an ellipse's rim, or a custom
  // shape's farthest outline point.
  let norm = 1
  if (region.shape === 'rect') norm = Math.SQRT2
  else if (region.shape === 'custom') {
    norm = 1e-9
    for (const ring of region.rings ?? []) for (const [x, y] of ring) norm = Math.max(norm, Math.hypot((x - cx) / rx, (y - cy) / ry))
  }
  return (x, y) => {
    const t = Math.min(1, Math.hypot((x - cx) / rx, (y - cy) / ry) / norm)
    return s ** (settings.invert ? t : 1 - t)
  }
}

// The area integral of the density over the region, sampled on a grid. Used to size spacing for a count.
export function integrateDensity(field: DensityField, region: Region, contains: (x: number, y: number) => boolean, samples = 64): number {
  const w = regionWidth(region), h = regionHeight(region)
  const dx = w / samples, dy = h / samples
  let sum = 0, all = 0
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const x = region.x0 + (i + 0.5) * dx, y = region.y0 + (j + 0.5) * dy
      const d = field(x, y)
      all += d
      if (contains(x, y)) sum += d
    }
  }
  if (sum > 0) return sum * dx * dy
  // Strokes thinner than the sample spacing can miss every sample. Then use the exact area, at the field's
  // average density, so a thin shape still gets a spacing instead of zero.
  return regionArea(region) * (all / (samples * samples))
}
