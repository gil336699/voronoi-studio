// What a cutter should follow, shared by the laser SVG and the DXF. Like the other exports, cut files hold
// what the view shows: cell cuts while Edges or Holes is on, and sites and Delaunay lines while those are on.
// Each line appears once. Marks come first, then holes, then the outer outline, so parts don't drop out of
// the sheet before their holes are cut. A custom sheet's own holes count as inner cuts; they follow
// "Include the sheet outline", like the outside edge.
import type { Segment } from '../voronoi/geometry'
import type { Outline } from '../voronoi/holes'
import type { Geometry } from '../voronoi/pattern'
import { splitHoles, type Region } from '../voronoi/region'
import { boxOf } from '../voronoi/shape'
import type { Settings } from './settings'
import { siteRadius } from './style'

export type CutSettings = Pick<Settings, 'cellStyle' | 'border' | 'sheetOutline' | 'showEdges' | 'showSites' | 'showDelaunay'>
export type CutPaths = {
  lines: Segment[]; outlines: Outline[]; inner: Region[]; outer: Region[]
  // Marks, each on its own layer and colour, so laser software can score, engrave or skip them.
  delaunay: Segment[]
  sites: { points: Float64Array; r: number } | null
}

// Edges between points that lie almost on one circle, or clipped right at an imported outline, can be a few
// microns long or less. As cuts they'd only make a laser fire a dot, so cut files leave out anything under 5 µm.
const MIN_CUT = 0.005
const cuttable = (segments: Segment[]) => segments.filter(([x0, y0, x1, y1]) => Math.hypot(x1 - x0, y1 - y0) >= MIN_CUT)

export function cutPaths(g: Geometry, points: Float64Array, s: CutSettings): CutPaths {
  const sheet = splitHoles(g.sheet)
  const outer = s.sheetOutline ? [sheet.outer] : []
  const sheetHoles = s.sheetOutline && sheet.holes ? [sheet.holes] : []
  const delaunay = s.showDelaunay ? cuttable(g.delaunay) : []
  const sites = s.showSites && points.length ? { points, r: siteRadius(g.region, points.length / 2) } : null
  const marks = { delaunay, sites }
  if (!s.showEdges) return { lines: [], outlines: [], inner: sheetHoles, outer, ...marks }
  if (s.cellStyle === 'holes') return { lines: [], outlines: g.holes.map(h => h.outline), inner: sheetHoles, outer, ...marks }
  // The pattern's outline is its own cut when a border separates it from the sheet edge.
  // With veins, the veins' outline is cut too: it's part of the pattern's outline, and on its own when the
  // pattern reaches the sheet edge.
  const veins: Region[] = g.veins.length && !(s.border > 1e-9 || !s.sheetOutline)
    ? [(() => { const [x0, y0, x1, y1] = boxOf(g.veins); return { shape: 'custom' as const, x0, y0, x1, y1, rings: g.veins } })()] : []
  const inner = s.border > 1e-9 || !s.sheetOutline ? [g.region] : veins
  return { lines: cuttable(g.edges.internal), outlines: [], inner: [...inner, ...sheetHoles], outer, ...marks }
}

// The parts a cut file will hold, in plain words, for the File tab. Empty when there's nothing to cut.
export function cutContents(s: CutSettings): string[] {
  const parts: string[] = []
  if (s.showEdges) parts.push(s.cellStyle === 'holes' ? 'holes' : 'cell edges')
  if (s.showSites) parts.push('sites')
  if (s.showDelaunay) parts.push('Delaunay lines')
  if (s.sheetOutline) parts.push('the sheet outline')
  return parts
}

// Which layer holds what, for the File tab. `sheetHoles`: the sheet is an imported shape with holes.
export function cutLayers(s: CutSettings, sheetHoles: boolean): string[] {
  const inner = s.showEdges ? (s.cellStyle === 'holes' ? 'holes' : 'cell edges') : s.sheetOutline && sheetHoles ? "the shape's holes" : ''
  return [
    inner && `CUT_INNER for ${inner}`,
    s.sheetOutline && 'CUT_OUTER for the outline',
    s.showSites && 'SITES (green) for sites',
    s.showDelaunay && 'DELAUNAY (magenta) for Delaunay lines',
  ].filter((part): part is string => Boolean(part))
}

// "a", "a and b", "a, b and c".
export function listWords(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

// Numbers for files: millimetres to a thousandth, without trailing zeros.
export function num(value: number, digits = 3): string {
  const text = value.toFixed(digits)
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text
  return trimmed === '-0' ? '0' : trimmed
}
