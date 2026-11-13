// Reads a picture file into the small grey image a Picture gradient uses. The browser decodes JPEG, PNG,
// GIF, WebP, AVIF, BMP, ICO and SVG itself. HEIC and TIFF, which Chrome, Edge and Firefox can't decode,
// load a decoder the first time one is opened (libheif through heic-to, and UTIF), so the app stays small
// for everyone else. Safari decodes both itself, so it never needs them.
import { encodeGray, PICTURE_MAX_SIDE, type DensityPicture } from '../voronoi/picture'

export class PictureError extends Error {}

export type PictureKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'ico' | 'tiff' | 'heic' | 'avif' | 'jxl' | 'svg'
  | 'psd' | 'pdf' | 'unknown'

export const PICTURE_TYPES = 'JPG, PNG, HEIC, TIFF, WebP, AVIF, GIF, BMP or SVG'
// For file pickers: image/* lists photos on phones; the extensions cover systems that don't know HEIC or TIFF types.
export const PICTURE_ACCEPT = 'image/*,.jpg,.jpeg,.jfif,.png,.gif,.webp,.avif,.bmp,.ico,.svg,.tif,.tiff,.heic,.heif,.jxl'

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))

// What a file is, from its first bytes, falling back to its name and type for SVG, which is text.
export function pictureKind(head: Uint8Array, name: string, type: string): PictureKind {
  const b = head
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png'
  if (ascii(b, 0, 4) === 'GIF8') return 'gif'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp'
  if (ascii(b, 0, 2) === 'BM') return 'bmp'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico'
  if ((ascii(b, 0, 2) === 'II' && b[2] === 42 && b[3] === 0) || (ascii(b, 0, 2) === 'MM' && b[2] === 0 && b[3] === 42)) return 'tiff'
  if ((b[0] === 0xff && b[1] === 0x0a) || ascii(b, 4, 12) === 'JXL \r\n\x87\n') return 'jxl'
  if (ascii(b, 4, 8) === 'ftyp') {
    // ISO media files name their brands: AVIF and HEIC share a container.
    const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0)
    const brands = [ascii(b, 8, 12)]
    for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(b, at, at + 4))
    if (brands.some(x => x === 'avif' || x === 'avis')) return 'avif'
    if (brands.some(x => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(x))) return 'heic'
  }
  if (ascii(b, 0, 4) === '8BPS') return 'psd'
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf'
  const text = new TextDecoder().decode(b).replace(/^\uFEFF/, '').trimStart()
  if (/\.svgz?$/i.test(name) || type === 'image/svg+xml' || /^<svg[\s>]/i.test(text) || (/^<(\?xml|!--|!DOCTYPE svg)/i.test(text) && /<svg[\s>]/i.test(text))) return 'svg'
  if (/\.(heic|heif)$/i.test(name)) return 'heic'
  if (/\.tiff?$/i.test(name)) return 'tiff'
  return 'unknown'
}

type Source = { image: CanvasImageSource; width: number; height: number; close?: () => void }

const bitmap = (b: ImageBitmap): Source => ({ image: b, width: b.width, height: b.height, close: () => b.close() })

async function native(blob: Blob): Promise<Source | null> {
  try { return bitmap(await createImageBitmap(blob, { imageOrientation: 'from-image' })) } catch { /* try an image element */ }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img.naturalWidth > 0 && img.naturalHeight > 0 ? { image: img, width: img.naturalWidth, height: img.naturalHeight } : null
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

// The size an SVG draws at, in CSS pixels, from its viewBox or its width and height.
const PX: Record<string, number> = { '': 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, q: 96 / 101.6, in: 96, em: 16, rem: 16 }
function cssLength(text: string | null): number {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(text ?? '')
  const unit = m?.[2].toLowerCase() ?? ''
  return m && unit in PX ? Number(m[1]) * PX[unit] : 0
}

// Draw an SVG at about twice the stored size, so thin lines stay visible once it's reduced.
async function svgSource(file: File): Promise<Source> {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml')
  const svg = doc.documentElement
  if (doc.getElementsByTagName('parsererror').length || svg.localName !== 'svg') throw new PictureError(`${file.name} isn’t a valid SVG file.`)
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
  let w = cssLength(svg.getAttribute('width')), h = cssLength(svg.getAttribute('height'))
  if (hasBox) {
    if (!(w > 0 && h > 0)) { w = box[2]; h = box[3] }
  } else {
    if (!(w > 0 && h > 0)) { w = 300; h = 150 } // the size browsers give an SVG that doesn't say
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  }
  const scale = (PICTURE_MAX_SIDE * 2) / Math.max(w, h)
  svg.setAttribute('width', String(Math.max(1, Math.round(w * scale))))
  svg.setAttribute('height', String(Math.max(1, Math.round(h * scale))))
  const source = await native(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }))
  if (!source) throw new PictureError(`${file.name} could not be drawn. If it links to other files, embed them in the SVG and try again.`)
  return source
}

