// Lloyd relaxation: move each point to the centre of its cell, which evens out cell sizes. With a density
// gradient, the centre is weighted so the gradient survives relaxing. Relaxed patterns settle with point
// density proportional to the square root of the weight, so the weight is the density squared.
import { densityField, type DensitySettings } from './density'
import { buildCells } from './diagram'
import { centroid, type Polygon, type Vec } from './geometry'
import { clampToRegion, type Region } from './region'

export type RelaxResult = { points: Float64Array; maxMove: number }

function weightedCentroid(poly: Polygon, field: (x: number, y: number) => number): Vec {
  // Fan triangles from the first vertex. Each is integrated at its three edge midpoints, which is exact
  // for weights that vary quadratically across the triangle.
  const [ax, ay] = poly[0]
  let w = 0, cx = 0, cy = 0
  for (let i = 1; i < poly.length - 1; i++) {
    const [bx, by] = poly[i], [qx, qy] = poly[i + 1]
    const a = Math.abs((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 6
    for (const [mx, my] of [[(ax + bx) / 2, (ay + by) / 2], [(bx + qx) / 2, (by + qy) / 2], [(qx + ax) / 2, (qy + ay) / 2]]) {
      const d = field(mx, my)
      const k = a * d * d
      w += k; cx += mx * k; cy += my * k
    }
  }
  return w > 0 ? [cx / w, cy / w] : centroid(poly)
}

export function lloydStep(points: Float64Array, region: Region, density: DensitySettings): RelaxResult {
  const cells = buildCells(points, region)
  const weighted = density.mode !== 'none' && density.strength > 1
  const field = densityField(density, region)
  const out = new Float64Array(points.length)
  let maxMove = 0
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    let x = points[i * 2], y = points[i * 2 + 1]
    if (cell) [x, y] = clampToRegion(region, ...(weighted ? weightedCentroid(cell, field) : centroid(cell)))
    maxMove = Math.max(maxMove, Math.hypot(x - points[i * 2], y - points[i * 2 + 1]))
    out[i * 2] = x; out[i * 2 + 1] = y
  }
  return { points: out, maxMove }
}

export function relax(points: Float64Array, region: Region, density: DensitySettings, steps: number): RelaxResult {
  let result: RelaxResult = { points, maxMove: 0 }
  for (let i = 0; i < steps; i++) result = lloydStep(result.points, region, density)
  return result
}
