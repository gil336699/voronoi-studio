import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dock, Inspector, ViewBar } from './components/Bars'
import { FilePanel, type ExportKind } from './components/FilePanel'
import { ConfirmDialog, HelpDialog, QuickStart, type Pending } from './components/Help'
import { PatternPanel } from './components/PatternPanel'
import { SheetPanel } from './components/SheetPanel'
import { Stage, type StageControls, type Tool } from './components/Stage'
import { StylePanel } from './components/StylePanel'
import { TabPanel, Tabs } from './components/Tabs'
import { TooltipLayer } from './components/Tooltip'
import { cutDxf } from './lib/dxfExport'
import { EXTENSION, parseProject, ProjectError, serializeProject } from './lib/project'
import { pngProblem, renderPng } from './lib/render'
import { saveFile } from './lib/saveFile'
import { DEFAULTS, seedSettings, type Settings } from './lib/settings'
import { artworkSvg, laserSvg } from './lib/svgExport'
import { pixelSize, trimZeros, toUnits, UNIT_LABEL } from './lib/units'
import { freshDoc, spacingOf, useDesign, type Doc, type Status } from './useDesign'
import { integrateDensity, densityField } from './voronoi/density'
import { buildGeometry, patternRegion } from './voronoi/pattern'
import { randomSeed } from './voronoi/random'
import { contains, regionArea } from './voronoi/region'

type TabId = 'pattern' | 'sheet' | 'style' | 'file'
const SESSION_KEY = 'voronoi-studio:session'
const SESSION_UNSAVED_KEY = 'voronoi-studio:session-unsaved'
const QUICK_START_KEY = 'voronoi-studio:quick-start-dismissed'

const storage = {
  get: (key: string) => { try { return localStorage.getItem(key) } catch { return null } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* private mode or full: skip */ } },
}

// The last session comes back after a reload or a closed tab, so work is never lost to an accident.
function initialDesign(): { doc: Doc; saved: boolean; restored: boolean } {
  const text = storage.get(SESSION_KEY)
  if (text) {
    try {
      const design = parseProject(text)
      return { doc: { ...design, stale: false }, saved: storage.get(SESSION_UNSAVED_KEY) !== '1', restored: true }
    } catch { /* an unreadable session starts fresh */ }
  }
  return { doc: freshDoc(DEFAULTS), saved: true, restored: false }
}

// The spacing Auto spacing would use, shown in the Spacing field while it is on.
function autoSpacingFor(s: Settings): number {
  const region = patternRegion(s)
  const count = Math.max(2, s.count)
  if (s.placement === 'hex') return Math.sqrt((2 * regionArea(region)) / (Math.sqrt(3) * count))
  if (s.placement === 'square') return Math.sqrt(regionArea(region) / count)
  const mass = integrateDensity(densityField(seedSettings(s).density, region), region, (x, y) => contains(region, x, y), 32)
  return Math.sqrt((0.62 * 2 / Math.sqrt(3)) * mass / count)
}

const baseName = (s: Settings) => {
  const unit = s.units === 'px' ? 'px' : s.units === 'in' ? 'in' : 'mm'
  const v = (mm: number) => trimZeros(toUnits(mm, unit, s.dpi).toFixed(unit === 'in' ? 2 : unit === 'px' ? 0 : 1))
  return `voronoi-${v(s.width)}x${v(s.height)}${UNIT_LABEL[unit]}`
}

