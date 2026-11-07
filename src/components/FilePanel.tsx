import { pngProblem } from '../lib/render'
import type { Settings } from '../lib/settings'
import { pixelSize, UNIT_NAME } from '../lib/units'
import { Button, Section, SwitchField } from './Controls'
import type { Change } from './PatternPanel'

export type ExportKind = 'png' | 'svg' | 'laser' | 'dxf'

export function FilePanel({ s, change, unsaved, busy, onNew, onOpen, onSave, onExport, openError }: {
  s: Settings; change: Change; unsaved: boolean; busy: boolean
  onNew: () => void; onOpen: () => void; onSave: () => void; onExport: (kind: ExportKind) => void; openError: string
}) {
  const [pw, ph] = pixelSize(s.width, s.height, s.dpi)
  const pngBlocked = pngProblem(pw, ph)
  const fileUnits = s.units === 'in' ? 'inches' : 'millimetres'
  const working = busy && 'Wait for the pattern to finish updating.'
  return <>
    <Section title="Project">
      <p className="hint save-state">{unsaved ? <><span className="dot" aria-hidden="true" />Unsaved changes since the last save.</> : 'All changes saved.'}</p>
      <div className="button-row three">
        <Button tip="Start a new design with the default settings." onClick={onNew}>New</Button>
        <Button tip="Open a Voronoi Studio project file (.voronoi.json)." shortcut="⌘O" onClick={onOpen}>Open…</Button>
        <Button className="primary" tip="Save the settings and every point, including hand edits, as a project file you can reopen." shortcut="⌘S" unavailable={working} onClick={onSave}>Save</Button>
      </div>
      {openError && <p className="hint error" role="alert">{openError}</p>}
    </Section>

    <Section title="For cutting">
      <div className="button-row">
        <Button tip={`Red hairline cut paths in ${fileUnits} at real size, holes first, for LightBurn, Glowforge and other laser software.`} unavailable={working} onClick={() => onExport('laser')}>Laser SVG</Button>
        <Button tip={`AutoCAD R12 DXF in ${fileUnits}, with rounded corners as true arcs, for Fusion, Illustrator, VCarve and CAM.`} unavailable={working} onClick={() => onExport('dxf')}>DXF</Button>
      </div>
      <SwitchField label="Include the sheet outline" checked={s.sheetOutline}
        tip="Add the sheet's edge as the outer cut, on its own layer after the inner cuts." onChange={sheetOutline => change({ sheetOutline }, 'sheetOutline')} />
      <p className="hint">Cut files contain each line once. Holes go on layer CUT_INNER, the outline on CUT_OUTER.</p>
    </Section>

    <Section title="For artwork">
      <div className="button-row">
        <Button tip={`The design as you see it, with colours, sites and Delaunay lines if shown, sized in ${s.units === 'px' ? 'pixels' : UNIT_NAME[s.units === 'in' ? 'in' : 'mm']}.`}
          unavailable={working} onClick={() => onExport('svg')}>SVG</Button>
        <Button tip={`A ${pw.toLocaleString()} × ${ph.toLocaleString()} px image at ${s.dpi} pixels per inch.`} unavailable={working || (pngBlocked ?? false)} onClick={() => onExport('png')}>PNG</Button>
      </div>
      <SwitchField label="Transparent PNG background" checked={s.transparentPng}
        tip="Leave the sheet background out of the PNG." onChange={transparentPng => change({ transparentPng }, 'transparentPng')} />
      <p className="hint">{pngBlocked ?? `PNG: ${pw.toLocaleString()} × ${ph.toLocaleString()} px. Exports always show the whole sheet, whatever the zoom.`}</p>
    </Section>
  </>
}
