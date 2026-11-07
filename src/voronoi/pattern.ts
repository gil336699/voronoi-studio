// Everything drawn or exported for one design, built from the points and the settings in one place, so the
// preview, the PNG, the SVGs and the DXF always agree.
import { buildCells, delaunayEdges, uniqueEdges, type Cells } from './diagram'
import { area, segmentLength, type Segment } from './geometry'
import { makeHole, type Hole } from './holes'
import { insetRegion, regionPerimeter, sheetRegion, type Region, type Shape } from './region'

export type CellStyle = 'lines' | 'holes'
export type PatternSettings = {
  width: number; height: number; shape: Shape; border: number
  cellStyle: CellStyle; web: number; cornerRadius: number; minHole: number
  showDelaunay: boolean
}
export type Metrics = {
  cells: number; holes: number; dropped: number
  meanSize: number // diameter of a circle with the mean cell area, mm
  evenness: number // coefficient of variation of cell areas, 0–1
  narrowest: number // narrowest kept hole, mm (holes style)
  shortestEdge: number // shortest inner edge, mm (lines style)
  cutLength: number // all cut lines including the sheet outline, mm
}
export type Geometry = {
  sheet: Region
  region: Region
  cells: Cells
  edges: { internal: Segment[]; boundary: Segment[] }
  holes: Hole[]
  delaunay: Segment[]
  metrics: Metrics
}

// The region cells fill. In Holes style the region reaches half a web past the border, so after the holes
// shrink by half a web the solid frame is exactly the border.
export function patternRegion(s: Pick<PatternSettings, 'width' | 'height' | 'shape' | 'border' | 'cellStyle' | 'web'>): Region {
  const inset = s.cellStyle === 'holes' ? Math.max(0, s.border - s.web / 2) : s.border
  return insetRegion(sheetRegion(s.width, s.height, s.shape), inset)
}

export function buildGeometry(points: Float64Array, s: PatternSettings): Geometry {
  const sheet = sheetRegion(s.width, s.height, s.shape)
  const region = patternRegion(s)
  const cells = buildCells(points, region)
  const edges = uniqueEdges(cells)
  const holes: Hole[] = []
  let dropped = 0
  if (s.cellStyle === 'holes') {
    cells.forEach((cell, i) => {
      if (!cell) return
      const hole = makeHole(cell, i, { web: s.web, radius: s.cornerRadius, minHole: s.minHole })
      if (hole) holes.push(hole)
      else dropped++
    })
  }
  const delaunay = s.showDelaunay ? delaunayEdges(points, region) : []
  return { sheet, region, cells, edges, holes, delaunay, metrics: measure(cells, edges, holes, dropped, sheet, region, s) }
}

function measure(cells: Cells, edges: Geometry['edges'], holes: Hole[], dropped: number, sheet: Region, region: Region, s: PatternSettings): Metrics {
  const areas = cells.flatMap(cell => (cell ? [area(cell)] : []))
  const mean = areas.length ? areas.reduce((a, b) => a + b, 0) / areas.length : 0
  const sd = areas.length ? Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length) : 0
  let cutLength = regionPerimeter(sheet)
  let shortestEdge = 0, narrowest = 0
  if (s.cellStyle === 'holes') {
    for (const hole of holes) cutLength += hole.length
    narrowest = holes.length ? Math.min(...holes.map(h => h.width)) : 0
  } else {
    let shortest = Infinity
    for (const e of edges.internal) { const l = segmentLength(e); cutLength += l; shortest = Math.min(shortest, l) }
    // The pattern's own outline is a cut too, unless it sits right on the sheet edge.
    if (s.border > 1e-9) cutLength += regionPerimeter(region)
    shortestEdge = Number.isFinite(shortest) ? shortest : 0
  }
  return {
    cells: areas.length, holes: holes.length, dropped,
    meanSize: 2 * Math.sqrt(mean / Math.PI),
    evenness: mean > 0 ? sd / mean : 0,
    narrowest, shortestEdge, cutLength,
  }
}
