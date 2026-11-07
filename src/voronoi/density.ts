// Density gradients: where cells should be smaller. Density runs from 1 (largest cells) up to the
// strength (cells that many times smaller in area). It changes geometrically, so cell sizes step evenly.
import { regionCenter, regionHeight, regionWidth, type Region } from './region'

export type DensityMode = 'none' | 'linear' | 'radial'
export type DensitySettings = { mode: DensityMode; strength: number; angle: number; invert: boolean }
export type DensityField = (x: number, y: number) => number

export function densityField(settings: DensitySettings, region: Region): DensityField {
  const s = Math.max(1, settings.strength)
  if (settings.mode === 'none' || s === 1) return () => 1
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
  const rx = regionWidth(region) / 2, ry = regionHeight(region) / 2
  // A rectangle's corners are at distance 1; an ellipse's rim is at 1.
  const norm = region.shape === 'rect' ? Math.SQRT2 : 1
  return (x, y) => {
    const t = Math.min(1, Math.hypot((x - cx) / rx, (y - cy) / ry) / norm)
    return s ** (settings.invert ? t : 1 - t)
  }
}

// The area integral of the density over the region, sampled on a grid. Used to size spacing for a count.
export function integrateDensity(field: DensityField, region: Region, contains: (x: number, y: number) => boolean, samples = 64): number {
  const w = regionWidth(region), h = regionHeight(region)
  const dx = w / samples, dy = h / samples
  let sum = 0
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const x = region.x0 + (i + 0.5) * dx, y = region.y0 + (j + 0.5) * dy
      if (contains(x, y)) sum += field(x, y)
    }
  }
  return sum * dx * dy
}
