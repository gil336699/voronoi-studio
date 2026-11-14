// Lloyd relaxation: move each point to the centre of its cell, which evens out cell sizes. With a density
// gradient, the centre is weighted so the gradient survives relaxing. Relaxed patterns settle with point
// density proportional to the square root of the weight, so the weight is the density squared.
import { densityField, densityPicture, uniformDensity, type DensitySettings } from './density'
import { buildCells, cellCentroid, fieldMetric, partOf, regionParts, type Cell } from './diagram'
import { metricCentroid } from './field'
import type { Vec } from './geometry'
import { pictureCentroid } from './picture'
import { clampToRegion, contains, type Region } from './region'
import { varyingField, type Stretch } from './stretch'

// settleMove: what Auto-relax compares with its tolerance. The largest move, except with a field (see lloydStep).
export type RelaxResult = { points: Float64Array; maxMove: number; settleMove?: number }

function weightedCentroid(cell: Cell, field: (x: number, y: number) => number): Vec {
  // Fan triangles from each ring's first vertex, with signed areas so concave pieces and holes come out
  // right. Each triangle is integrated at its three edge midpoints, which is exact for weights that vary
  // quadratically across it.
  let w = 0, cx = 0, cy = 0
  for (const poly of cell) {
    const [ax, ay] = poly[0]
    for (let i = 1; i < poly.length - 1; i++) {
      const [bx, by] = poly[i], [qx, qy] = poly[i + 1]
      const a = ((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 6
      for (const [mx, my] of [[(ax + bx) / 2, (ay + by) / 2], [(bx + qx) / 2, (by + qy) / 2], [(qx + ax) / 2, (qy + ay) / 2]]) {
        const d = field(mx, my)
        const k = a * d * d
        w += k; cx += mx * k; cy += my * k
      }
    }
  }
  return w > 0 ? [cx / w, cy / w] : cellCentroid(cell)
}

// With a stretch, the cells are measured with its ellipse, but each point still moves to its cell's centre:
// that is what lowers the energy for any fixed ellipse.
export function lloydStep(points: Float64Array, region: Region, density: DensitySettings, stretch?: Stretch | null): RelaxResult {
  const cells = buildCells(points, region, stretch)
  const weighted = !uniformDensity(density)
  const field = densityField(density, region)
  // A picture's pixels are integrated exactly; the smooth gradients are sampled.
  const picture = densityPicture(density)
  // With a field stretch, the target minimises distance measured by each place's own ellipse (see field.ts).
  const varying = varyingField(stretch)
  const grid = varying ? fieldMetric(varying, region, points.length / 2) : null
  const weight = weighted ? (x: number, y: number) => { const d = field(x, y); return d * d } : () => 1
  const centre = (cell: Cell): Vec => grid ? metricCentroid(cell, grid, weight) ?? cellCentroid(cell)
    : picture ? pictureCentroid(cell, picture) ?? cellCentroid(cell) : weighted ? weightedCentroid(cell, field) : cellCentroid(cell)
  const out = new Float64Array(points.length)
  // With veins, each point stays in its own piece between them.
  const parts = regionParts(region), owner = parts ? partOf(points, parts) : null
  let maxMove = 0
  const moves = grid ? new Float64Array(cells.length) : null
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    let x = points[i * 2], y = points[i * 2 + 1]
    if (cell) {
      const [tx, ty] = centre(cell)
      const home = parts && owner ? parts[owner[i]] : region
      // A piece of a cell that wraps a concave edge can have its centre outside the shape.
      ;[x, y] = home.shape === 'custom' && contains(home, tx, ty) ? [tx, ty] : clampToRegion(home, tx, ty)
    }
    const move = Math.hypot(x - points[i * 2], y - points[i * 2 + 1])
    maxMove = Math.max(maxMove, move)
    if (moves) moves[i] = move
    out[i * 2] = x; out[i * 2 + 1] = y
  }
  // With a field, a few points keep trading a little area with a neighbour where two triangles are close to
  // swapping diagonals, so the largest move never falls to Auto-relax's tolerance (a 2,000th of the spacing).
  // There it settles once 99 % of points move less than a 100th of the spacing: a 20th of the 99th percentile.
  if (moves && moves.length) { moves.sort(); return { points: out, maxMove, settleMove: moves[Math.floor((moves.length - 1) * 0.99)] / 20 } }
  return { points: out, maxMove }
}

export function relax(points: Float64Array, region: Region, density: DensitySettings, steps: number, stretch?: Stretch | null): RelaxResult {
  let result: RelaxResult = { points, maxMove: 0 }
  for (let i = 0; i < steps; i++) result = lloydStep(result.points, region, density, stretch)
  return result
}
