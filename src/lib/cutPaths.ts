// What a cutter should follow, shared by the laser SVG and the DXF: each line once, holes before the
// outer outline so parts don't drop out of the sheet before their holes are cut.
import type { Segment } from '../voronoi/geometry'
import type { Outline } from '../voronoi/holes'
import type { Geometry } from '../voronoi/pattern'
import type { Region } from '../voronoi/region'
import type { Settings } from './settings'

export type CutPaths = { lines: Segment[]; outlines: Outline[]; inner: Region[]; outer: Region[] }

export function cutPaths(g: Geometry, s: Pick<Settings, 'cellStyle' | 'border' | 'sheetOutline'>): CutPaths {
  const outer = s.sheetOutline ? [g.sheet] : []
  if (s.cellStyle === 'holes') return { lines: [], outlines: g.holes.map(h => h.outline), inner: [], outer }
  // The pattern's outline is its own cut when a border separates it from the sheet edge.
  const inner = s.border > 1e-9 || !s.sheetOutline ? [g.region] : []
  return { lines: g.edges.internal, outlines: [], inner, outer }
}

// Numbers for files: millimetres to a thousandth, without trailing zeros.
export function num(value: number, digits = 3): string {
  const text = value.toFixed(digits)
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text
  return trimmed === '-0' ? '0' : trimmed
}