export function App() {
  const [first] = useState(initialDesign)
  const [status, setStatus] = useState<Status>(() => (first.restored ? { text: 'Restored your last session.' } : null))
  const design = useDesign(() => first, setStatus)
  const { doc } = design
  const s = doc.settings
  const [tab, setTab] = useState<TabId>('pattern')
  const [tool, setTool] = useState<Tool>('move')
  const [zoom, setZoom] = useState(1)
  const [showHelp, setShowHelp] = useState(false)
  const [showQuickStart, setShowQuickStart] = useState(() => storage.get(QUICK_START_KEY) !== '1')
  const [pending, setPending] = useState<Pending | null>(null)
  const [openError, setOpenError] = useState('')
  const frameRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<StageControls | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Routine messages fade back to the cell count; warnings stay until something else happens.
  useEffect(() => {
    if (!status || status.warning) return
    const timer = window.setTimeout(() => setStatus(null), 5000)
    return () => window.clearTimeout(timer)
  }, [status])

  const geometry = useMemo(() => buildGeometry(doc.points, s), [doc.points, s])
  const count = doc.points.length / 2

  // Keep a copy of the session, a moment after the last change.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      storage.set(SESSION_KEY, serializeProject(doc))
      storage.set(SESSION_UNSAVED_KEY, design.unsaved ? '1' : '0')
    }, 600)
    return () => window.clearTimeout(timer)
  }, [doc, design.unsaved])

  // Asks before discarding unsaved work, in an in-app dialog (embedded browsers can block confirm()).
  const guard = useCallback((when: boolean, p: Pending) => { if (when) setPending(p); else p.run() }, [])

  const generateNew = useCallback(() => guard(doc.handEdited, {
    title: 'Replace your edited points?', confirm: 'Generate new',
    body: 'A new pattern replaces the points you moved, added or erased. Undo brings them back.',
    run: () => design.generate(randomSeed()),
  }), [guard, doc.handEdited, design])

  const applySettings = () => guard(true, {
    title: 'Apply the new settings?', confirm: 'Apply settings',
    body: 'Your hand-edited points will be replaced by a new pattern from the current settings. Undo brings them back.',
    run: () => design.generate(),
  })

  const newDesign = () => guard(design.unsaved, {
    title: 'Start a new design?', confirm: 'Discard and start new',
    body: 'Unsaved changes in the current design will be lost. Undo can still bring it back during this session.',
    run: () => { design.replace(freshDoc({ ...DEFAULTS, seed: randomSeed() }), true); setStatus({ text: 'New design.' }) },
  })

  const openProject = () => guard(design.unsaved, {
    title: 'Open another project?', confirm: 'Discard and open',
    body: 'Unsaved changes in the current design will be lost. Undo can still bring it back during this session.',
    run: () => fileInput.current?.click(),
  })

  const readProject = async (file: File) => {
    try {
      const opened = parseProject(await file.text())
      design.replace({ ...opened, stale: false }, true)
      setOpenError('')
      setStatus({ text: `Opened ${file.name}.` })
    } catch (error) {
      // The current design stays as it was.
      setOpenError(error instanceof ProjectError ? error.message : `${file.name} could not be read.`)
      setTab('file')
    }
  }

  const report = (name: string, result: Awaited<ReturnType<typeof saveFile>>) => {
    if (result === 'saved' || result === 'downloaded') setStatus({ text: `${result === 'saved' ? 'Saved' : 'Downloaded'} ${name}.` })
    else if (result === 'failed') setStatus({ text: `${name} could not be saved.`, warning: true })
    return result === 'saved' || result === 'downloaded'
  }

  const saveProject = async () => {
    const snapshot = doc
    const name = `${baseName(s)}${EXTENSION}`
    if (report(name, await saveFile(name, serializeProject(snapshot), 'application/json', 'Voronoi Studio project'))) design.markSaved(snapshot)
  }

  const exportFile = async (kind: ExportKind) => {
    const base = baseName(s)
    if (kind === 'svg') report(`${base}.svg`, await saveFile(`${base}.svg`, artworkSvg(geometry, doc.points, s), 'image/svg+xml', 'SVG image'))
    if (kind === 'laser') report(`${base}-cut.svg`, await saveFile(`${base}-cut.svg`, laserSvg(geometry, s), 'image/svg+xml', 'SVG cut file'))
    if (kind === 'dxf') report(`${base}.dxf`, await saveFile(`${base}.dxf`, cutDxf(geometry, s), 'application/dxf', 'DXF drawing'))
    if (kind === 'png') {
      const [w, h] = pixelSize(s.width, s.height, s.dpi)
      const problem = pngProblem(w, h)
      if (problem) { setStatus({ text: problem, warning: true }); return }
      setStatus({ text: `Drawing a ${w.toLocaleString()} × ${h.toLocaleString()} px PNG…` })
      const blob = await renderPng(geometry, doc.points, s, w, h)
      if (!blob) { setStatus({ text: 'The browser could not draw a PNG this large. Lower the pixels per inch.', warning: true }); return }
      report(`${base}.png`, await saveFile(`${base}.png`, blob, 'image/png', 'PNG image'))
    }
  }

  const relaxBlocked = count < 3 && 'Relaxing needs at least 3 points.'
  const toggle = (key: 'showSites' | 'showEdges' | 'showDelaunay') => design.change({ [key]: !s[key] }, key)
  const closeQuickStart = () => { setShowQuickStart(false); storage.set(QUICK_START_KEY, '1') }

  // Keyboard shortcuts, ignored while typing. Re-registered each render so handlers see current state.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const typing = Boolean(target?.closest('input, select, textarea'))
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') { setShowHelp(false); setPending(null); if (!typing) setTool('move'); return }
      if (pending || showHelp) return
      if (mod && key === 's') { event.preventDefault(); void saveProject(); return }
      if (mod && key === 'o') { event.preventDefault(); openProject(); return }
      if (typing) return
      if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) design.redo(); else design.undo(); return }
      if (mod && key === 'y') { event.preventDefault(); design.redo(); return }
      if (mod || event.altKey) return
      if (key === 'g') generateNew()
      else if (key === 'r') { if (!relaxBlocked) design.relaxOnce() }
      else if (key === 'p') { if (!relaxBlocked) design.toggleAuto() }
      else if (key === 'v') setTool('move')
      else if (key === 'a') setTool('add')
      else if (key === 'e') setTool('erase')
      else if (key === 'h') setTool('pan')
      else if (key === '1') toggle('showSites')
      else if (key === '2') toggle('showEdges')
      else if (key === '3') toggle('showDelaunay')
      else if (key === 'f' || key === '0') stageRef.current?.fit()
      else if (key === '+' || key === '=') stageRef.current?.zoomBy(1.25)
      else if (key === '-' || key === '_') stageRef.current?.zoomBy(1 / 1.25)
      else if (event.key === '?') setShowHelp(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const statusText = status?.text ?? (design.busy ? 'Updating the pattern…'
    : `${count.toLocaleString()} cells · seed ${s.seed}${doc.handEdited ? ' · edited by hand' : ''}`)

  return <main className="studio">
    <TooltipLayer />
    <div className="stage">
      <Stage geometry={geometry} points={doc.points} settings={s} tool={tool} frameRef={frameRef} controlRef={stageRef}
        onBeginEdit={() => { design.beginEdit(); setStatus(null) }} onPoints={design.editPoints} onZoom={setZoom}
        onNotice={text => setStatus({ text })} />
    </div>

    <header className="brand glass">
      <div><p className="app-kicker">Voronoi patterns for making</p><h1>Voronoi Studio</h1></div>
      <button type="button" className="icon-button" aria-label="Keyboard shortcuts and help" data-tip="Keyboard shortcuts and the quick start." data-key="?" onClick={() => setShowHelp(true)}>?</button>
    </header>

    <aside className="sidebar side-panel glass" aria-label="Design controls">
      <Tabs label="Design controls" idBase="design" value={tab} onChange={setTab} tabs={[
        { id: 'pattern', label: 'Pattern', title: 'How many cells, where the points go, gradients and relaxation.', badge: doc.stale ? 'settings not applied' : undefined },
        { id: 'sheet', label: 'Sheet', title: 'Sheet size, shape, units and border.' },
        { id: 'style', label: 'Style', title: 'Lines or holes, web width, corner radius and colours.' },
        { id: 'file', label: 'File', title: 'Save or open a project, and export laser SVG, DXF, SVG or PNG.', badge: design.unsaved ? 'unsaved changes' : undefined },
      ]} />
      <TabPanel idBase="design" id="pattern" value={tab}>
        <PatternPanel s={s} change={design.change} stale={doc.stale} onApply={applySettings} actualCount={count}
          autoSpacingValue={design.spacing || autoSpacingFor(s)} exactSpacing={() => spacingOf(s)} capped={design.capped} onShuffle={generateNew} />
      </TabPanel>
      <TabPanel idBase="design" id="sheet" value={tab}><SheetPanel s={s} change={design.change} /></TabPanel>
      <TabPanel idBase="design" id="style" value={tab}><StylePanel s={s} change={design.change} /></TabPanel>
      <TabPanel idBase="design" id="file" value={tab}>
        <FilePanel s={s} change={design.change} unsaved={design.unsaved} busy={design.busy} openError={openError}
          onNew={newDesign} onOpen={openProject} onSave={() => void saveProject()} onExport={kind => void exportFile(kind)} />
      </TabPanel>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Choose a project file" onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void readProject(file)
      }} />
    </aside>

    <div className="center">
      <ViewBar tool={tool} setTool={setTool} s={s} toggle={toggle} zoom={zoom} onFit={() => stageRef.current?.fit()} onZoom={f => stageRef.current?.zoomBy(f)} />
      <div className="sheet-frame" ref={frameRef}>
        {showQuickStart && <QuickStart onClose={closeQuickStart} />}
      </div>
      <Dock relaxSteps={s.relaxSteps} auto={design.auto} busy={design.busy} canRelax={relaxBlocked}
        onGenerate={generateNew} onRelax={design.relaxOnce} onAuto={design.toggleAuto}
        status={statusText} warning={Boolean(status?.warning)}
        canUndo={design.canUndo} canRedo={design.canRedo} onUndo={design.undo} onRedo={design.redo} />
    </div>

    <aside className="inspector side-panel glass" aria-label="Measurements">
      <Inspector m={geometry.metrics} s={s} count={count} />
    </aside>

    {pending && <ConfirmDialog pending={pending} onCancel={() => setPending(null)} />}
    {showHelp && <HelpDialog onClose={() => setShowHelp(false)} onQuickStart={() => { setShowHelp(false); setShowQuickStart(true) }} />}
  </main>
}
