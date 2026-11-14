// All design settings in one flat object, with defaults and allowed ranges. Lengths are millimetres.
// Project files store this object, so new settings must get a default here.
import type { DensityMode, DensitySettings } from '../voronoi/density'
import { sanitizePicture, type DensityPicture, type PictureFit } from '../voronoi/picture'
import type { CellStyle } from '../voronoi/pattern'
import type { Shape } from '../voronoi/region'
import { sanitizeShape, type CustomShape } from '../voronoi/shape'
import { MAX_POINTS, type Placement, type SeedSettings } from '../voronoi/seeding'
import type { Stretch } from '../voronoi/stretch'
import { metricGrid, type FieldKind, type FieldSpec } from '../voronoi/field'
import { regionArea } from '../voronoi/region'
import { patternRegion } from '../voronoi/pattern'
import { pictureTones, type PictureSettings } from '../voronoi/picture'
import type { ImportedVeins } from '../voronoi/pattern'
import type { VeinStart, VeinStyle } from '../voronoi/veins'
import { sanitizeVeins } from '../voronoi/veinLines'
import type { Units } from './units'

export type Settings = {
  // Sheet
  width: number; height: number; units: Units; dpi: number; shape: Shape; border: number; keepPoints: boolean
  customShape: CustomShape | null // the imported outline, kept when switching to another shape and back
  // Points
  count: number; placement: Placement; autoSpacing: boolean; spacing: number; tries: number; jitter: number; seed: number
  density: DensityMode; densityStrength: number; densityAngle: number; densityInvert: boolean
  // The picture for the Picture gradient, kept when switching to another gradient and back.
  densityPicture: DensityPicture | null; pictureFit: PictureFit; pictureContrast: number; pictureSoftness: number; pictureInvert: boolean
  // The picture's size as a percentage of Fit or Fill, and how far its centre is moved right and down, in mm.
  pictureScale: number; pictureX: number; pictureY: number
  // Stretch: how many times longer than wide cells are (1 is off), and the long direction in degrees.
  stretch: number; stretchAngle: number
  // What the stretch follows (fixed: One direction, the same everywhere), and that field's settings (see field.ts).
  stretchField: FieldKind; stretchTurn: number; stretchCentreX: number; stretchCentreY: number
  stretchWaves: number; stretchSwing: number; stretchCells: number; stretchScale: number; stretchSeed: number
  // Veins that split the pattern into regions (see veins.ts). veinLines: imported veins, kept when switching style.
  veins: VeinStyle; veinCount: number; veinStart: VeinStart; veinWidth: number; veinTaper: number; veinLines: ImportedVeins | null
  veinLoops: boolean // Leaf: veins join into loops (closed venation) instead of ending at the edge
  relaxSteps: number
  // Style
  cellStyle: CellStyle; web: number; cornerRadius: number; minHole: number
  wallsFollow: number // 0–100 %: walls between smaller cells get thinner
  lineWidth: number; lineColor: string; fill: boolean; fillColor: string; background: string
  showSites: boolean; showEdges: boolean; showDelaunay: boolean; showPicture: boolean
  // Export
  transparentPng: boolean; sheetOutline: boolean
}

export const DEFAULTS: Settings = {
  width: 200, height: 200, units: 'mm', dpi: 300, shape: 'rect', border: 5, keepPoints: true, customShape: null,
  count: 300, placement: 'even', autoSpacing: true, spacing: 10, tries: 30, jitter: 0.3, seed: 1,
  density: 'none', densityStrength: 4, densityAngle: 0, densityInvert: false,
  densityPicture: null, pictureFit: 'fit', pictureContrast: 0, pictureSoftness: 0, pictureInvert: false,
  pictureScale: 100, pictureX: 0, pictureY: 0,
  stretch: 1, stretchAngle: 0,
  stretchField: 'fixed', stretchTurn: 90, stretchCentreX: 50, stretchCentreY: 50, stretchWaves: 2, stretchSwing: 40, stretchCells: 1, stretchScale: 2, stretchSeed: 1,
  veins: 'none', veinCount: 8, veinStart: 'left', veinWidth: 1, veinTaper: 60, veinLines: null, veinLoops: true,
  relaxSteps: 3,
  cellStyle: 'lines', web: 2, cornerRadius: 1, minHole: 0.5, wallsFollow: 0,
  // The old Voronoi Lab's colours: dark MIT red edges on white.
  lineWidth: 0.3, lineColor: '#7a0f1f', fill: false, fillColor: '#f4d6da', background: '#ffffff',
  showSites: true, showEdges: true, showDelaunay: false, showPicture: true,
  transparentPng: false, sheetOutline: true,
}

type NumericKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings]
export const RANGES: Record<NumericKey, [number, number]> = {
  width: [5, 5000], height: [5, 5000], dpi: [36, 1200], border: [0, 500],
  count: [2, 10_000], spacing: [0.05, 1000], tries: [1, 100], jitter: [0, 1], seed: [0, 999_999],
  densityStrength: [1, 20], densityAngle: [0, 360], pictureContrast: [-100, 100], pictureSoftness: [0, 100], pictureScale: [10, 400], pictureX: [-5000, 5000], pictureY: [-5000, 5000],
  stretch: [1, 5], stretchAngle: [0, 180], stretchTurn: [0, 90], stretchCentreX: [0, 100], stretchCentreY: [0, 100],
  stretchWaves: [1, 12], stretchSwing: [0, 80], stretchCells: [1, 8], stretchScale: [1, 12], stretchSeed: [0, 999_999], veinCount: [2, 60], veinWidth: [0.05, 50], veinTaper: [0, 90], relaxSteps: [0, 50],
  web: [0, 100], cornerRadius: [0, 100], minHole: [0, 200], lineWidth: [0.005, 20], wallsFollow: [0, 100],
}

const CHOICES = {
  units: ['mm', 'in', 'px', 'pc'], shape: ['rect', 'ellipse', 'custom'], placement: ['random', 'even', 'hex', 'square'],
  density: ['none', 'linear', 'radial', 'picture'], pictureFit: ['fit', 'fill'], cellStyle: ['lines', 'holes'],
  veins: ['none', 'wing', 'leaf', 'imported'],
  stretchField: ['fixed', 'centre', 'saddle', 'wave', 'cells', 'noise', 'curl', 'veins', 'picture'], veinStart: ['left', 'right', 'top', 'bottom', 'centre'],
} as const

// Settings that decide where points go. Changing one makes a new pattern (unless points were edited).
export const SEED_KEYS: (keyof Settings)[] = ['count', 'placement', 'autoSpacing', 'spacing', 'tries', 'jitter', 'seed',
  'density', 'densityStrength', 'densityAngle', 'densityInvert',
  'densityPicture', 'pictureFit', 'pictureContrast', 'pictureSoftness', 'pictureInvert', 'pictureScale', 'pictureX', 'pictureY', 'stretch', 'stretchAngle',
  'stretchField', 'stretchTurn', 'stretchCentreX', 'stretchCentreY', 'stretchWaves', 'stretchSwing', 'stretchCells', 'stretchScale', 'stretchSeed',
  'veins', 'veinCount', 'veinStart', 'veinWidth', 'veinTaper', 'veinLines', 'veinLoops', 'relaxSteps']
// Settings that move the region points live in. With "Keep points" on, points follow the sheet instead.
export const SHEET_KEYS: (keyof Settings)[] = ['width', 'height', 'shape', 'border', 'customShape']

export function clampSetting<K extends NumericKey>(key: K, value: number): number {
  const [lo, hi] = RANGES[key]
  return Math.min(hi, Math.max(lo, value))
}

// Copy known settings from untrusted data, falling back to defaults for anything missing or out of range.
export function sanitizeSettings(raw: unknown): Settings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = source[key], fallback = DEFAULTS[key]
    if (key === 'customShape') out[key] = sanitizeShape(value)
    else if (key === 'densityPicture') out[key] = sanitizePicture(value)
    else if (key === 'veinLines') out[key] = sanitizeVeins(value)
    else if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = clampSetting(key as NumericKey, value)
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') out[key] = value
    } else if (key in CHOICES) {
      if ((CHOICES[key as keyof typeof CHOICES] as readonly string[]).includes(value as string)) out[key] = value
    } else if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) out[key] = value.toLowerCase()
  }
  // A custom sheet without its outline can't be drawn, so it becomes a rectangle.
  if (out.shape === 'custom' && !out.customShape) out.shape = 'rect'
  // The same goes for a Picture gradient without its picture.
  if (out.density === 'picture' && !out.densityPicture) out.density = 'none'
  // And imported veins without their lines.
  if (out.veins === 'imported' && !out.veinLines) out.veins = 'none'
  // Files from before Leaf loops (1.9.0) keep their open Leaf veins.
  if (!('veinLoops' in source)) out.veinLoops = false
  return out as Settings
}

