import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { signedArea } from '../voronoi/geometry'
import { shapeFromOutlines, ShapeError } from '../voronoi/shape'
import { parsePathData, parseTransform, readSvgOutlines, SvgShapeError } from './svgShape'

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

  it('explains files it cannot use', () => {
    expect(() => readSvgOutlines('not an svg')).toThrow(SvgShapeError)
    expect(() => readSvgOutlines('<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>')).toThrow(/open lines/)
    expect(() => readSvgOutlines('<svg viewBox="0 0 10 10"><g/></svg>')).toThrow(/no closed outlines/)
    expect(() => shapeFromOutlines([[[0, 0], [0.5, 0], [0.5, 0.5]]], 'tiny')).toThrow(ShapeError)
  })
})
