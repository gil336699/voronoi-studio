// Density from a picture: dark parts get small cells, or light parts when inverted. The picture is kept as a
// small grey image, at most 512 pixels a side, and fitted to the sheet. Relaxing weights each cell's centre by
// the picture, integrated exactly over its pixels with running sums along each row (Secord 2002, "Weighted
// Voronoi Stippling"), so edges in the picture stay sharp and the points settle.
import type { Cell } from './diagram'
import type { Vec } from './geometry'

export const PICTURE_MAX_SIDE = 512
export type PictureFit = 'fit' | 'fill'
// gray: one byte a pixel, row by row from the top left, 0 black to 255 white, as base64. Transparent parts
// were laid on white. sourceWidth and sourceHeight are the original file's pixel size, for the readout.
export type DensityPicture = { name: string; width: number; height: number; gray: string; sourceWidth: number; sourceHeight: number }
// contrast: -100 to 100 %. softness: blur in mm. invert: light parts get the small cells. scale: size as a
// percentage of the Fit or Fill size (100 if missing). offsetX, offsetY: how far the picture's centre sits right
// of and below the sheet's centre, in mm.
export type PictureSettings = {
  picture: DensityPicture; fit: PictureFit; contrast: number; softness: number; invert: boolean
  sheetWidth: number; sheetHeight: number
  scale?: number; offsetX?: number; offsetY?: number
}

// Tones run from 0 (the largest cells) to 1 (the smallest) after levels, contrast, inverting and softness.
export type PictureTones = {
  cols: number; rows: number
  k: number // millimetres per pixel
  ox: number; oy: number // the picture's top-left corner on the sheet, mm
  tone: Float32Array
  outside: number // the tone around the picture, which counts as white paper
}
// Density per pixel (1 to the strength) and the relax weight, density squared, with running sums along each
// row: p[j][i] is the sum of the weights left of pixel i, and q[j][i] the sum of weight × (column + ½).
export type PictureGrid = PictureTones & { d: Float32Array; dOut: number; w: Float32Array; wOut: number; p: Float64Array; q: Float64Array }

export function encodeGray(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export function decodeGray(base64: string): Uint8Array {
  const text = atob(base64)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out
}

const whole = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

// Copy a picture from untrusted data. Anything malformed means no picture.
export function sanitizePicture(raw: unknown): DensityPicture | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const { width, height, gray } = r
  if (!whole(width, 1, PICTURE_MAX_SIDE) || !whole(height, 1, PICTURE_MAX_SIDE) || typeof gray !== 'string') return null
  try { if (decodeGray(gray).length !== width * height) return null } catch { return null }
  const big = 1_000_000
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 200) : 'picture',
    width, height, gray,
    sourceWidth: whole(r.sourceWidth, 1, big) ? r.sourceWidth : width,
    sourceHeight: whole(r.sourceHeight, 1, big) ? r.sourceHeight : height,
  }
}

// Where the picture sits: Fit shows all of it, centred, with white paper around it; Fill covers the sheet,
// centred, cutting off what overhangs. Scale then resizes it about its centre, and the offsets move it.
// Pixels stay square.
export function picturePlacement(p: PictureSettings): { k: number; ox: number; oy: number } {
  const { width: cols, height: rows } = p.picture
  const kx = p.sheetWidth / cols, ky = p.sheetHeight / rows
  const scale = Math.max(1e-3, (p.scale ?? 100) / 100)
  const k = Math.max(1e-9, (p.fit === 'fill' ? Math.max(kx, ky) : Math.min(kx, ky)) * scale)
  return { k, ox: (p.sheetWidth - cols * k) / 2 + (p.offsetX ?? 0), oy: (p.sheetHeight - rows * k) / 2 + (p.offsetY ?? 0) }
}

// The picture's outline on the sheet, in mm.
export type PictureBox = { x0: number; y0: number; x1: number; y1: number }
export function pictureBox(p: PictureSettings): PictureBox {
  const { k, ox, oy } = picturePlacement(p)
  return { x0: ox, y0: oy, x1: ox + p.picture.width * k, y1: oy + p.picture.height * k }
}
// Corners in order round the picture: top left, top right, bottom right, bottom left.
export const boxCorners = (b: PictureBox): [number, number][] => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]

export const SCALE_RANGE: [number, number] = [10, 400]
const round2 = (v: number) => Math.round(v * 100) / 100

// Dragging a corner to x, y: the opposite corner stays put and the picture keeps its proportions. The size is
// the drag projected onto the diagonal, in whole percent from 10 to 400 %.
export function resizePicture(p: PictureSettings, corner: number, x: number, y: number): { scale: number; offsetX: number; offsetY: number } {
  const corners = boxCorners(pictureBox(p))
  const [cx, cy] = corners[corner], [ax, ay] = corners[(corner + 2) % 4]
  const vx = cx - ax, vy = cy - ay
  const scale0 = p.scale ?? 100
  const along = ((x - ax) * vx + (y - ay) * vy) / Math.max(1e-12, vx * vx + vy * vy)
  const scale = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], Math.round(scale0 * along)))
  const f = scale / scale0
  // The new centre is half the new diagonal from the corner that stays put.
  return { scale, offsetX: round2(ax + (vx * f) / 2 - p.sheetWidth / 2), offsetY: round2(ay + (vy * f) / 2 - p.sheetHeight / 2) }
}

