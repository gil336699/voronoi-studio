// Stretched cells: every point measures distance with the same ellipse instead of a circle (one Mahalanobis
// metric for all points, as in Feng et al. 2022, "Cellular topology optimization on differentiable Voronoi
// diagrams", Fig. 3B), so cells come out longer in one direction. That diagram is an ordinary Voronoi diagram
// in a work space squeezed along the stretch: squeeze the points and the region, build and clip the cells
// there, then stretch them back. The squeeze keeps areas, so counts, spacing and gradients mean the same, and
// edges stay straight, so holes, rounded corners and cut files work unchanged. A different ellipse per point
// would curve the edges, which cut files can't hold, so the stretch is the same everywhere.
import { ellipsePolygon, type Polygon, type Segment, type Vec } from './geometry'
import type { Cells } from './diagram'
import { regionCenter, regionHeight, regionWidth, type Region } from './region'
import { boxOf } from './shape'

// amount: how many times longer than wide a relaxed cell is (1 is off). angle: the long direction in degrees,
// 0 pointing right and 90 up.
export type Stretch = { amount: number; angle: number }
// The squeeze into work space is [[a, b], [b, c]] and its inverse [[ia, ib], [ib, ic]]. Both are symmetric
// with determinant 1. axis: b is exactly 0, so rectangles and ellipses stay rectangles and ellipses.
export type Frame = { a: number; b: number; c: number; ia: number; ib: number; ic: number; axis: boolean; key: string }

export const MAX_STRETCH = 5
const ELLIPSE_SEGMENTS = 256

export function stretchFrame(s?: Stretch | null): Frame | null {
  if (!s || !(s.amount > 1 + 1e-9) || !Number.isFinite(s.angle)) return null
  const r = Math.min(MAX_STRETCH, s.amount)
  const turn = ((s.angle % 180) + 180) % 180
  // The long direction, with y pointing down. Right angles are exact so the frame stays axis-aligned.
  const rad = (turn * Math.PI) / 180
  const [ux, uy] = turn === 0 ? [1, 0] : turn === 90 ? [0, -1] : [Math.cos(rad), -Math.sin(rad)]
  const k = 1 / Math.sqrt(r), K = Math.sqrt(r)
  // Squeeze by k along u and stretch by K across it: T = K·I + (k − K)·u·uᵀ, and T⁻¹ = k·I + (K − k)·u·uᵀ.
  return {
    a: K + (k - K) * ux * ux, b: (k - K) * ux * uy || 0, c: K + (k - K) * uy * uy, // || 0 turns −0 into 0
    ia: k + (K - k) * ux * ux, ib: (K - k) * ux * uy || 0, ic: k + (K - k) * uy * uy,
    axis: turn === 0 || turn === 90, key: `${r}|${turn}`,
  }
}

export const toWork = (f: Frame, x: number, y: number): Vec => [f.a * x + f.b * y, f.b * x + f.c * y]
export const toSheet = (f: Frame, x: number, y: number): Vec => [f.ia * x + f.ib * y, f.ib * x + f.ic * y]

export function pointsToWork(points: Float64Array, f: Frame): Float64Array {
  const out = new Float64Array(points.length)
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1]
    out[i] = f.a * x + f.b * y; out[i + 1] = f.b * x + f.c * y
  }
  return out
}

export function pointsToSheet(points: Float64Array, f: Frame): Float64Array {
  const out = new Float64Array(points.length)
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1]
    out[i] = f.ia * x + f.ib * y; out[i + 1] = f.ib * x + f.ic * y
  }
  return out
}

const ringTo = (ring: Polygon, map: (x: number, y: number) => Vec): Polygon => ring.map(([x, y]) => map(x, y))

export const cellsToSheet = (cells: Cells, f: Frame): Cells =>
  cells.map(cell => (cell ? cell.map(ring => ringTo(ring, (x, y) => toSheet(f, x, y))) : null))

export const segmentsToSheet = (segments: Segment[], f: Frame): Segment[] =>
  segments.map(([x0, y0, x1, y1]) => [...toSheet(f, x0, y0), ...toSheet(f, x1, y1)] as Segment)

// The region squeezed into work space. Squeezed outlines are kept, so the shape index built on them (which
// is cached by outline) is built once per region and stretch, not once per relax step.
const fromRings = new WeakMap<Polygon[], Map<string, Polygon[]>>()
const fromBoxes = new Map<string, Polygon[]>()
export function workRegion(region: Region, f: Frame): Region {
  if (f.axis && region.shape !== 'custom') {
    const [x0, y0] = toWork(f, region.x0, region.y0), [x1, y1] = toWork(f, region.x1, region.y1)
    return { shape: region.shape, x0, y0, x1, y1 }
  }
  let rings: Polygon[]
  if (region.shape === 'custom') {
    const source = region.rings ?? []
    let byFrame = fromRings.get(source)
    if (!byFrame) { byFrame = new Map(); fromRings.set(source, byFrame) }
    rings = byFrame.get(f.key) ?? source.map(ring => ringTo(ring, (x, y) => toWork(f, x, y)))
    byFrame.set(f.key, rings)
    if (!rings.length) { const [cx, cy] = toWork(f, ...regionCenter(region)); return { shape: 'custom', x0: cx, y0: cy, x1: cx, y1: cy, rings } }
  } else {
    const key = `${region.shape}|${region.x0}|${region.y0}|${region.x1}|${region.y1}|${f.key}`
    const cached = fromBoxes.get(key)
    if (cached) rings = cached
    else {
      const outline: Polygon = region.shape === 'rect'
        ? [[region.x0, region.y0], [region.x1, region.y0], [region.x1, region.y1], [region.x0, region.y1]]
        : ellipsePolygon(...regionCenter(region), regionWidth(region) / 2, regionHeight(region) / 2, ELLIPSE_SEGMENTS)
      rings = [ringTo(outline, (x, y) => toWork(f, x, y))]
      if (fromBoxes.size > 32) fromBoxes.clear()
      fromBoxes.set(key, rings)
    }
  }
  const [x0, y0, x1, y1] = boxOf(rings)
  return { shape: 'custom', x0, y0, x1, y1, rings }
}
