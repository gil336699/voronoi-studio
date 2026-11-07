import type { ReactNode } from 'react'
import type { Settings } from '../lib/settings'
import { formatLength, formatLong } from '../lib/units'
import type { Metrics } from '../voronoi/pattern'
import { Button } from './Controls'
import { Icon, type IconName } from './Icon'
import type { Tool } from './Stage'

// The floating bars around the sheet: tools and visibility on top, the main actions and status below,
// and the measurements panel.

const TOOLS: { id: Tool; label: string; icon: IconName; key: string; tip: string }[] = [
  { id: 'move', label: 'Move', icon: 'move', key: 'V', tip: 'Drag a point to move its cell. Alt-click adds, Shift-click erases, dragging empty space pans.' },
  { id: 'add', label: 'Add', icon: 'add', key: 'A', tip: 'Click to add a cell; keep holding to place it.' },
  { id: 'erase', label: 'Erase', icon: 'erase', key: 'E', tip: 'Click a cell to remove it, or drag across cells to remove several.' },
  { id: 'pan', label: 'Pan', icon: 'pan', key: 'H', tip: 'Drag to move the view. Holding Space pans with any tool.' },
]

const TOOL_CAPTION: Record<Tool, string> = {
  move: 'Drag a point to move it · Alt-click to add · Shift-click to erase · Space+drag to pan · Scroll to zoom',
  add: 'Click inside the border to add a cell · Esc for Move',
  erase: 'Click or drag across cells to remove them · Esc for Move',
  pan: 'Drag to move the view · Scroll or pinch to zoom · Esc for Move',
}

export function ViewBar({ tool, setTool, s, toggle, zoom, onFit, onZoom }: {
  tool: Tool; setTool: (tool: Tool) => void; s: Settings
  toggle: (key: 'showSites' | 'showEdges' | 'showDelaunay') => void; zoom: number; onFit: () => void; onZoom: (factor: number) => void
}) {
  const edgeName = s.cellStyle === 'holes' ? 'Holes' : 'Edges'
  return <div className="viewport-bars">
    <div className="viewport-bar-row">
      <div className="floating-bar glass" role="toolbar" aria-label="Tools">
        {TOOLS.map(t => <Button key={t.id} pressed={tool === t.id} tip={t.tip} shortcut={t.key} label={t.label} onClick={() => setTool(t.id)}>
          <Icon name={t.icon} /><span className="compact-label">{t.label}</span></Button>)}
      </div>
      <div className="floating-bar glass" role="toolbar" aria-label="Show">
        <Button pressed={s.showSites} shortcut="1" tip="Show or hide the points (sites) at the heart of each cell." onClick={() => toggle('showSites')}>Sites</Button>
        <Button pressed={s.showEdges} shortcut="2" tip={`Show or hide the cell ${edgeName.toLowerCase()}.`} onClick={() => toggle('showEdges')}>{edgeName}</Button>
        <Button pressed={s.showDelaunay} shortcut="3" tip="Show or hide the Delaunay triangulation, the lines joining neighbouring points." onClick={() => toggle('showDelaunay')}>Delaunay</Button>
        <span className="bar-divider" aria-hidden="true" />
        <Button className="icon-button zoom-step" label="Zoom out" shortcut="−" tip="Zoom out." onClick={() => onZoom(1 / 1.25)}><Icon name="minus" /></Button>
        <Button className="zoom-readout" shortcut="F" tip="Fit the whole sheet in the window." label={`Zoom ${Math.round(zoom * 100)} percent. Fit to window`} onClick={onFit}>{Math.round(zoom * 100)}%</Button>
        <Button className="icon-button zoom-step" label="Zoom in" shortcut="+" tip="Zoom in." onClick={() => onZoom(1.25)}><Icon name="plus" /></Button>
      </div>
    </div>
    <p className="view-caption"><span>{TOOL_CAPTION[tool]}</span></p>
  </div>
}

