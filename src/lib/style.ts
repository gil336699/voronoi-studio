import type { Segment } from '../voronoi/geometry'
// Fixed colours and sizes for the overlays, kept from the old Voronoi Lab so designs look the same.
import { regionArea, type Region } from '../voronoi/region'

export const DELAUNAY_COLOR = '#e3a2aa'
export const SITE_COLOR = '#111111'

// Site dots scale with the cells so they read at any count: about a fifteenth of the spacing.
export function siteRadius(region: Region, count: number): number {
  const spacing = Math.sqrt(regionArea(region) / Math.max(1, count))
  return Math.min(2, Math.max(0.1, spacing * 0.065))
}

// Inner edges grouped by width share (see Walls follow cell size), into six steps from 15 % to 100 %, so the
// view and the SVG draw a few paths instead of one per edge.
export function widthBuckets(segments: Segment[], widths: Float32Array): [number, Segment[]][] {
  const groups = new Map<number, Segment[]>()
  segments.forEach((seg, i) => {
    const level = Math.round(((Math.min(1, Math.max(0.15, widths[i])) - 0.15) / 0.85) * 5)
    const list = groups.get(level) ?? []
    list.push(seg); groups.set(level, list)
  })
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([level, list]) => [0.15 + (level / 5) * 0.85, list])
}
