import { memo } from 'react'
import { matchPreset, presetSize, SHEET_PRESETS } from '../lib/presets'
import { RANGES, type Settings } from '../lib/settings'
import { formatLength, pixelSize, type Units } from '../lib/units'
import type { Shape } from '../voronoi/region'
import { holeCount } from '../voronoi/shape'
import { Button, LengthField, NumberField, Section, Segmented, SwitchField, type Option } from './Controls'
import { Icon } from './Icon'
import type { Change } from './PatternPanel'

const UNITS: Option<Units>[] = [
  { value: 'mm', label: 'mm', tip: 'Show lengths in millimetres.' },
  { value: 'in', label: 'in', tip: 'Show lengths in inches. SVG and DXF files are written in inches too.' },
  { value: 'px', label: 'px', tip: 'Show lengths in pixels at the pixels per inch below, for screen graphics.' },
  { value: 'pc', label: 'pica', tip: 'Show lengths in picas (6 per inch), for print layouts.' },
]
const shapes = (imported: boolean): Option<Shape>[] => [
  { value: 'rect', label: 'Rectangle', tip: 'A rectangular sheet.' },
  { value: 'ellipse', label: 'Ellipse', tip: 'A round or oval sheet that fits the width and height, such as a coaster or a round panel.' },
  { value: 'custom', label: 'Imported', tip: 'The outline you imported from an SVG, with its holes.', unavailable: !imported && 'Import an SVG shape first, with the button below.' },
]
const ASSUMED = {
  css: 'The file doesn’t say how big it is, so it was read at 96 units per inch, the web standard. Check the width and height.',
  illustrator: 'The file doesn’t say how big it is. It looks like it came from Illustrator, so it was read at 72 units per inch. Check the width and height.',
}

// Memoised: the panel only re-renders when its own props change, not on every relax step.
export const SheetPanel = memo(function SheetPanel({ s, change, onImportShape, noRoom }: { s: Settings; change: Change; onImportShape: () => void; noRoom: boolean }) {
  const preset = matchPreset(s.width, s.height, s.shape, s.units, s.dpi)
  const [pw, ph] = pixelSize(s.width, s.height, s.dpi)
  const maxBorder = Math.min(s.width, s.height) / 3
  const custom = s.shape === 'custom' ? s.customShape : null
  // An imported shape keeps its proportions, so width and height move together.
  const aspect = custom ? custom.width / custom.height : null
  const holes = s.customShape ? holeCount(s.customShape) : 0
  return <>
    <Section title="Size">
      <label className="field" data-tip="Common sheet sizes. Choosing one sets the size, shape and units.">
        <span className="field-label"><span>Preset</span></span>
        <select value={preset} onChange={event => {
          const p = SHEET_PRESETS.find(item => item.id === event.currentTarget.value)
          if (!p) return
          const [width, height] = presetSize(p, s.dpi)
          change({ width, height, units: p.units, shape: p.shape }, 'preset')
        }}>
          <option value="custom">Custom…</option>
          {SHEET_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <Segmented label="Units" options={UNITS} value={s.units} onChange={units => change({ units }, 'units')} />
      <div className="pair">
        <LengthField label="Width" mm={s.width} min={RANGES.width[0]} max={RANGES.width[1]} units={s.units} dpi={s.dpi} compact
          tip={aspect ? 'Sheet width. The height follows, keeping the imported shape’s proportions.' : 'Sheet width. Changing units converts this number; the sheet keeps its size.'}
          onChange={width => change(aspect ? { width, height: width / aspect } : { width }, 'width')} />
        <Button className="icon-button swap" label="Swap width and height" tip="Swap width and height, to turn the sheet on its side."
          unavailable={Boolean(aspect) && 'Swapping would stretch the imported shape. Rotate it in your drawing app instead.'}
          onClick={() => change({ width: s.height, height: s.width }, 'swap')}><Icon name="swap" /></Button>
        <LengthField label="Height" mm={s.height} min={RANGES.height[0]} max={RANGES.height[1]} units={s.units} dpi={s.dpi} compact
          tip={aspect ? 'Sheet height. The width follows, keeping the imported shape’s proportions.' : 'Sheet height.'}
          onChange={height => change(aspect ? { height, width: height * aspect } : { height }, 'height')} />
      </div>
      <p className="hint">{pw.toLocaleString()} × {ph.toLocaleString()} px at {s.dpi} pixels per inch.</p>
      <Segmented label="Shape" options={shapes(Boolean(s.customShape))} value={s.shape} onChange={shape => {
        // Back to the imported shape at the current width, with the height that keeps it from stretching.
        if (shape === 'custom' && s.customShape) change({ shape, height: s.width * (s.customShape.height / s.customShape.width) }, 'shape')
        else change({ shape }, 'shape')
      }} />
      <Button className="wide" tip="Use a closed outline from an SVG file as the sheet, from Illustrator, Inkscape, Figma or a cut file. Shapes inside it become holes. You can also drop an SVG on the window."
        onClick={onImportShape}><Icon name="import" />Import SVG shape…</Button>
      {s.customShape && <p className="hint">
        <b>{s.customShape.name}</b>: {formatLength(s.customShape.width, s.units, s.dpi)} × {formatLength(s.customShape.height, s.units, s.dpi)} as imported
        {holes ? `, ${holes} ${holes === 1 ? 'hole' : 'holes'}` : ''}.{custom ? '' : ' Choose Imported to use it.'}
      </p>}
      {custom && custom.sized !== 'file' && <div className="notice" role="status"><p>{ASSUMED[custom.sized]}</p></div>}
    </Section>

    <Section title="Layout">
      <LengthField label="Border" mm={Math.min(s.border, maxBorder)} min={0} max={maxBorder} units={s.units} dpi={s.dpi} small
        tip={s.cellStyle === 'holes' ? 'Width of the solid frame between the sheet edge and the holes.' : 'Gap between the sheet edge and the pattern.'}
        onChange={border => change({ border }, 'border')} />
      {noRoom && <div className="notice" role="status"><p>No cells fit inside this border: every part of the shape is narrower than twice the border. Lower the border to make room.</p></div>}
      <NumberField label="Pixels per inch" value={s.dpi} min={RANGES.dpi[0]} max={RANGES.dpi[1]} suffix="ppi"
        tip="Resolution for pixel sizes and PNG export. 300 suits print; 72–144 suits screens." onChange={dpi => change({ dpi: Math.round(dpi) }, 'dpi')} />
      <SwitchField label="Keep points when the sheet changes" checked={s.keepPoints}
        tip="On: points stretch to the new size or shape. Off: a new pattern is made (unless you edited points by hand)."
        onChange={keepPoints => change({ keepPoints }, 'keepPoints')} />
    </Section>
  </>
})
