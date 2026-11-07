// DXF for CAD and CAM (Fusion, Illustrator, LightBurn, VCarve). Written as AutoCAD R12 text, the most
// widely readable version. Holes are closed polylines whose rounded corners are true arcs (bulges).
// DXF's y axis points up, so y is flipped and arcs change direction.
import type { Segment } from '../voronoi/geometry'
import type { Outline } from '../voronoi/holes'
import type { Geometry } from '../voronoi/pattern'
import { regionCenter, regionHeight, regionPolygon, regionWidth, type Region } from '../voronoi/region'
import { cutPaths, num } from './cutPaths'
import type { Settings } from './settings'

export const LAYER_INNER = 'CUT_INNER'
export const LAYER_OUTER = 'CUT_OUTER'

export function cutDxf(g: Geometry, s: Settings): string {
  const inches = s.units === 'in'
  const k = inches ? 1 / 25.4 : 1
  const X = (x: number) => num(x * k, 4), Y = (y: number) => num((s.height - y) * k, 4)
  const out: string[] = []
  const pair = (code: number, value: string | number) => { out.push(String(code), String(value)) }

  pair(0, 'SECTION'); pair(2, 'HEADER')
  pair(9, '$ACADVER'); pair(1, 'AC1009')
  pair(9, '$INSUNITS'); pair(70, inches ? 1 : 4)
  pair(9, '$MEASUREMENT'); pair(70, inches ? 0 : 1)
  pair(9, '$EXTMIN'); pair(10, X(0)); pair(20, Y(s.height)); pair(30, 0)
  pair(9, '$EXTMAX'); pair(10, X(s.width)); pair(20, Y(0)); pair(30, 0)
  pair(0, 'ENDSEC')

  pair(0, 'SECTION'); pair(2, 'TABLES')
  pair(0, 'TABLE'); pair(2, 'LAYER'); pair(70, 2)
  for (const [name, colour] of [[LAYER_INNER, 1], [LAYER_OUTER, 5]] as const) {
    pair(0, 'LAYER'); pair(2, name); pair(70, 0); pair(62, colour); pair(6, 'CONTINUOUS')
  }
  pair(0, 'ENDTAB'); pair(0, 'ENDSEC')

  pair(0, 'SECTION'); pair(2, 'ENTITIES')
  const line = ([x0, y0, x1, y1]: Segment, layer: string) => {
    pair(0, 'LINE'); pair(8, layer)
    pair(10, X(x0)); pair(20, Y(y0)); pair(30, 0); pair(11, X(x1)); pair(21, Y(y1)); pair(31, 0)
  }
  const polyline = ({ points, bulges }: Outline, layer: string) => {
    pair(0, 'POLYLINE'); pair(8, layer); pair(66, 1); pair(10, 0); pair(20, 0); pair(30, 0); pair(70, 1)
    points.forEach(([x, y], i) => {
      pair(0, 'VERTEX'); pair(8, layer); pair(10, X(x)); pair(20, Y(y)); pair(30, 0)
      if (Math.abs(bulges[i]) > 1e-9) pair(42, num(-bulges[i], 8))
    })
    pair(0, 'SEQEND'); pair(8, layer)
  }
  const region = (r: Region, layer: string) => {
    if (r.shape === 'ellipse' && Math.abs(regionWidth(r) - regionHeight(r)) < 1e-9) {
      const [cx, cy] = regionCenter(r)
      pair(0, 'CIRCLE'); pair(8, layer); pair(10, X(cx)); pair(20, Y(cy)); pair(30, 0); pair(40, num((regionWidth(r) / 2) * k, 4))
      return
    }
    const poly = regionPolygon(r)
    polyline({ points: poly, bulges: poly.map(() => 0) }, layer)
  }

  const cut = cutPaths(g, s)
  for (const outline of cut.outlines) polyline(outline, LAYER_INNER)
  for (const segment of cut.lines) line(segment, LAYER_INNER)
  for (const r of cut.inner) region(r, LAYER_INNER)
  for (const r of cut.outer) region(r, LAYER_OUTER)
  pair(0, 'ENDSEC'); pair(0, 'EOF')
  return `${out.join('\n')}\n`
}