export function Dock({ relaxSteps, auto, busy, canRelax, onGenerate, onRelax, onAuto, status, warning, canUndo, canRedo, onUndo, onRedo }: {
  relaxSteps: number; auto: boolean; busy: boolean; canRelax: string | false
  onGenerate: () => void; onRelax: () => void; onAuto: () => void
  status: ReactNode; warning: boolean; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void
}) {
  const steps = Math.max(1, relaxSteps)
  return <div className="dock">
    <div className="timeline glass">
      <div className="transport" role="group" aria-label="Pattern actions">
        <Button className="primary" shortcut="G" tip="Make a new pattern with a new random seed, using the current settings." onClick={onGenerate}>
          <Icon name="dice" />Generate</Button>
        <Button shortcut="R" unavailable={canRelax || (auto && 'Auto-relax is already running.') || (busy && 'Wait for the current update to finish.')}
          tip={`Run ${steps} Lloyd relaxation ${steps === 1 ? 'step' : 'steps'}: each point moves to the centre of its cell, evening out sizes.`}
          onClick={onRelax}><Icon name="relax" /><span className="compact-label">Relax ×{steps}</span></Button>
        <Button shortcut="P" pressed={auto} unavailable={canRelax || (!auto && busy && 'Wait for the current update to finish.')} tip={auto ? 'Stop relaxing.' : 'Keep relaxing until the points settle or you stop it.'}
          onClick={onAuto}><Icon name={auto ? 'pause' : 'play'} /><span className="compact-label">Auto-relax</span></Button>
      </div>
      <span className="timeline-status" role="status" data-warning={warning}>{status}</span>
      <div className="transport" role="group" aria-label="History">
        <Button className="icon-button" label="Undo" shortcut="⌘Z" unavailable={!canUndo && 'Nothing to undo yet.'} tip="Undo the last change." onClick={onUndo}><Icon name="undo" /></Button>
        <Button className="icon-button" label="Redo" shortcut="⇧⌘Z" unavailable={!canRedo && 'Nothing to redo.'} tip="Redo the change you undid." onClick={onRedo}><Icon name="redo" /></Button>
      </div>
    </div>
  </div>
}

export function Inspector({ m, s, count }: { m: Metrics; s: Settings; count: number }) {
  const L = (mm: number) => formatLength(mm, s.units, s.dpi, true)
  const holes = s.cellStyle === 'holes'
  const rows: [string, string, string][] = [
    ['Sheet', `${formatLength(s.width, s.units, s.dpi)} × ${formatLength(s.height, s.units, s.dpi)}`, s.shape === 'ellipse' ? 'An ellipse that fits this width and height.' : 'Width × height of the sheet.'],
    ['Cells', count.toLocaleString(), 'Number of points, one per cell.'],
    ...(holes ? [['Holes', `${m.holes.toLocaleString()}${m.dropped ? ` · ${m.dropped.toLocaleString()} left solid` : ''}`,
      'Holes cut out. Cells smaller than the smallest hole, or closed by the web, are left solid.'] as [string, string, string]] : []),
    ['Average cell', `${L(m.meanSize)} across`, 'Diameter of a circle with the average cell area.'],
    ['Evenness', `${(m.evenness * 100).toFixed(1)} %`, 'Spread of cell areas (coefficient of variation). 0 % means every cell is the same size; random points are about 50 %.'],
    holes
      ? ['Narrowest hole', m.holes ? L(m.narrowest) : '—', 'The smallest width across any hole. Check it against your laser kerf or end mill.']
      : ['Shortest edge', L(m.shortestEdge), 'Very short edges make tiny slivers and corners. Relaxing lengthens them.'],
    ['Cut length', formatLong(m.cutLength, s.units), 'Total length of every cut line, including the sheet outline, to estimate laser or plotter time.'],
  ]
  return <section className="measurements" aria-labelledby="measure-title">
    <h2 id="measure-title">Measurements</h2>
    <dl>{rows.map(([term, value, tip]) => <div key={term}><dt data-tip={tip} tabIndex={0}>{term}</dt><dd>{value}</dd></div>)}</dl>
  </section>
}
