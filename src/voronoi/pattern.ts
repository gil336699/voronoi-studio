// Everything drawn or exported for one design, built from the points and the settings in one place, so the
// preview, the PNG, the SVGs and the DXF always agree.
import { buildDiagram, cellArea, cellCentroid, delaunayEdges, type Cells } from './diagram'
import { segmentLength, type Segment } from './geometry'
import { makeHoles, type Hole } from './holes'
import { insetRegion, regionPerimeter, sheetRegion, type Region, type Shape } from './region'
import type { CustomShape } from './shape'
import type { Polygon } from './geometry'
import { veinedRegion, type VeinStart, type VeinStyle } from './veins'
import type { Stretch } from './stretch'

export type CellStyle = 'lines' | 'holes'
export type PatternSettings = {
  width: number; height: number; shape: Shape; customShape: CustomShape | null; border: number
  cellStyle: CellStyle; web: number; cornerRadius: number; minHole: number
  showDelaunay: boolean
  stretch?: number; stretchAngle?: number // see stretch.ts; 1 or none is off
  // Veins (see veins.ts). veinLines: imported veins, scaled 0–1 to the sheet's box. veinTaper: 0–90 %.
  veins?: VeinStyle; veinCount?: number; veinStart?: VeinStart; veinWidth?: number; veinTaper?: number; veinLines?: ImportedVeins | null
  // 0–100 %: walls between smaller cells get thinner (Holes webs, and lines in the view, PNG and artwork SVG).
  wallsFollow?: number
}
// Open lines from an SVG, as flat x, y pairs scaled to the sheet's box (0–1).
export type ImportedVeins = { name: string; lines: number[][] }
export type Metrics = {
  cells: number; holes: number; dropped: number // dropped: cells too small for a hole
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
  // widths: with Walls follow cell size, each inner edge's width as a share of the line width (0.15–1).
  edges: { internal: Segment[]; widths?: Float32Array }
  veins: Polygon[] // the veins' outline, inside the pattern (see veins.ts)
  holes: Hole[]
  delaunay: Segment[]
  metrics: Metrics
}

// The region cells fill. In Holes style the region reaches half a web past the border, so after the holes
// shrink by half a web the solid frame is exactly the border.
type RegionSettings = Pick<PatternSettings, 'width' | 'height' | 'shape' | 'customShape' | 'border' | 'cellStyle' | 'web'>
  & Partial<Pick<PatternSettings, 'veins' | 'veinCount' | 'veinStart' | 'veinWidth' | 'veinTaper' | 'veinLines'>>
export function patternRegion(s: RegionSettings): Region {
  const inset = s.cellStyle === 'holes' ? Math.max(0, s.border - s.web / 2) : s.border
  const region = insetRegion(sheetRegion(s.width, s.height, s.shape, s.customShape), inset)
  if (!s.veins || s.veins === 'none') return region
  return veinedRegion(region, {
    style: s.veins, count: s.veinCount ?? 8, start: s.veinStart ?? 'left', width: s.veinWidth ?? 1, taper: (s.veinTaper ?? 0) / 100,
    lines: s.veins === 'imported' && s.veinLines ? veinLinesAt(s.veinLines, s.width, s.height) : null,
  })
}

// Imported veins at a sheet size, cached so the same size gives the same arrays (the vein cache keys on them).
const scaledLines = new WeakMap<ImportedVeins, { w: number; h: number; lines: Polygon[] }>()
export function veinLinesAt(v: ImportedVeins, width: number, height: number): Polygon[] {
  const hit = scaledLines.get(v)
  if (hit && hit.w === width && hit.h === height) return hit.lines
  const lines = v.lines.map(flat => { const out: Polygon = []; for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i] * width, flat[i + 1] * height]); return out })
  scaledLines.set(v, { w: width, h: height, lines })
  return lines
}

