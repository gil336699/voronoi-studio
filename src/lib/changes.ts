// The rules for what a settings change does to the points, kept pure so they can be tested:
// - pattern settings (count, placement, seed…) make a new pattern, unless points were edited by hand,
//   in which case the change waits ("stale") until the person applies it;
// - sheet changes stretch the points to fit when "Keep points" is on, and make a new pattern when it is off;
// - style changes never touch the points, except to keep them inside a region that moved slightly;
// - switching to or from an imported shape makes a new pattern like a pattern setting does, since points
//   stretched from a box into an arbitrary outline would bunch up along it.
import { patternRegion } from '../voronoi/pattern'
import { mapBetween, type Region } from '../voronoi/region'
import type { Design } from './project'
import { SEED_KEYS, SHEET_KEYS, type Settings } from './settings'

export type Doc = Design & { stale: boolean }

const LENGTH_KEYS = ['width', 'height', 'border', 'spacing', 'web', 'cornerRadius', 'minHole', 'lineWidth'] as const

const sameRegion = (a: Region, b: Region) => a.shape === b.shape && a.rings === b.rings
  && [a.x0 - b.x0, a.y0 - b.y0, a.x1 - b.x1, a.y1 - b.y1].every(d => Math.abs(d) < 1e-9)
const outline = (s: Settings) => (s.shape === 'custom' ? s.customShape : s.shape)

export function mapPoints(points: Float64Array, from: Region, to: Region): Float64Array {
  const out = new Float64Array(points.length)
  for (let i = 0; i < points.length; i += 2) [out[i], out[i + 1]] = mapBetween(from, to, points[i], points[i + 1])
  return out
}

export function planChange(prev: Doc, patch: Partial<Settings>): { next: Doc; remake: boolean } {
  let settings = { ...prev.settings, ...patch }
  // Pixel sheets keep their pixel size when pixels per inch changes, so every length scales with it.
  if (patch.dpi !== undefined && prev.settings.units === 'px' && patch.dpi !== prev.settings.dpi) {
    const k = prev.settings.dpi / patch.dpi
    settings = { ...settings, ...Object.fromEntries(LENGTH_KEYS.map(name => [name, prev.settings[name] * k])) }
    return { next: { ...prev, settings, points: prev.points.map(v => v * k) }, remake: false }
  }
  const changed = (keys: (keyof Settings)[]) => keys.some(k => settings[k] !== prev.settings[k])
  const seedChanged = changed(SEED_KEYS) || (outline(settings) !== outline(prev.settings) && (settings.shape === 'custom' || prev.settings.shape === 'custom'))
  const sheetChanged = changed(SHEET_KEYS)
  const from = patternRegion(prev.settings), to = patternRegion(settings)
  let stale = prev.stale, remake = false
  // Points can only be kept from a pattern area that had room for them: after a border that left none,
  // a sheet change makes a pattern.
  const keep = settings.keepPoints && !(from.shape === 'custom' && !from.rings?.length)
  if (seedChanged || (sheetChanged && !keep)) {
    if (prev.handEdited) stale = true
    else remake = true
  }
  // Keep points inside the pattern when it moves, unless a new pattern is on its way.
  const points = !sameRegion(from, to) && !remake ? mapPoints(prev.points, from, to) : prev.points
  return { next: { ...prev, settings, points, stale }, remake }
}
