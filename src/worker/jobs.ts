// The heavy work, as plain functions: make points for the settings, or relax existing points. The worker
// runs these off the main thread; tests and the fallback call them directly.
import { patternRegion } from '../voronoi/pattern'
import { relax } from '../voronoi/relax'
import { seedPoints } from '../voronoi/seeding'
import { seedSettings, type Settings } from '../lib/settings'

export type Job =
  | { kind: 'generate'; settings: Settings }
  | { kind: 'relax'; settings: Settings; points: Float64Array; steps: number }
export type JobResult = { points: Float64Array; maxMove: number; capped: boolean; spacing: number }

export function runJob(job: Job): JobResult {
  const region = patternRegion(job.settings)
  const density = seedSettings(job.settings).density
  if (job.kind === 'generate') {
    const seeded = seedPoints(seedSettings(job.settings), region)
    const relaxed = relax(seeded.points, region, density, job.settings.relaxSteps)
    return { points: relaxed.points, maxMove: relaxed.maxMove, capped: seeded.capped, spacing: seeded.spacing }
  }
  const relaxed = relax(job.points, region, density, Math.max(1, job.steps))
  return { ...relaxed, capped: false, spacing: 0 }
}
