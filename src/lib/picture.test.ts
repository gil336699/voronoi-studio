import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { planChange } from './changes'
import { cutDxf } from './dxfExport'
import { pictureKind } from './pictureFile'
import { grayPng } from './pictureLayer'
import { parseProject, serializeProject, VERSION } from './project'
import { DEFAULTS, sanitizeSettings, seedSettings, type Settings } from './settings'
import { artworkSvg, laserSvg } from './svgExport'
import { encodeGray, type DensityPicture } from '../voronoi/picture'
import { buildGeometry, patternRegion } from '../voronoi/pattern'
import { seedPoints } from '../voronoi/seeding'

const picture = (width = 40, height = 30): DensityPicture => {
  const bytes = Uint8Array.from({ length: width * height }, (_, i) => ((i % width) * 255) / (width - 1))
  return { name: 'ramp.heic', width, height, gray: encodeGray(bytes), sourceWidth: 4032, sourceHeight: 3024 }
}
const withPicture = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, density: 'picture', densityPicture: picture(), densityStrength: 6, ...over })
const bytes = (...values: (number | string)[]) => {
  const out: number[] = []
  for (const v of values) out.push(...(typeof v === 'number' ? [v] : [...v].map(c => c.charCodeAt(0))))
  return Uint8Array.from([...out, ...new Array(Math.max(0, 64 - out.length)).fill(0)])
}

describe('density pictures', () => {
  it('saves the picture in the project file and opens it again', () => {
    const settings = withPicture({ pictureFit: 'fill', pictureContrast: 35, pictureSoftness: 2.5, pictureInvert: true, pictureScale: 75, pictureX: 14.5, pictureY: -6 })
    const points = seedPoints(seedSettings(settings), patternRegion(settings)).points
    const text = serializeProject({ settings, points, handEdited: false })
    expect(JSON.parse(text).version).toBe(VERSION)
    const back = parseProject(text)
    expect(back.settings).toEqual(settings)
    // The same picture and settings give the same pattern after reopening.
    expect(Array.from(seedPoints(seedSettings(back.settings), patternRegion(back.settings)).points)).toEqual(Array.from(points))
  })

  it('drops a damaged picture, and a Picture gradient without one becomes None', () => {
    const s = sanitizeSettings({ ...withPicture(), densityPicture: { ...picture(), gray: 'AAAA' } })
    expect(s.densityPicture).toBeNull()
    expect(s.density).toBe('none')
    expect(sanitizeSettings({ density: 'picture', pictureFit: 'tile', pictureContrast: 500 })).toMatchObject({ density: 'none', pictureFit: 'fit', pictureContrast: 100 })
    expect(sanitizeSettings({ pictureScale: 1000, pictureX: -9000 })).toMatchObject({ pictureScale: 400, pictureX: -5000, pictureY: 0 })
  })

  it('makes a new pattern when the picture or its settings change', () => {
    const doc = { settings: withPicture(), points: new Float64Array(4), handEdited: false, stale: false }
    for (const patch of [{ densityPicture: picture(20, 20) }, { pictureContrast: 20 }, { pictureSoftness: 3 }, { pictureFit: 'fill' as const }, { pictureInvert: true }, { pictureScale: 60 }, { pictureX: 12 }, { pictureY: -8 }]) {
      expect(planChange(doc, patch).remake).toBe(true)
    }
    expect(planChange(doc, { showPicture: false }).remake).toBe(false)
  })

  it('tells picture types apart from their first bytes, whatever their names say', () => {
    expect(pictureKind(bytes(0xff, 0xd8, 0xff, 0xe0), 'photo.png', '')).toBe('jpeg')
    expect(pictureKind(bytes(0x89, 'PNG'), 'x', '')).toBe('png')
    expect(pictureKind(bytes(0, 0, 0, 24, 'ftypheic', 0, 0, 0, 0, 'mif1heic'), 'IMG_5783.HEIC', '')).toBe('heic')
    expect(pictureKind(bytes(0, 0, 0, 28, 'ftypmif1', 0, 0, 0, 0, 'mif1avifmiaf'), 'x', '')).toBe('avif')
    expect(pictureKind(bytes('II', 42, 0), 'scan', '')).toBe('tiff')
    expect(pictureKind(bytes('MM', 0, 42), 'scan', '')).toBe('tiff')
    expect(pictureKind(bytes('RIFF', 0, 0, 0, 0, 'WEBP'), 'x', '')).toBe('webp')
    expect(pictureKind(bytes('GIF89a'), 'x', '')).toBe('gif')
    expect(pictureKind(bytes('BM'), 'x', '')).toBe('bmp')
    expect(pictureKind(bytes(0xff, 0x0a), 'x', '')).toBe('jxl')
    expect(pictureKind(bytes('<?xml version="1.0"?>\n<svg xmlns'), 'drawing', '')).toBe('svg')
    expect(pictureKind(bytes('8BPS'), 'art.psd', '')).toBe('psd')
    expect(pictureKind(bytes('hello'), 'notes.txt', 'text/plain')).toBe('unknown')
  })

  it('writes a valid grey PNG', () => {
    const gray = Uint8Array.from({ length: 300 * 250 }, (_, i) => i % 251)
    const png = grayPng(300, 250, gray)
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(png.buffer)
    expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([300, 250, 8, 0]) // size, 8-bit grey
    const idatLength = view.getUint32(33)
    const raw = inflateSync(png.subarray(41, 41 + idatLength)) // throws if the zlib stream or its checksum is wrong
    expect(raw.length).toBe(301 * 250)
    expect(raw[301 * 7 + 1 + 9]).toBe(gray[300 * 7 + 9])
  })

  it('puts the picture in the artwork SVG under the lines when shown, and never in cut files', () => {
    const s = withPicture({ fill: true })
    const points = seedPoints(seedSettings(s), patternRegion(s)).points
    const g = buildGeometry(points, s)
    const art = artworkSvg(g, points, s)
    expect(art).toMatch(/<g id="fills"[\s\S]*<g id="picture"[^>]*><image [^>]*xlink:href="data:image\/png;base64,[\s\S]*<g id="cells" fill="none"/)
    expect(artworkSvg(g, points, { ...s, showPicture: false })).not.toContain('id="picture"')
    expect(artworkSvg(g, points, { ...s, density: 'radial' })).not.toContain('id="picture"')
    expect(laserSvg(g, points, s)).not.toContain('image')
    expect(cutDxf(g, points, s)).not.toContain('IMAGE')
  })
})