// Radii of three box blurs that together approximate a Gaussian blur of this sigma (in pixels).
function boxRadii(sigma: number): number[] {
  const n = 3
  let wl = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1))
  if (wl % 2 === 0) wl--
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4))
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wl + 2) - 1) / 2)
}

// One box blur along every row (step 1) or column (step cols), with the paper's tone beyond the picture.
function boxPass(a: Float32Array, n: number, lines: number, lineStride: number, step: number, r: number, outside: number, buf: Float32Array) {
  if (r < 1) return
  const scale = 1 / (2 * r + 1)
  for (let line = 0; line < lines; line++) {
    const base = line * lineStride
    for (let i = 0; i < n; i++) buf[i] = a[base + i * step]
    // The window around the first pixel: r pixels of paper to the left, then the line, then more paper.
    let sum = outside * (r + Math.max(0, r - (n - 1)))
    for (let i = 0; i <= Math.min(r, n - 1); i++) sum += buf[i]
    for (let i = 0; i < n; i++) {
      a[base + i * step] = sum * scale
      const add = i + r + 1, drop = i - r
      sum += (add < n ? buf[add] : outside) - (drop >= 0 ? buf[drop] : outside)
    }
  }
}

function makeTones(p: PictureSettings): PictureTones {
  const { width: cols, height: rows } = p.picture
  const gray = decodeGray(p.picture.gray)
  // Levels: the darkest pixel becomes black and the lightest white, so Strength reaches its full range.
  let lo = 255, hi = 0
  for (let i = 0; i < gray.length; i++) { const g = gray[i]; if (g < lo) lo = g; if (g > hi) hi = g }
  if (hi <= lo) { lo = 0; hi = 255 } // a flat picture keeps its tone
  const gain = 2 ** (Math.max(-100, Math.min(100, p.contrast)) / 50) // -100 % flattens to a quarter, +100 % steepens fourfold
  const toneOf = (g: number) => {
    const level = Math.min(1, Math.max(0, (g - lo) / (hi - lo)))
    const shade = Math.min(1, Math.max(0, 0.5 + (level - 0.5) * gain))
    return p.invert ? shade : 1 - shade
  }
  const lut = new Float32Array(256)
  for (let g = 0; g < 256; g++) lut[g] = toneOf(g)
  const tone = new Float32Array(cols * rows)
  for (let i = 0; i < tone.length; i++) tone[i] = lut[gray[i]]
  const outside = toneOf(255)
  const { k, ox, oy } = picturePlacement(p)
  const sigma = Math.max(0, p.softness) / k
  if (sigma >= 0.5) {
    const buf = new Float32Array(Math.max(cols, rows))
    for (const r of boxRadii(sigma)) {
      const radius = Math.round(r)
      boxPass(tone, cols, rows, cols, 1, radius, outside, buf)
      boxPass(tone, rows, cols, 1, cols, radius, outside, buf)
    }
  }
  return { cols, rows, k, ox, oy, tone, outside }
}

function makeGrid(t: PictureTones, strength: number): PictureGrid {
  const { cols, rows, tone } = t
  const s = Math.max(1, strength)
  const d = new Float32Array(cols * rows), w = new Float32Array(cols * rows)
  const p = new Float64Array((cols + 1) * rows), q = new Float64Array((cols + 1) * rows)
  for (let j = 0; j < rows; j++) {
    let sp = 0, sq = 0
    for (let i = 0; i < cols; i++) {
      const at = j * cols + i
      const density = s ** tone[at]
      d[at] = density
      w[at] = density * density
      p[j * (cols + 1) + i] = sp; q[j * (cols + 1) + i] = sq
      sp += w[at]; sq += w[at] * (i + 0.5)
    }
    p[j * (cols + 1) + cols] = sp; q[j * (cols + 1) + cols] = sq
  }
  const dOut = s ** t.outside
  return { ...t, d, w, dOut, wOut: dOut * dOut, p, q }
}

// The last tones and grid made, so a relax step or a redraw with the same picture and settings reuses them.
// The picture's base64 text is compared as well as the settings: two pictures can share a name and size.
let tonesCache: { key: string; gray: string; tones: PictureTones } | null = null
let gridCache: { tones: PictureTones; strength: number; grid: PictureGrid } | null = null

export function pictureTones(p: PictureSettings): PictureTones {
  const key = [p.picture.width, p.picture.height, p.fit, p.contrast, p.softness, p.invert, p.sheetWidth, p.sheetHeight, p.scale ?? 100, p.offsetX ?? 0, p.offsetY ?? 0].join('|')
  if (tonesCache && tonesCache.key === key && tonesCache.gray === p.picture.gray) return tonesCache.tones
  const tones = makeTones(p)
  tonesCache = { key, gray: p.picture.gray, tones }
  return tones
}

