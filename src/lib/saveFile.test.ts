import { afterEach, describe, expect, it } from 'vitest'
import { NO_DIALOG_MS, saveFile } from './saveFile'

// A stand-in for the browser: the save dialog's API (or none), and a download link that records its clicks.
function browser(picker?: (options: { suggestedName: string }) => Promise<unknown>) {
  const clicks: string[] = [], written: string[] = []
  const g = globalThis as Record<string, unknown>
  g.window = { showSaveFilePicker: picker, setTimeout: (f: () => void) => setTimeout(f, 0) }
  g.document = { createElement: () => { const link = { href: '', download: '', click: () => clicks.push(link.download) }; return link } }
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = () => {}
  return { clicks, written }
}
const later = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const abort = () => new DOMException('The user aborted a request.', 'AbortError')

describe('saveFile', () => {
  afterEach(() => { delete (globalThis as Record<string, unknown>).window; delete (globalThis as Record<string, unknown>).document })

  it('downloads when the save dialog fails at once, as in browsers that have its API but no dialog', async () => {
    const b = browser(async () => { throw abort() })
    expect(await saveFile('a.dxf', 'x', 'application/dxf', 'DXF drawing')).toBe('downloaded')
    expect(b.clicks).toEqual(['a.dxf'])
  })

  it('keeps a real cancel a cancel: no download behind the person’s back', async () => {
    const b = browser(async () => { await later(NO_DIALOG_MS + 60); throw abort() })
    expect(await saveFile('a.svg', 'x', 'image/svg+xml', 'SVG image')).toBe('cancelled')
    expect(b.clicks).toEqual([])
  })

  it('saves through the dialog when a file is chosen', async () => {
    const b = browser(async () => ({ createWritable: async () => ({ write: async (d: string) => { b.written.push(d) }, close: async () => {} }) }))
    expect(await saveFile('a.voronoi.json', '{}', 'application/json', 'Voronoi Studio project')).toBe('saved')
    expect(b.written).toEqual(['{}'])
    expect(b.clicks).toEqual([])
  })

  it('downloads where there is no dialog, and when the dialog is refused', async () => {
    let b = browser(undefined)
    expect(await saveFile('a.png', 'x', 'image/png', 'PNG image')).toBe('downloaded')
    expect(b.clicks).toEqual(['a.png'])
    b = browser(async () => { throw new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError') })
    expect(await saveFile('b.png', 'x', 'image/png', 'PNG image')).toBe('downloaded')
    expect(b.clicks).toEqual(['b.png'])
  })
})
