import { useEffect, useMemo, useRef, useState } from 'react'
import { preflight, type Preflight } from './lib/preflight'
import type { Settings } from './lib/settings'
import type { Geometry } from './voronoi/pattern'

// Ready to cut?'s report on the current design, while `on` (the File tab is open, or a row's highlight is pinned).
// It's worked out just after a change. While Auto-relax or a drag keeps changing the design, it's worked out at most
// every 250 ms, or every eight times its own cost for big designs (about 50 ms at 10,000 holes), so it never takes
// more than an eighth of the time, and once more when the changes stop. Until then the last report stays up.
export function usePreflight(on: boolean, geometry: Geometry, points: Float64Array, s: Settings): Preflight | null {
  const { cellStyle, showEdges, showSites, showDelaunay, sheetOutline, border, kerf, smallestWeb, smallestFeature } = s
  const input = useMemo(() => (on ? {
    geometry, points, settings: { cellStyle, showEdges, showSites, showDelaunay, sheetOutline, border, kerf, smallestWeb, smallestFeature },
  } : null), [on, geometry, points, cellStyle, showEdges, showSites, showDelaunay, sheetOutline, border, kerf, smallestWeb, smallestFeature])
  const [report, setReport] = useState<Preflight | null>(null)
  // When the next report may start, by performance.now().
  const next = useRef(0)
  useEffect(() => {
    if (!input) return
    const timer = window.setTimeout(() => {
      const start = performance.now()
      const result = preflight(input.geometry, input.points, input.settings)
      const end = performance.now()
      next.current = end + Math.max(250, 8 * (end - start))
      setReport(result)
    }, Math.max(0, next.current - performance.now()))
    return () => window.clearTimeout(timer)
  }, [input])
  return on ? report : null
}
