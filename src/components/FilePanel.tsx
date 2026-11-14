import { memo } from 'react'
import { cutContents, cutLayers, cutProblem, listWords } from '../lib/cutPaths'
import { checkWords, summaryWords, type CheckId, type Preflight } from '../lib/preflight'
import { pngProblem } from '../lib/render'
import { RANGES, type Settings } from '../lib/settings'
import { pixelSize, UNIT_NAME } from '../lib/units'
import { holeCount } from '../voronoi/shape'
import { Button, LengthField, Section, SwitchField } from './Controls'
import type { Change } from './PatternPanel'

export type ExportKind = 'png' | 'svg' | 'laser' | 'dxf'

// Memoised: the panel only re-renders when its own props change, not on every relax step.
// Ready to cut?: report is null until the first check is done; pinned is the row whose highlight stays on the sheet.
export const FilePanel = memo(function FilePanel({ s, change, unsaved, busy, holes, report, pinned, onPoint, onPin, onNew, onOpen, onSave, onExport, openError }: {
  s: Settings; change: Change; unsaved: boolean; busy: boolean; holes: number | null // holes in Holes style, else null
  report: Preflight | null; pinned: CheckId | null; onPoint: (id: CheckId | null) => void; onPin: (id: CheckId) => void
  onNew: () => void; onOpen: () => void; onSave: () => void; onExport: (kind: ExportKind) => void; openError: string
}) {
  const [pw, ph] = pixelSize(s.width, s.height, s.dpi)
  const pngBlocked = pngProblem(pw, ph)
  const fileUnits = s.units === 'in' ? 'inches' : 'millimetres'
  const working = busy && 'Wait for the pattern to finish updating.'
  const contents = cutContents(s)
  const nothing = cutProblem(s, holes)
  const layers = cutLayers(s, s.shape === 'custom' && !!s.customShape && holeCount(s.customShape) > 0)
  const len = { units: s.units, dpi: s.dpi, small: true, inline: true }
  const problems = report ? report.checks.filter(c => !c.note).length : 0
  return <>
    <Section title="Project">
      <p className="hint save-state">{unsaved ? <><span className="dot" aria-hidden="true" />Unsaved changes since the last save.</> : 'All changes saved.'}</p>
      <div className="button-row three">
        <Button tip="Start a new design with the default settings. Your kerf, smallest web and smallest feature stay." onClick={onNew}>New</Button>
        <Button tip="Open a Voronoi Studio project file (.voronoi.json)." shortcut="⌘O" onClick={onOpen}>Open…</Button>
        <Button className="primary" tip="Save the settings and every point, including hand edits, as a project file you can reopen." shortcut="⌘S" unavailable={working} onClick={onSave}>Save</Button>
      </div>
      {openError && <p className="hint error" role="alert">{openError}</p>}
    </Section>

    <Section title="Ready to cut?" tip="Checks the cut files against your laser and material, and shows where any problem is on the sheet. It only warns.">
      <LengthField label="Kerf" mm={s.kerf} min={RANGES.kerf[0]} max={RANGES.kerf[1]} {...len}
        tip="The width your laser burns away along each cut, about 0.1 to 0.3 mm on most lasers. Webs no wider than this burn through."
        onChange={kerf => change({ kerf }, 'kerf')} />
      <LengthField label="Smallest web" mm={s.smallestWeb} min={RANGES.smallestWeb[0]} max={RANGES.smallestWeb[1]} {...len}
        tip="The thinnest strip of your material that survives between two cuts, as drawn, without charring or snapping. About 1 mm for 3 mm plywood."
        onChange={smallestWeb => change({ smallestWeb }, 'smallestWeb')} />
      <LengthField label="Smallest feature" mm={s.smallestFeature} min={RANGES.smallestFeature[0]} max={RANGES.smallestFeature[1]} {...len}
        tip="The smallest hole or detail your laser cuts cleanly. Smaller holes and shorter cuts are listed below."
        onChange={smallestFeature => change({ smallestFeature }, 'smallestFeature')} />
      <p className={problems ? 'hint preflight-summary problems' : 'hint preflight-summary'}>{report ? summaryWords(report, s) : 'Checking…'}</p>
      {report && report.checks.length > 0 && <>
        <ul className="preflight-list" aria-label="Things to check before cutting">
          {report.checks.map(check => {
            const words = checkWords(check, report, s)
            return <li key={check.id}>
              <button type="button" className="preflight-row" data-note={check.note ? 'true' : undefined} aria-pressed={pinned === check.id} data-tip={words.tip}
                onPointerEnter={() => onPoint(check.id)} onPointerLeave={() => onPoint(null)} onFocus={() => onPoint(check.id)} onBlur={() => onPoint(null)}
                onClick={() => onPin(check.id)}>
                <span className="preflight-dot" aria-hidden="true" />
                <span className="preflight-text"><span className="preflight-label">{words.label}</span><span className="preflight-detail">{words.detail}</span></span>
              </button>
            </li>
          })}
        </ul>
        <p className="hint">Point at a row to see where it is on the sheet, or click or tap it to keep it shown. Nothing here stops an export.</p>
      </>}
    </Section>

    <Section title="For cutting">
      <div className="button-row">
        <Button tip={`Hairline paths in ${fileUnits} at real size for LightBurn, Glowforge and other laser software: cuts in red, holes first, with sites and Delaunay lines in their own colours if shown.`} unavailable={working || nothing} onClick={() => onExport('laser')}>Laser SVG</Button>
        <Button tip={`AutoCAD R12 DXF in ${fileUnits}, with rounded corners as true arcs and sites and Delaunay lines on their own layers if shown, for Fusion, Illustrator, VCarve and CAM.`} unavailable={working || nothing} onClick={() => onExport('dxf')}>DXF</Button>
      </div>
      <SwitchField label="Include the sheet outline" checked={s.sheetOutline}
        tip="Add the sheet's edge as the outer cut, on its own layer after the inner cuts." onChange={sheetOutline => change({ sheetOutline }, 'sheetOutline')} />
      <p className="hint">{nothing || <>Cut files hold what the view shows: {listWords(contents)}, each line once. Layers: {listWords(layers)}.</>}</p>
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
})
