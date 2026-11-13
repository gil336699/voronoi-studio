// The faint picture drawn behind the cells while a Picture gradient is on and Picture is shown: in the view,
// the PNG and the artwork SVG. It shows the picture as it drives the pattern, after levels, contrast and
// softness. Laser SVG and DXF files leave it out, since laser software would engrave it.
import { encodeGray, pictureTones, previewPixels, type PictureTones } from '../voronoi/picture'
import { densitySettings, type Settings } from './settings'

export const PICTURE_OPACITY = 0.35

export function shownPicture(s: Settings): { tones: PictureTones; invert: boolean } | null {
  if (!s.showPicture || s.density !== 'picture') return null
  const picture = densitySettings(s).picture
  return picture ? { tones: pictureTones(picture), invert: picture.invert } : null
}

// One canvas per set of tones, made the first time it's drawn.
const canvases = new WeakMap<PictureTones, HTMLCanvasElement>()
export function pictureCanvas(tones: PictureTones, invert: boolean): HTMLCanvasElement | null {
  let canvas = canvases.get(tones)
  if (canvas) return canvas
  canvas = document.createElement('canvas')
  canvas.width = tones.cols; canvas.height = tones.rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(previewPixels(tones, invert), tones.cols, tones.rows), 0, 0)
  canvases.set(tones, canvas)
  return canvas
}

// CRC-32 and Adler-32, for a PNG written without a canvas, so SVG export works anywhere.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// An 8-bit grey PNG, stored without compression (photos barely compress anyway).
export function grayPng(width: number, height: number, gray: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width + 1) * height)
  for (let j = 0; j < height; j++) raw.set(gray.subarray(j * width, (j + 1) * width), j * (width + 1) + 1) // filter byte 0
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  zlib[0] = 0x78; zlib[1] = 0x01
  let at = 2
  for (let b = 0; b < blocks; b++) {
    const chunk = raw.subarray(b * 65535, Math.min(raw.length, (b + 1) * 65535))
    zlib[at++] = b === blocks - 1 ? 1 : 0
    zlib[at++] = chunk.length & 0xff; zlib[at++] = chunk.length >> 8
    zlib[at++] = ~chunk.length & 0xff; zlib[at++] = (~chunk.length >> 8) & 0xff
    zlib.set(chunk, at); at += chunk.length
  }
  let a = 1, b2 = 0
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b2 = (b2 + a) % 65521 }
  const adler = ((b2 << 16) | a) >>> 0
  zlib[at++] = adler >>> 24; zlib[at++] = (adler >>> 16) & 0xff; zlib[at++] = (adler >>> 8) & 0xff; zlib[at++] = adler & 0xff
  const ihdr = [width >>> 24, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff, height >>> 24, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff, 8, 0, 0, 0, 0]
  const chunks: [string, ArrayLike<number>][] = [['IHDR', ihdr], ['IDAT', zlib], ['IEND', []]]
  const size = 8 + chunks.reduce((n, [, d]) => n + 12 + d.length, 0)
  const out = new Uint8Array(size)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let p = 8
  for (const [type, data] of chunks) {
    const n = data.length
    out.set([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff], p)
    for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i)
    out.set(data, p + 8)
    const crc = crc32(out, p + 4, p + 8 + n)
    out.set([crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff], p + 8 + n)
    p += 12 + n
  }
  return out
}

// The picture as a PNG data URL, for the artwork SVG.
export function pictureDataUrl(tones: PictureTones, invert: boolean): string {
  const rgba = previewPixels(tones, invert)
  const gray = new Uint8Array(tones.cols * tones.rows)
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]
  return `data:image/png;base64,${encodeGray(grayPng(tones.cols, tones.rows, gray))}`
}
