// Imported veins: open lines from an SVG, stored as flat x, y pairs scaled 0–1 to a box, the way imported
// shapes are, so they stretch with the sheet. From files and saved sessions, so checked like shapes.
import type { Polygon } from './geometry'
import type { ImportedVeins } from './pattern'

export const MAX_VEIN_POINTS = 20_000

// Lines in millimetres, scaled to a box: the imported shape's (same file) or the file's page.
export function veinsFromLines(lines: Polygon[], name: string, box: [number, number, number, number]): ImportedVeins | null {
  const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0
  if (!(w > 0 && h > 0)) return null
  const round = (v: number) => Math.round(v * 1e6) / 1e6
  let total = 0
  const out: number[][] = []
  for (const line of lines) {
    if (line.length < 2) continue
    total += line.length
    if (total > MAX_VEIN_POINTS) break
    out.push(line.flatMap(([x, y]) => [round((x - x0) / w), round((y - y0) / h)]))
  }
  return out.length ? { name, lines: out } : null
}

export function sanitizeVeins(raw: unknown): ImportedVeins | null {
  if (!raw || typeof raw !== 'object') return null
  const { name, lines } = raw as Record<string, unknown>
  if (!Array.isArray(lines) || !lines.length) return null
  let total = 0
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 4 || line.length % 2) return null
    total += line.length / 2
    if (total > MAX_VEIN_POINTS) return null
    // Lines may run a little past their box, as a vein drawn to the edge does.
    if (!line.every(v => typeof v === 'number' && Number.isFinite(v) && v >= -0.5 && v <= 1.5)) return null
  }
  return { name: typeof name === 'string' ? name.slice(0, 120) : 'Imported veins', lines: lines as number[][] }
}
