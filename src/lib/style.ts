// Fixed colours and sizes for the overlays, kept from the old Voronoi Lab so designs look the same.
import { regionArea, type Region } from '../voronoi/region'

export const DELAUNAY_COLOR = '#e3a2aa'
export const SITE_COLOR = '#111111'

// Site dots scale with the cells so they read at any count: about a fifteenth of the spacing.
export function siteRadius(region: Region, count: number): number {
  const spacing = Math.sqrt(regionArea(region) / Math.max(1, count))
  return Math.min(2, Math.max(0.1, spacing * 0.065))
}
