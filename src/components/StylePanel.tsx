import { memo } from 'react'
import { RANGES, type Settings } from '../lib/settings'
import type { CellStyle } from '../voronoi/pattern'
import { ColorField, LengthField, Section, Segmented, SliderField, SwitchField, type Option } from './Controls'
import type { Change } from './PatternPanel'

const STYLES: Option<CellStyle>[] = [
  { value: 'lines', label: 'Lines', tip: 'Cell edges as single lines, for engraving, plotting, print or cutting cells apart.' },
  { value: 'holes', label: 'Holes', tip: 'Each cell cut out as a hole with rounded corners, leaving a web of material between them.' },
]

// Memoised: the panel only re-renders when its own props change, not on every relax step.
export const StylePanel = memo(function StylePanel({ s, change, holes, dropped }: { s: Settings; change: Change; holes: number; dropped: number }) {
  const len = { units: s.units, dpi: s.dpi, small: true }
  return <>
    <Section title="Cells">
      <Segmented label="Cell style" options={STYLES} value={s.cellStyle} onChange={cellStyle => change({ cellStyle }, 'cellStyle')} />
      <p className="hint">{s.cellStyle === 'holes'
        ? 'Holes: cut-outs with a solid web between them, the classic laser-cut or 3D-printed Voronoi panel.'
        : 'Lines: each edge drawn once, so cutters and plotters never go over a line twice.'}</p>
      {s.cellStyle === 'holes' && <>
        <LengthField label="Web width" mm={s.web} min={RANGES.web[0]} max={RANGES.web[1]} {...len}
          tip="Width of the material left between neighbouring holes." onChange={web => change({ web }, 'web')} />
        <LengthField label="Corner radius" mm={s.cornerRadius} min={RANGES.cornerRadius[0]} max={RANGES.cornerRadius[1]} {...len}
          tip="Rounds the corners of each hole. Small holes get the largest radius that fits. Match your end mill radius for CNC." onChange={cornerRadius => change({ cornerRadius }, 'cornerRadius')} />
        <LengthField label="Smallest hole" mm={s.minHole} min={RANGES.minHole[0]} max={RANGES.minHole[1]} {...len}
          tip="Holes narrower than this are left solid, so tiny slivers don't burn or break." onChange={minHole => change({ minHole }, 'minHole')} />
        {holes === 0 && dropped > 0
          ? <div className="notice" role="status"><p>No holes fit: the web or the smallest hole is wider than the cells. Use a thinner web, a smaller smallest hole, or fewer cells.</p></div>
          : dropped > 0 && <p className="hint">{dropped.toLocaleString()} {dropped === 1 ? 'cell is' : 'cells are'} left solid because {dropped === 1 ? 'it is' : 'they are'} narrower than the smallest hole.</p>}
      </>}
      <SliderField label="Walls follow cell size" value={s.wallsFollow} min={RANGES.wallsFollow[0]} max={RANGES.wallsFollow[1]} step={5}
        format={v => (v ? `${v} %` : 'Off')}
        tip={s.cellStyle === 'holes' ? 'Thinner web between smaller cells, as a wing’s veins thin where its cells are small. At 100 %, cells half as wide get half the web.'
          : 'Thinner lines between smaller cells, as a wing’s veins thin where its cells are small. Laser files keep hairlines.'}
        onChange={wallsFollow => change({ wallsFollow }, 'wallsFollow')} />
    </Section>

    <Section title="Colour and line">
      <LengthField label="Line width" mm={s.lineWidth} min={RANGES.lineWidth[0]} max={RANGES.lineWidth[1]} {...len}
        tip="Stroke width in the preview, PNG and artwork SVG. Laser files always use hairlines." onChange={lineWidth => change({ lineWidth }, 'lineWidth')} />
      <ColorField label="Line colour" value={s.lineColor} tip="Colour of the cell edges." onChange={lineColor => change({ lineColor }, 'lineColor')} />
      <SwitchField label={s.cellStyle === 'holes' ? 'Fill holes' : 'Fill cells'} checked={s.fill}
        tip={s.cellStyle === 'holes' ? 'Colour the inside of each hole.' : 'Colour the area inside the pattern.'} onChange={fill => change({ fill }, 'fill')} />
      {s.fill && <ColorField label="Fill colour" value={s.fillColor} tip="Colour inside the cells." onChange={fillColor => change({ fillColor }, 'fillColor')} />}
      <ColorField label={s.cellStyle === 'holes' ? 'Material colour' : 'Background'} value={s.background}
        tip="Colour of the sheet behind the pattern." onChange={background => change({ background }, 'background')} />
      <p className="hint">Sites, edges and Delaunay lines switch on and off in the bar above the sheet, in the view and in every export.</p>
    </Section>
  </>
})
