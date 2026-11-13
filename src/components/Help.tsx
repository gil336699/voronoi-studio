import { Modal } from './Modal'

// The quick start card and the ? dialog with every shortcut.

export function QuickStart({ onClose }: { onClose: () => void }) {
  return <section className="quick-start glass" aria-labelledby="quick-start-title">
    <h2 id="quick-start-title">Quick start</h2>
    <ol>
      <li><b>Sheet:</b> pick a size and shape, such as a 200 mm tile or a coaster, or import your own outline from an SVG.</li>
      <li><b>Pattern:</b> set the cell count and placement, then drag, add or erase cells on the sheet.</li>
      <li><b>Style</b> and <b>File:</b> choose Lines or Holes, then export a laser SVG or DXF at real size.</li>
    </ol>
    <p>Hover over any control to see what it does.</p>
    <button type="button" className="primary" data-tip="Hide this guide. Reopen it from the ? button." onClick={onClose}>Got it</button>
  </section>
}

const SHORTCUTS: [string, string][] = [
  ['G', 'Generate a new pattern'],
  ['R', 'Relax'],
  ['P', 'Auto-relax on or off'],
  ['V  A  E  H  M', 'Move, Add, Erase, Pan and Move picture tools'],
  ['Space + drag', 'Pan with any tool'],
  ['Alt-click', 'Add a cell'],
  ['Shift-click', 'Erase a cell'],
  ['Scroll, pinch', 'Zoom'],
  ['+  −  F', 'Zoom in, out, fit'],
  ['1  2  3  4', 'Sites, edges, Delaunay, picture'],
  ['⌘Z  ⇧⌘Z', 'Undo, redo'],
  ['⌘S  ⌘O', 'Save, open project'],
  ['Esc', 'Close, or back to Move'],
  ['?', 'This list'],
]

export function HelpDialog({ onClose, onQuickStart }: { onClose: () => void; onQuickStart: () => void }) {
  return <Modal labelledBy="help-title" onClose={onClose}>
    <h2 id="help-title">Keyboard shortcuts</h2>
    <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl>
    <p className="hint">On touch screens, one finger edits with the current tool and two fingers pan and zoom. On Windows, use Ctrl for ⌘.</p>
    <div className="confirm-actions">
      <button type="button" data-tip="Show the three-step guide again." onClick={onQuickStart}>Show quick start</button>
      <button type="button" className="primary" data-autofocus onClick={onClose}>Close</button>
    </div>
  </Modal>
}

// other: a second choice, for questions with two answers besides Cancel.
export type Pending = {
  title: string; body: string; confirm: string; run: () => void; confirmTip?: string
  other?: { label: string; tip: string; run: () => void }
}

export function ConfirmDialog({ pending, onCancel }: { pending: Pending; onCancel: () => void }) {
  return <Modal role="alertdialog" labelledBy="confirm-title" describedBy="confirm-body" onClose={onCancel}>
    <h2 id="confirm-title">{pending.title}</h2>
    <p id="confirm-body" className="hint">{pending.body}</p>
    <div className="confirm-actions">
      <button type="button" data-autofocus data-tip="Keep the current design." onClick={onCancel}>Cancel</button>
      {pending.other && <button type="button" data-tip={pending.other.tip} onClick={() => { onCancel(); pending.other!.run() }}>{pending.other.label}</button>}
      <button type="button" className="primary" data-tip={pending.confirmTip ?? 'Continue. Undo can bring the current points back.'} onClick={() => { onCancel(); pending.run() }}>{pending.confirm}</button>
    </div>
  </Modal>
}
