import { matchPreset, presetSize, SHEET_PRESETS } from '../lib/presets'
import { RANGES, type Settings } from '../lib/settings'
import { pixelSize, type Units } from '../lib/units'
import type { Shape } from '../voronoi/region'
import { Button, LengthField, NumberField, Section, Segmented, SwitchField, type Option } from './Controls'
import { Icon } from './Icon'
import type { Change } from './PatternPanel'

const UNITS: Option<Units>[] = [
  { value: 'mm', label: 'mm', tip: 'Show lengths in millimetres.' },
  { value: 'in', label: 'in', tip: 'Show lengths in inches. SVG and DXF files are written in inches too.' },
  { value: 'px', label: 'px', tip: 'Show lengths in pixels at the pixels per inch below, for screen graphics.' },
  { value: 'pc', label: 'pica', tip: 'Show lengths in picas (6 per inch), for print layouts.' },
]
const SHAPES: Option<Shape>[] = [
  { value: 'rect', label: 'Rectangle', tip: 'A rectangular sheet.' },
  { value: 'ellipse', label: 'Ellipse', tip: 'A round or oval sheet that fits the width and height, such as a coaster or a round panel.' },
]

export function SheetPanel({ s, change }: { s: Settings; change: Change }) {
  const preset = matchPreset(s.width, s.height, s.shape, s.units, s.dpi)
  const [pw, ph] = pixelSize(s.width, s.height, s.dpi)
  const maxBorder = Math.min(s.width, s.height) / 3
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
          tip="Sheet width. Changing units converts this number; the sheet keeps its size." onChange={width => change({ width }, 'width')} />
        <Button className="icon-button swap" label="Swap width and height" tip="Swap width and height, to turn the sheet on its side."
          onClick={() => change({ width: s.height, height: s.width }, 'swap')}><Icon name="swap" /></Button>
        <LengthField label="Height" mm={s.height} min={RANGES.height[0]} max={RANGES.height[1]} units={s.units} dpi={s.dpi} compact
          tip="Sheet height." onChange={height => change({ height }, 'height')} />
      </div>
      <p className="hint">{pw.toLocaleString()} × {ph.toLocaleString()} px at {s.dpi} pixels per inch.</p>
      <Segmented label="Shape" options={SHAPES} value={s.shape} onChange={shape => change({ shape }, 'shape')} />
    </Section>

    <Section title="Layout">
      <LengthField label="Border" mm={Math.min(s.border, maxBorder)} min={0} max={maxBorder} units={s.units} dpi={s.dpi} small
        tip={s.cellStyle === 'holes' ? 'Width of the solid frame between the sheet edge and the holes.' : 'Gap between the sheet edge and the pattern.'}
        onChange={border => change({ border }, 'border')} />
      <NumberField label="Pixels per inch" value={s.dpi} min={RANGES.dpi[0]} max={RANGES.dpi[1]} suffix="ppi"
        tip="Resolution for pixel sizes and PNG export. 300 suits print; 72–144 suits screens." onChange={dpi => change({ dpi: Math.round(dpi) }, 'dpi')} />
      <SwitchField label="Keep points when the sheet changes" checked={s.keepPoints}
        tip="On: points stretch to the new size or shape. Off: a new pattern is made (unless you edited points by hand)."
        onChange={keepPoints => change({ keepPoints }, 'keepPoints')} />
    </Section>
  </>
}