export function buildGeometry(points: Float64Array, s: PatternSettings): Geometry {
  const sheet = sheetRegion(s.width, s.height, s.shape, s.customShape)
  const region = patternRegion(s)
  const stretch: Stretch | null = (s.stretch ?? 1) > 1 ? { amount: s.stretch ?? 1, angle: s.stretchAngle ?? 0 } : null
  const { cells, internal } = buildDiagram(points, region, stretch)
  // Walls follow cell size: each cell's walls scale with its size against the larger cells', to a power of
  // 0–1, so at 100 % a cell half as wide has walls half as thick (down to 15 %).
  const follow = Math.max(0, Math.min(1, (s.wallsFollow ?? 0) / 100))
  const share = follow > 0 ? wallShares(cells, follow) : null
  const edges: Geometry['edges'] = { internal, widths: share && s.cellStyle !== 'holes' ? edgeShares(internal, cells, share) : undefined }
  const holes: Hole[] = []
  let dropped = 0
  if (s.cellStyle === 'holes') {
    const settings = { web: s.web, radius: s.cornerRadius, minHole: s.minHole }
    cells.forEach((cell, i) => {
      if (!cell) return
      const made = makeHoles(cell, i, share ? { ...settings, web: s.web * share[i] } : settings)
      if (made.length) holes.push(...made)
      else dropped++
    })
  }
  const delaunay = s.showDelaunay ? delaunayEdges(points, region, stretch) : []
  return { sheet, region, cells, edges, holes, delaunay, veins: region.veins ?? [], metrics: measure(cells, edges, holes, dropped, sheet, region, s) }
}

// Each cell's wall share: (its size / the size of the larger cells) to the power `follow`, from 15 % to 100 %.
// "Larger" is the 90th percentile, so one oversized cell doesn't thin everything else.
function wallShares(cells: Cells, follow: number): Float32Array {
  const sizes = cells.map(c => (c ? Math.sqrt(Math.max(0, cellArea(c))) : 0))
  const sorted = sizes.filter(v => v > 0).sort((a, b) => a - b)
  const ref = sorted[Math.floor(sorted.length * 0.9)] || 1
  return Float32Array.from(sizes, v => Math.min(1, Math.max(0.15, (v / ref) ** follow)))
}

// An inner edge's share: the mean of the two cells it separates, found as the cells whose centres are nearest
// its middle, through a grid of cell centres.
function edgeShares(edges: Segment[], cells: Cells, share: Float32Array): Float32Array {
  const centres = cells.map(c => (c ? cellCentroid(c) : null))
  const live = centres.filter(Boolean).length || 1
  const xs = centres.flatMap(c => (c ? [c[0]] : [])), ys = centres.flatMap(c => (c ? [c[1]] : []))
  const x0 = Math.min(...xs), y0 = Math.min(...ys), span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1e-9)
  const cell = span / Math.max(1, Math.sqrt(live)) * 1.5
  const grid = new Map<string, number[]>()
  centres.forEach((c, i) => { if (!c) return; const k = `${Math.floor((c[0] - x0) / cell)},${Math.floor((c[1] - y0) / cell)}`; const l = grid.get(k) ?? []; l.push(i); grid.set(k, l) })
  return Float32Array.from(edges, ([ax, ay, bx, by]) => {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, gx = Math.floor((mx - x0) / cell), gy = Math.floor((my - y0) / cell)
    let a = -1, b = -1, da = Infinity, db = Infinity
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
      const c = centres[i]!, d = Math.hypot(c[0] - mx, c[1] - my)
      if (d < da) { db = da; b = a; da = d; a = i } else if (d < db) { db = d; b = i }
    }
    return a < 0 ? 1 : b < 0 ? share[a] : (share[a] + share[b]) / 2
  })
}

function measure(cells: Cells, edges: Geometry['edges'], holes: Hole[], dropped: number, sheet: Region, region: Region, s: PatternSettings): Metrics {
  const areas = cells.flatMap(cell => (cell ? [cellArea(cell)] : []))
  const mean = areas.length ? areas.reduce((a, b) => a + b, 0) / areas.length : 0
  const sd = areas.length ? Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length) : 0
  let cutLength = regionPerimeter(sheet)
  let shortestEdge = 0, narrowest = 0
  if (s.cellStyle === 'holes') {
    for (const hole of holes) cutLength += hole.length
    narrowest = holes.reduce((m, h) => Math.min(m, h.width), holes.length ? Infinity : 0)
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
