import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { signedArea } from '../voronoi/geometry'
import { shapeFromOutlines, ShapeError } from '../voronoi/shape'
import { contains, sheetRegion } from '../voronoi/region'
import { FINE_SHARE, parsePathData, parseTransform, PICTURE_ONLY, readSvgOutlines, SvgShapeError } from './svgShape'

const PT = 25.4 / 72
const fixture = (name: string) => readFileSync(new URL(`../../test-fixtures/${name}`, import.meta.url), 'utf8')
const box = (points: [number, number][]) => {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

describe('SVG outlines', () => {
  it('reads an Illustrator file without a size at 72 units per inch', () => {
    const { rings, units } = readSvgOutlines(fixture('pill.svg'))
    expect(units).toBe('illustrator')
    expect(rings).toHaveLength(1)
    const [x0, y0, x1, y1] = box(rings[0])
    expect(x1 - x0).toBeCloseTo((400 * 25.4) / 72, 2)
    expect(y1 - y0).toBeCloseTo((200 * 25.4) / 72, 2)
    // A stadium: a circle plus a rectangle.
    const r = (100 * 25.4) / 72
    expect(Math.abs(signedArea(rings[0]))).toBeCloseTo(Math.PI * r * r + 2 * r * (2 * r), -1)
  })

  it('reads sizes in millimetres, nested outlines as holes, and skips open lines', () => {
    const { rings, units, open } = readSvgOutlines(fixture('pill-with-hole.svg'))
    expect(units).toBe('file')
    expect(open).toBe(1)
    const shape = shapeFromOutlines(rings, 'pill-with-hole.svg')
    expect(shape.width).toBeCloseTo(160, 3)
    expect(shape.height).toBeCloseTo(80, 3)
    expect(shape.rings).toHaveLength(2)
    const areas = shape.rings.map(flat => {
      const ring: [number, number][] = []
      for (let i = 0; i < flat.length; i += 2) ring.push([flat[i] * shape.width, flat[i + 1] * shape.height])
      return signedArea(ring)
    }).sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(-Math.PI * 15 * 15, -1) // the hole
    expect(areas[1]).toBeCloseTo(Math.PI * 40 * 40 + 80 * 80, -1)
  })

  it('parses compact path numbers the way drawing apps write them', () => {
    const [sub] = parsePathData('M612.58.5H227.5C102.13.5.5,102.13.5,227.5Z', 0.1)
    expect(sub.points[0]).toEqual([612.58, 0.5])
    expect(sub.points[1]).toEqual([227.5, 0.5])
    expect(sub.points[sub.points.length - 1]).toEqual([0.5, 227.5])
    expect(sub.closed).toBe(true)
    // Relative moves, repeated pairs and arcs with packed flags.
    const [tri] = parsePathData('m10 10 10 0 0 10z', 0.1)
    expect(tri.points).toEqual([[10, 10], [20, 10], [20, 20]])
    const [circle] = parsePathData('M0 0a5 5 0 1010 0a5 5 0 10-10 0z', 0.01)
    const b = box(circle.points) // flattened within 0.01, so the extremes may fall short by that much
    expect(b[2] - b[0]).toBeCloseTo(10, 1)
    expect(b[3] - b[1]).toBeCloseTo(10, 1)
  })

  it('applies group and element transforms', () => {
    const m = parseTransform('translate(10 5) scale(2)')
    expect(m).toEqual([2, 0, 0, 2, 10, 5])
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
      <g transform="translate(10 5)"><polygon transform="scale(2)" points="0,0 10,0 10,10 0,10"/></g></svg>`
    const { rings } = readSvgOutlines(svg)
    expect(box(rings[0])).toEqual([10, 5, 30, 25])
  })

  it('leaves out hidden and non-drawing content', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <defs><rect width="50" height="50"/></defs>
      <rect width="10" height="10" style="display:none"/>
      <circle cx="48" cy="48" r="24"/></svg>`
    const { rings, units } = readSvgOutlines(svg)
    expect(units).toBe('css')
    expect(rings).toHaveLength(1)
    const [x0, , x1] = box(rings[0])
    expect(x1 - x0).toBeCloseTo(48 * (25.4 / 96), 2) // 96 user units per inch
  })

  it('reads a picture’s outline from the clipping mask that trims it, as Illustrator exports one', () => {
    // Gil’s JHU ICE asset: a picture of the page with a ticket-shaped window, clipped to that outline by a class.
    const ticket = 'M243,425.6c0,2.49-2.01,4.5-4.5,4.5-7.44,0-13.5,6.06-13.5,13.5,0,2.49-2.01,4.5-4.5,4.5H92c-2.49,0-4.5-2.01-4.5-4.5,'
      + '0-7.44-6.06-13.5-13.5-13.5-2.49,0-4.5-2.01-4.5-4.5v-152.04c0-2.49,2.01-4.5,4.5-4.5,7.44,0,13.5-6.06,13.5-13.5,0-2.49,2.01-4.5,'
      + '4.5-4.5h128.5c2.49,0,4.5,2.01,4.5,4.5,0,7.44,6.06,13.5,13.5,13.5,2.49,0,4.5,2.01,4.5,4.5v152.04Z'
    const asset = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_2" data-name="Layer 2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 688 868">
  <defs><style>
      .cls-1 { fill: none; }

      .cls-2 { clip-path: url(#clippath); }
    </style>
    <clipPath id="clippath"><path class="cls-1" d="M2,2v864h684V2H2Z${ticket}"/></clipPath></defs>
  <g id="Layer_1-2" data-name="Layer 1"><g class="cls-2">
    <image width="688" height="868" xlink:href="data:image/png;base64,iVBORw0KGgo="/>
  </g></g>
</svg>`
    const outlines = readSvgOutlines(asset)
    expect(outlines.fromClip).toBe(true)
    expect(outlines.units).toBe('illustrator')
    expect(outlines.rings).toHaveLength(2)
    expect(box(outlines.rings[0]).map(v => v / PT)).toEqual([2, 2, 686, 866].map(v => expect.closeTo(v, 6)))
    // The sheet is the page with the ticket as a hole.
    const shape = shapeFromOutlines(outlines.rings, 'asset.svg', outlines.units)
    expect(shape.width).toBeCloseTo(684 * PT, 3)
    expect(shape.height).toBeCloseTo(864 * PT, 3)
    const sheet = sheetRegion(shape.width, shape.height, 'custom', shape)
    expect(contains(sheet, 400 * PT, 600 * PT)).toBe(true)
    expect(contains(sheet, (150 - 2) * PT, (350 - 2) * PT)).toBe(false) // inside the ticket window
  })

  it('places a clipping mask in the space of whatever uses it', () => {
    const read = (use: string) => readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
      <defs><clipPath id="c" transform="translate(5 0)"><path d="M0 0H10V10H0"/></clipPath></defs>
      <g transform="translate(20 30)"><image ${use} width="50" height="50" href="a.png"/></g></svg>`)
    const placed = [[[25, 30], [35, 30], [35, 40], [25, 40]]]
    expect(read('clip-path="url(#c)"').rings).toEqual(placed)
    expect(read('style="opacity:.5; clip-path: url(\'#c\')"').rings).toEqual(placed)
    expect(read('transform="scale(2)" clip-path="url(#c)"').rings).toEqual([[[30, 30], [50, 30], [50, 50], [30, 50]]])
    // Used twice in the same place, it's still one outline.
    expect(read('clip-path="url(#c)"/><image clip-path="url(#c)"').rings).toEqual(placed)
    // A class from a style sheet wrapped in CDATA.
    const cdata = readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style><![CDATA[ .a, .clip { clip-path: url(#c) } ]]></style>
      <clipPath id="c"><circle cx="50" cy="50" r="20"/></clipPath><image class="x clip" width="100" height="100" href="a.png"/></svg>`)
    expect(cdata.fromClip).toBe(true)
    const px = 25.4 / 96
    for (const [x, y] of cdata.rings[0]) expect(Math.hypot(x / px - 50, y / px - 50)).toBeCloseTo(20, 6)
  })

  it('prefers closed shapes to clipping masks, and says when a file is only a picture', () => {
    const both = readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><clipPath id="c"><rect width="10" height="10"/></clipPath></defs>
      <image clip-path="url(#c)" width="50" height="50" href="a.png"/><circle cx="50" cy="50" r="20"/></svg>`)
    expect(both.fromClip).toBe(false)
    expect(both.rings).toHaveLength(1)
    expect(() => readSvgOutlines('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image width="10" height="10" href="a.png"/></svg>')).toThrow(PICTURE_ONLY)
    // A clip sized to whatever uses it has no outline of its own.
    expect(() => readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath>
      <image clip-path="url(#c)" width="10" height="10" href="a.png"/></svg>`)).toThrow('only a picture')
  })

  it('reads a small drawing’s curves finely enough to be made bigger', () => {
    // A 40 mm circle (two arcs) and a 40 mm open curve (one cubic), as a small drawing to be enlarged in the app.
    const small = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="0 0 40 40">
      <path d="M0 20A20 20 0 1 1 40 20A20 20 0 1 1 0 20Z"/><path fill="none" stroke="#000" d="M0 20C10 40 30 0 40 20"/></svg>`
    const { rings, lines } = readSvgOutlines(small(40))
    // Every edge of the circle's polygon stays within 1/20,000 of the drawing's size (0.002 mm) of the circle.
    const sag = Math.max(...rings[0].map((p, i) => {
      const q = rings[0][(i + 1) % rings[0].length]
      return 20 - Math.hypot((p[0] + q[0]) / 2 - 20, (p[1] + q[1]) / 2 - 20)
    }))
    expect(sag).toBeLessThanOrEqual(40 * FINE_SHARE * 1.01)
    // And the open curve's pieces stay that close to the true cubic.
    const curve = Array.from({ length: 4001 }, (_, k) => {
      const t = k / 4000, u = 1 - t
      return [3 * u * u * t * 10 + 3 * u * t * t * 30 + t ** 3 * 40, u ** 3 * 20 + 3 * u * u * t * 40 + t ** 3 * 20]
    })
    // Distance from each piece's middle to the true curve (to the segments of a 4,000-piece copy of it).
    const toCurve = (m: number[]) => {
      let best = Infinity
      for (let k = 0; k + 1 < curve.length; k++) {
        const [ax, ay] = curve[k], [bx, by] = curve[k + 1], dx = bx - ax, dy = by - ay
        const s = Math.max(0, Math.min(1, ((m[0] - ax) * dx + (m[1] - ay) * dy) / (dx * dx + dy * dy)))
        best = Math.min(best, Math.hypot(ax + s * dx - m[0], ay + s * dy - m[1]))
      }
      return best
    }
    const off = Math.max(...lines[0].slice(1).map((p, i) => toCurve([(p[0] + lines[0][i][0]) / 2, (p[1] + lines[0][i][1]) / 2])))
    expect(off).toBeLessThanOrEqual(40 * FINE_SHARE * 1.01)
    // The same drawing at 400 mm is read at the usual 0.02 mm, which is the same detail for its size.
    const big = readSvgOutlines(small(400))
    expect(big.rings[0].length).toBe(rings[0].length)
    expect(big.lines[0].length).toBe(lines[0].length)
  })

  it('keeps a drawing’s exact size: curves keep their leftmost, rightmost, top and bottom points', () => {
    const box = (polys: [number, number][][]) => {
      const xs = polys.flat().map(p => p[0]), ys = polys.flat().map(p => p[1])
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }
    // A circle drawn as two arcs that start at 45°, which passes its extremes between points when flattened evenly.
    const c = 20 + 20 * Math.SQRT1_2, c2 = 20 - 20 * Math.SQRT1_2
    const arcs = readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 300 300">
      <path d="M${c} ${c}A20 20 0 0 1 ${c2} ${c2}A20 20 0 0 1 ${c} ${c}Z"/><path d="M100 100h100v100h-100Z"/></svg>`)
    box([arcs.rings[0]]).forEach((v, k) => expect(v).toBeCloseTo([0, 0, 40, 40][k], 9))
    // A rotated ellipse arc: 60 × 20 mm at 30°, its extremes from the ellipse's own equation.
    const rot = readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 300 300">
      <path d="M100 100A30 10 30 1 1 100.001 100Z"/><path d="M200 200h50v50h-50Z"/></svg>`)
    const halfW = Math.hypot(30 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6)), halfH = Math.hypot(30 * Math.sin(Math.PI / 6), 10 * Math.cos(Math.PI / 6))
    const [rx0, ry0, rx1, ry1] = box([rot.rings[0]])
    expect(rx1 - rx0).toBeCloseTo(2 * halfW, 6); expect(ry1 - ry0).toBeCloseTo(2 * halfH, 6)
    // A cubic that bulges past its end points, and a circle element.
    const bulge = readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 300 300">
      <path d="M0 20C10 40 30 0 40 20C50 40 60 -10 0 20Z"/><circle cx="150" cy="150" r="37"/></svg>`)
    const [, y0, , y1] = box([bulge.rings[0]])
    // The true top and bottom of its two pieces, found by sampling them very finely.
    let top = -Infinity, bottom = Infinity
    for (let k = 0; k <= 200000; k++) {
      const t = k / 200000, u = 1 - t
      for (const y of [u ** 3 * 20 + 3 * u * u * t * 40 + t ** 3 * 20, u ** 3 * 20 + 3 * u * u * t * 40 - 3 * u * t * t * 10 + t ** 3 * 20]) {
        top = Math.max(top, y); bottom = Math.min(bottom, y)
      }
    }
    expect(y1).toBeCloseTo(top, 6); expect(y0).toBeCloseTo(bottom, 6)
    box([bulge.rings[1]]).forEach((v, k) => expect(v).toBeCloseTo([113, 113, 187, 187][k], 9))
  })

  it('reads a small, very detailed drawing as asked when finer reading would be too many points', () => {
    // 3,000 dots in 40 mm: about 105,000 points read finely, so it's read at 0.02 mm instead, and still opens.
    const dots = Array.from({ length: 3000 }, (_, k) => `<circle cx="${(k % 60) * 0.65 + 0.6}" cy="${Math.floor(k / 60) * 0.75 + 0.6}" r="0.3"/>`).join('')
    const { rings } = readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">${dots}</svg>`)
    expect(rings).toHaveLength(3000)
    expect(rings.reduce((n, r) => n + r.length, 0)).toBeLessThan(60_000)
  })

  it('explains files it cannot use', () => {
    expect(() => readSvgOutlines('not an svg')).toThrow(SvgShapeError)
    expect(() => readSvgOutlines('<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>')).toThrow(/open lines/)
    expect(() => readSvgOutlines('<svg viewBox="0 0 10 10"><g/></svg>')).toThrow(/no closed outlines/)
    expect(() => shapeFromOutlines([[[0, 0], [0.5, 0], [0.5, 0.5]]], 'tiny')).toThrow(ShapeError)
  })
})
