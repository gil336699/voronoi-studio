import { describe, expect, it } from 'vitest'
import { cellCentroid, type Cell } from './diagram'
import type { Polygon } from './geometry'
import { relax } from './relax'
import { createRng } from './random'
import { seedPoints } from './seeding'
import {
  decodeGray, encodeGray, pictureCentroid, pictureDensityAt, pictureGrid, picturePlacement, pictureTones, sanitizePicture,
  type DensityPicture, type PictureSettings,
} from './picture'
import type { DensitySettings } from './density'
import type { Region } from './region'

const picture = (width: number, height: number, value: (i: number, j: number) => number, name = 'test.png'): DensityPicture => {
  const bytes = new Uint8Array(width * height)
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) bytes[j * width + i] = value(i, j)
  return { name, width, height, gray: encodeGray(bytes), sourceWidth: width, sourceHeight: height }
}
const settings = (p: DensityPicture, extra: Partial<PictureSettings> = {}): PictureSettings => ({
  picture: p, fit: 'fit', contrast: 0, softness: 0, invert: false, sheetWidth: 100, sheetHeight: 100, ...extra,
})

// Point-in-polygon with even-odd rings, for brute-force integration.
function inside(cell: Cell, x: number, y: number): boolean {
  let hit = false
  for (const ring of cell) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
  }
  return hit
}

// The weighted centre by sampling a fine grid of points: slow, but obviously right.
function bruteCentroid(cell: Cell, p: PictureSettings, strength: number, n = 1200): [number, number] {
  const g = pictureGrid(p, strength)
  const xs = cell.flat().map(v => v[0]), ys = cell.flat().map(v => v[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  let m = 0, mx = 0, my = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) / n) * (x1 - x0), y = y0 + ((j + 0.5) / n) * (y1 - y0)
      if (!inside(cell, x, y)) continue
      const d = pictureDensityAt(g, x, y), w = d * d
      m += w; mx += w * x; my += w * y
    }
  }
  return [mx / m, my / m]
}

describe('picture density', () => {
  it('round-trips the grey bytes and rejects damaged pictures', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256)
    expect(Array.from(decodeGray(encodeGray(bytes)))).toEqual(Array.from(bytes))
    const good = picture(20, 15, (i, j) => (i + j) * 5)
    expect(sanitizePicture(good)).toEqual(good)
    expect(sanitizePicture({ ...good, width: 21 })).toBeNull() // bytes don't match the size
    expect(sanitizePicture({ ...good, gray: '%%%' })).toBeNull()
    expect(sanitizePicture({ ...good, width: 600, height: 1 })).toBeNull()
    expect(sanitizePicture('picture.png')).toBeNull()
  })

  it('fits the whole picture on the sheet, or fills the sheet with it', () => {
    const p = picture(200, 100, () => 0)
    expect(picturePlacement(settings(p, { sheetWidth: 100, sheetHeight: 100 }))).toEqual({ k: 0.5, ox: 0, oy: 25 })
    expect(picturePlacement(settings(p, { fit: 'fill', sheetWidth: 100, sheetHeight: 100 }))).toEqual({ k: 1, ox: -50, oy: 0 })
  })

  it('makes the darkest pixel the full strength and white paper 1, or the reverse when inverted', () => {
    const p = picture(4, 1, i => [60, 100, 140, 180][i])
    const g = pictureGrid(settings(p, { sheetWidth: 4, sheetHeight: 4 }), 9)
    expect(g.d[0]).toBeCloseTo(9) // the darkest pixel, after levels
    expect(g.d[3]).toBeCloseTo(1) // the lightest
    expect(g.dOut).toBeCloseTo(1) // around the picture
    const inverted = pictureGrid(settings(p, { sheetWidth: 4, sheetHeight: 4, invert: true }), 9)
    expect(inverted.d[0]).toBeCloseTo(1)
    expect(inverted.d[3]).toBeCloseTo(9)
    expect(inverted.dOut).toBeCloseTo(9)
  })

  it('softens by blurring into the paper around the picture', () => {
    const p = picture(41, 41, (i, j) => (i === 20 && j === 20 ? 0 : 255))
    const sharp = pictureTones(settings(p)).tone
    const soft = pictureTones(settings(p, { softness: 10 })).tone
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0)
    expect(sharp[20 * 41 + 20]).toBe(1)
    expect(soft[20 * 41 + 20]).toBeLessThan(0.1)
    expect(soft[20 * 41 + 25]).toBeGreaterThan(0)
    expect(sum(soft)).toBeCloseTo(sum(sharp), 2) // a blur spreads the dot without losing it
  })

  it('gives the plain centre for an even picture', () => {
    const p = picture(50, 50, () => 128)
    const cell: Cell = [[[10, 10], [60, 15], [70, 70], [5, 40]]]
    const c = pictureCentroid(cell, pictureGrid(settings(p), 6))!
    const plain = cellCentroid(cell)
    expect(c[0]).toBeCloseTo(plain[0], 9)
    expect(c[1]).toBeCloseTo(plain[1], 9)
  })

  it('integrates the weighted centre exactly over sharp pixels, holes and the paper around the picture', () => {
    const rng = createRng(7)
    const p = picture(37, 23, () => Math.floor(rng() * 256))
    const s = settings(p, { sheetWidth: 100, sheetHeight: 100 }) // fitted, with paper above and below
    const square: Polygon = [[30, 10], [90, 10], [90, 70], [30, 70]]
    const hole: Polygon = [[50, 30], [50, 50], [70, 50], [70, 30]] // turning the other way
    const concave: Polygon = [[2, 2], [40, 18.3], [77.7, 3], [60.1, 51], [97, 97], [20.5, 60]]
    for (const cell of [[square], [square, hole], [concave]] as Cell[]) {
      const exact = pictureCentroid(cell, pictureGrid(s, 12))!
      const brute = bruteCentroid(cell, s, 12)
      expect(Math.hypot(exact[0] - brute[0], exact[1] - brute[1])).toBeLessThan(0.05)
    }
  })

  it('places and keeps about Strength times as many cells in the dark half, through relaxing', () => {
    const p = picture(64, 64, i => (i < 32 ? 0 : 255))
    const region: Region = { shape: 'rect', x0: 0, y0: 0, x1: 100, y1: 100 }
    const density: DensitySettings = { mode: 'picture', strength: 4, angle: 0, invert: false, picture: settings(p) }
    const ratio = (points: Float64Array) => {
      let dark = 0
      for (let i = 0; i < points.length; i += 2) if (points[i] < 50) dark++
      return dark / (points.length / 2 - dark)
    }
    for (const placement of ['random', 'even'] as const) {
      const seeded = seedPoints({ count: 400, placement, autoSpacing: true, spacing: 10, tries: 30, jitter: 0, seed: 1, density }, region)
      expect(seeded.points.length).toBe(800)
      const relaxed = relax(seeded.points, region, density, 30).points
      for (const r of [ratio(seeded.points), ratio(relaxed)]) {
        expect(r).toBeGreaterThan(3.3)
        expect(r).toBeLessThan(4.7)
      }
    }
  })
})