async function heicSource(file: File): Promise<Source> {
  const { heicTo } = await import('heic-to')
  return bitmap(await heicTo({ blob: file, type: 'bitmap' }))
}

async function tiffSource(file: File): Promise<Source> {
  const [{ default: UTIF }, pako] = await Promise.all([import('utif2'), import('pako')])
  // UTIF finds its inflater on the global object when it isn't loaded by require().
  ;(globalThis as unknown as { pako: unknown }).pako = pako
  const buffer = await file.arrayBuffer()
  const pages = UTIF.decode(buffer).filter(ifd => Number((ifd.t256 as number[] | undefined)?.[0]) > 0 && Number((ifd.t257 as number[] | undefined)?.[0]) > 0)
  if (!pages.length) throw new PictureError(`${file.name} has no picture in it.`)
  // A TIFF can hold several pages or a thumbnail: use the largest.
  const page = pages.reduce((a, b) => (Number((b.t256 as number[])[0]) * Number((b.t257 as number[])[0]) > Number((a.t256 as number[])[0]) * Number((a.t257 as number[])[0]) ? b : a))
  UTIF.decodeImage(buffer, page)
  const rgba = UTIF.toRGBA8(page)
  const data = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, page.width * page.height * 4), page.width, page.height)
  return bitmap(await createImageBitmap(data))
}

const UNREADABLE = (name: string) => `${name} could not be read. It may be damaged or saved in a form this browser can’t open. Save it again as JPG or PNG and try that.`

async function decode(file: File, kind: PictureKind): Promise<Source> {
  if (kind === 'svg') return svgSource(file)
  if (kind === 'psd') throw new PictureError(`${file.name} is a Photoshop file. Export it as JPG or PNG first.`)
  if (kind === 'pdf') throw new PictureError(`${file.name} is a PDF. Export the page as PNG or JPG first.`)
  if (kind === 'unknown') throw new PictureError(`${file.name} isn’t a picture Voronoi Studio can read. Use ${PICTURE_TYPES}.`)
  const own = await native(file)
  if (own) return own
  try {
    if (kind === 'heic') return await heicSource(file)
    if (kind === 'tiff') return await tiffSource(file)
  } catch (error) {
    if (error instanceof PictureError) throw error
    throw new PictureError(UNREADABLE(file.name))
  }
  if (kind === 'jxl') throw new PictureError(`${file.name} is a JPEG XL picture, which this browser can’t open. Save it as JPG or PNG first, or use Safari.`)
  throw new PictureError(UNREADABLE(file.name))
}

// Reduce to at most 512 pixels a side, on white, then to grey by brightness (Rec. 709 weights).
export function toGray(source: Source): { gray: Uint8Array; width: number; height: number } {
  const scale = Math.min(1, PICTURE_MAX_SIDE / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale))
  // Halve big photos in steps first: one large reduction skips pixels and looks grainy.
  let image: CanvasImageSource = source.image, w = source.width, h = source.height
  while (w > width * 2 && h > height * 2) {
    const step = document.createElement('canvas')
    step.width = Math.max(width, Math.round(w / 2)); step.height = Math.max(height, Math.round(h / 2))
    const c = step.getContext('2d')
    if (!c) break
    c.imageSmoothingQuality = 'high'
    c.drawImage(image, 0, 0, step.width, step.height)
    image = step; w = step.width; h = step.height
  }
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new PictureError('The browser could not draw the picture.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)
  const rgba = ctx.getImageData(0, 0, width, height).data
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2])
  return { gray, width, height }
}

export async function readPicture(file: File): Promise<DensityPicture> {
  const kind = pictureKind(new Uint8Array(await file.slice(0, 64).arrayBuffer()), file.name, file.type)
  const source = await decode(file, kind)
  try {
    const { gray, width, height } = toGray(source)
    // An SVG has no pixels of its own, so it reports the size it's used at.
    const vector = kind === 'svg'
    return { name: file.name, width, height, gray: encodeGray(gray), sourceWidth: vector ? width : source.width, sourceHeight: vector ? height : source.height }
  } finally { source.close?.() }
}
