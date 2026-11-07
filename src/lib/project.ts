// Project files: the settings plus the exact points, so hand edits survive. Files carry a schema name and
// version; older or partial files open with defaults for anything missing.
import { MAX_POINTS } from '../voronoi/seeding'
import { sanitizeSettings, type Settings } from './settings'

export const SCHEMA = 'voronoi-studio/project'
export const VERSION = 1
export const EXTENSION = '.voronoi.json'

export type Design = { settings: Settings; points: Float64Array; handEdited: boolean }
export type ProjectFile = { schema: typeof SCHEMA; version: number; app: string; savedAt: string; handEdited: boolean; settings: Settings; points: number[] }

export function serializeProject(design: Design, app = 'Voronoi Studio'): string {
  const file: ProjectFile = {
    schema: SCHEMA, version: VERSION, app, savedAt: new Date().toISOString(), handEdited: design.handEdited,
    settings: design.settings,
    // A micrometre is far finer than any cutter, and keeps files small.
    points: Array.from(design.points, v => Math.round(v * 1000) / 1000),
  }
  return JSON.stringify(file)
}

export class ProjectError extends Error {}

export function parseProject(text: string): Design {
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new ProjectError('This file is not a Voronoi Studio project: it is not valid JSON.') }
  if (!data || typeof data !== 'object') throw new ProjectError('This file is not a Voronoi Studio project.')
  const file = data as Partial<ProjectFile>
  if (file.schema !== SCHEMA) throw new ProjectError('This file is not a Voronoi Studio project: it has no Voronoi Studio schema.')
  if (typeof file.version !== 'number' || file.version > VERSION) {
    throw new ProjectError(`This project was saved by a newer Voronoi Studio (file version ${String(file.version)}). Update the app to open it.`)
  }
  const settings = sanitizeSettings(file.settings)
  const raw = Array.isArray(file.points) ? file.points : []
  if (raw.length % 2 || raw.length / 2 > MAX_POINTS || !raw.every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new ProjectError('The points in this project are damaged, so it cannot be opened.')
  }
  // Points outside the sheet are pulled onto it.
  const points = Float64Array.from(raw as number[], (v, i) => Math.min(i % 2 ? settings.height : settings.width, Math.max(0, v)))
  return { settings, points, handEdited: file.handEdited === true }
}