export function pictureGrid(p: PictureSettings, strength: number): PictureGrid {
  const tones = pictureTones(p)
  if (gridCache && gridCache.tones === tones && gridCache.strength === strength) return gridCache.grid
  const grid = makeGrid(tones, strength)
  gridCache = { tones, strength, grid }
  return grid
}

// The density at a point on the sheet.
export function pictureDensityAt(g: PictureGrid, x: number, y: number): number {
  const i = Math.floor((x - g.ox) / g.k), j = Math.floor((y - g.oy) / g.k)
  return i < 0 || j < 0 || i >= g.cols || j >= g.rows ? g.dOut : g.d[j * g.cols + i]
}

// Parameters where an edge crosses a pixel line, reused between calls.
let crossings = new Float64Array(64)

// The weighted centre of a cell, exact for a picture made of flat pixels. By Green's theorem, the weight over
// an area is the integral of P dv around its outline, where P(u) is the weight summed along the row from the
// left edge. P is a running sum plus a linear piece inside each pixel, so splitting each edge where it
// crosses pixel lines makes every piece's integral exact. The first moments use Q (the running sum of
// weight × u) and v × P the same way. Coordinates are in pixels; null if the cell has no weight.
export function pictureCentroid(cell: Cell, g: PictureGrid): Vec | null {
  const { cols, rows, k, ox, oy, w, wOut, p, q } = g
  const stride = cols + 1
  let mass = 0, mu = 0, mv = 0
  const piece = (ua: number, va: number, ub: number, vb: number) => {
    const um = (ua + ub) / 2, vm = (va + vb) / 2
    const i = Math.floor(um), j = Math.floor(vm)
    // Inside a piece the row's P(u) = A + c·u and Q(u) = B + c·u²/2.
    let A = 0, B = 0, c = wOut
    if (j >= 0 && j < rows) {
      if (i >= cols) { A = p[j * stride + cols] - wOut * cols; B = q[j * stride + cols] - (wOut * cols * cols) / 2 }
      else if (i >= 0) { c = w[j * cols + i]; A = p[j * stride + i] - c * i; B = q[j * stride + i] - (c * i * i) / 2 }
    }
    const dv = vb - va
    mass += dv * (A + c * um)
    mu += dv * (B + (c * (ua * ua + ua * ub + ub * ub)) / 6)
    mv += dv * (A * vm + (c * (2 * ua * va + ua * vb + ub * va + 2 * ub * vb)) / 6)
  }
  for (const ring of cell) {
    const n = ring.length
    for (let e = 0; e < n; e++) {
      const a = ring[e], b = ring[(e + 1) % n]
      const u0 = (a[0] - ox) / k, v0 = (a[1] - oy) / k, u1 = (b[0] - ox) / k, v1 = (b[1] - oy) / k
      if (v0 === v1) continue // horizontal edges add nothing
      const du = u1 - u0, dv = v1 - v0
      const uFrom = Math.max(0, Math.floor(Math.min(u0, u1)) + 1), uTo = Math.min(cols, Math.ceil(Math.max(u0, u1)) - 1)
      const vFrom = Math.max(0, Math.floor(Math.min(v0, v1)) + 1), vTo = Math.min(rows, Math.ceil(Math.max(v0, v1)) - 1)
      const count = Math.max(0, uTo - uFrom + 1) + Math.max(0, vTo - vFrom + 1)
      if (count === 0) { piece(u0, v0, u1, v1); continue }
      if (crossings.length < count) crossings = new Float64Array(count * 2)
      let m = 0
      if (du !== 0) for (let line = uFrom; line <= uTo; line++) crossings[m++] = (line - u0) / du
      for (let line = vFrom; line <= vTo; line++) crossings[m++] = (line - v0) / dv
      const ts = crossings.subarray(0, m).sort()
      let t0 = 0, pu = u0, pv = v0
      for (let x = 0; x <= m; x++) {
        const t1 = x < m ? ts[x] : 1
        if (t1 <= t0) continue
        const nu = x < m ? u0 + du * t1 : u1, nv = x < m ? v0 + dv * t1 : v1
        piece(pu, pv, nu, nv)
        t0 = t1; pu = nu; pv = nv
      }
    }
  }
  if (!(Math.abs(mass) > 1e-12)) return null
  return [ox + (mu / mass) * k, oy + (mv / mass) * k]
}

// The tones as an RGBA grey image for the on-screen guide and exports: the picture as it drives the
// pattern, after levels, contrast and softness, with dark meaning dark (not inverted).
export function previewPixels(t: PictureTones, invert: boolean): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(t.cols * t.rows * 4)
  for (let i = 0; i < t.tone.length; i++) {
    const v = Math.round(255 * (invert ? t.tone[i] : 1 - t.tone[i]))
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255
  }
  return out
}
