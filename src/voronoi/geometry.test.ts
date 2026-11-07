import { describe, expect, it } from 'vitest'
import { area, centroid, clipConvex, clipHalfPlane, ellipsePolygon, insetConvex, minWidth, normalize, perimeter, signedArea, type Polygon } from './geometry'
import { clampToRegion, contains, insetRegion, mapBetween, regionArea, regionPerimeter, regionPolygon, sheetRegion } from './region'

const square = (s: number, x = 0, y = 0): Polygon => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]

describe('polygon helpers', () => {
  it('measures a square', () => {
    expect(area(square(10))).toBeCloseTo(100)
    expect(centroid(square(10, 5, 5))).toEqual([10, 10])
    expect(perimeter(square(10))).toBeCloseTo(40)
  })

  it('normalizes to positive area and drops repeated points', () => {
    const p = normalize([[0, 0], [0, 10], [0, 10], [10, 10], [10, 0], [0, 0]])
    expect(p).toHaveLength(4)
    expect(signedArea(p)).toBeGreaterThan(0)
  })

  it('clips against a half plane and a convex polygon', () => {
    expect(area(clipHalfPlane(square(10), 1, 0, 4))).toBeCloseTo(60)
    expect(area(clipConvex(square(10), square(10, 5, 5)))).toBeCloseTo(25)
  })

  it('insets every edge of a convex polygon', () => {
    const inner = insetConvex(square(10), 1)
    expect(area(inner)).toBeCloseTo(64)
    expect(insetConvex(square(10), 5.1)).toEqual([])
    expect(minWidth([[0, 0], [30, 0], [30, 4], [0, 4]])).toBeCloseTo(4)
  })

  it('approximates an ellipse closely', () => {
    expect(area(ellipsePolygon(0, 0, 50, 30))).toBeCloseTo(Math.PI * 50 * 30, -1)
    expect(signedArea(ellipsePolygon(0, 0, 5, 5))).toBeGreaterThan(0)
  })
})

describe('regions', () => {
  const sheet = sheetRegion(200, 100, 'rect')
  const oval = sheetRegion(100, 100, 'ellipse')

  it('insets and measures', () => {
    const inner = insetRegion(sheet, 10)
    expect([inner.x0, inner.y0, inner.x1, inner.y1]).toEqual([10, 10, 190, 90])
    expect(regionArea(oval)).toBeCloseTo(Math.PI * 2500)
    expect(regionPerimeter(oval)).toBeCloseTo(Math.PI * 100)
    expect(signedArea(regionPolygon(sheet))).toBeGreaterThan(0)
  })

  it('tests and clamps points', () => {
    expect(contains(oval, 50, 50)).toBe(true)
    expect(contains(oval, 2, 2)).toBe(false)
    const [x, y] = clampToRegion(oval, 0, 0)
    expect(contains(oval, x, y)).toBe(true)
    expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(50, 3)
  })

  it('maps points between sheet sizes and shapes without piling them on the rim', () => {
    expect(mapBetween(sheet, sheetRegion(400, 200, 'rect'), 50, 50)).toEqual([100, 100])
    const round = sheetRegion(200, 100, 'ellipse')
    let onRim = 0
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const x = i * 10, y = j * 5
      const [ex, ey] = mapBetween(sheet, round, x, y)
      expect(contains(round, ex, ey)).toBe(true)
      if (Math.hypot((ex - 100) / 100, (ey - 50) / 50) > 0.999) onRim++
      // Mapping back returns the point; exact corners land on the rim and come back within 0.1 mm.
      const [bx, by] = mapBetween(round, sheet, ex, ey)
      const edge = i === 0 || i === 20 || j === 0 || j === 20
      expect(Math.abs(bx - x)).toBeLessThan(edge ? 0.1 : 1e-3)
      expect(Math.abs(by - y)).toBeLessThan(edge ? 0.1 : 1e-3)
    }
    // Only the 80 grid points on the rectangle's own edge land on the rim.
    expect(onRim).toBeLessThanOrEqual(80)
  })
})