// The density picture and how it's placed, whichever gradient is on (the stretch can follow it too).
export function pictureSettingsOf(s: Settings): PictureSettings | null {
  return s.densityPicture ? {
    picture: s.densityPicture, fit: s.pictureFit, contrast: s.pictureContrast, softness: s.pictureSoftness, invert: s.pictureInvert,
    sheetWidth: s.width, sheetHeight: s.height, scale: s.pictureScale, offsetX: s.pictureX, offsetY: s.pictureY,
  } : null
}

export function densitySettings(s: Settings): DensitySettings {
  const picture = s.density === 'picture' ? pictureSettingsOf(s) : null
  return { mode: s.density, strength: s.densityStrength, angle: s.densityAngle, invert: s.densityInvert, picture }
}

// Whether the stretch can follow its field: Along the veins needs veins on, Along the picture a density
// picture. Without them it keeps one direction (Direction).
export const fieldReady = (s: Settings): boolean =>
  s.stretchField === 'veins' ? s.veins !== 'none' && Boolean(patternRegion(s).veins?.length)
    : s.stretchField === 'picture' ? Boolean(s.densityPicture) : s.stretchField !== 'fixed'

// The share of the sheet where cells can follow the stretch's field (they get at least half the stretch), for
// `count` cells; null without a field. The grid is the one the pattern itself uses, so this costs nothing extra.
export function fieldShare(s: Settings, count: number): number | null {
  const field = stretchOf(s)?.field
  if (!field || count < 1) return null
  const region = patternRegion(s)
  return metricGrid(field, region, Math.sqrt(regionArea(region) / count)).kept
}

// The stretch, and the field it follows unless that's One direction (or can't be followed yet). The same
// settings give the same object, so the page only rebuilds the pattern when the stretch really changes.
let lastStretch: { key: string; veins: unknown; tones: unknown; value: Stretch } | null = null
export function stretchOf(s: Settings): Stretch | null {
  if (!(s.stretch > 1)) return null
  const kind = s.stretchField, ready = fieldReady(s)
  const veins = ready && kind === 'veins' ? patternRegion(s).veins ?? null : null
  const pic = ready && kind === 'picture' ? pictureSettingsOf(s) : null
  const tones = pic ? pictureTones(pic) : null
  const key = JSON.stringify(ready ? [kind, s.stretch, s.stretchAngle, s.stretchCentreX, s.stretchCentreY, s.stretchTurn, s.stretchWaves,
    s.stretchSwing, s.stretchCells, s.stretchScale, s.stretchSeed, s.width, s.height] : [s.stretch, s.stretchAngle])
  if (lastStretch && lastStretch.key === key && lastStretch.veins === veins && lastStretch.tones === tones) return lastStretch.value
  const field: FieldSpec | null = ready ? {
    kind, amount: s.stretch, angle: s.stretchAngle, centre: [s.stretchCentreX / 100, s.stretchCentreY / 100], turn: s.stretchTurn,
    waves: s.stretchWaves, swing: s.stretchSwing, cells: s.stretchCells, scale: s.stretchScale, seed: s.stretchSeed, sheet: [s.width, s.height],
    veins, tones,
  } : null
  const value: Stretch = field ? { amount: s.stretch, angle: s.stretchAngle, field } : { amount: s.stretch, angle: s.stretchAngle }
  lastStretch = { key, veins, tones, value }
  return value
}

export function seedSettings(s: Settings): SeedSettings {
  return {
    count: Math.min(MAX_POINTS, s.count), placement: s.placement, autoSpacing: s.autoSpacing, spacing: s.spacing,
    tries: s.tries, jitter: s.jitter, seed: s.seed,
    density: densitySettings(s), stretch: stretchOf(s),
  }
}
