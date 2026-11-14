// Save a file with the system save dialog where the browser offers one, otherwise as a download.
// Embedded browsers can ignore download links, so the save dialog is tried first.

type Picker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
  Promise<{ createWritable: () => Promise<{ write: (data: BlobPart) => Promise<void>; close: () => Promise<void> }> }>

export type SaveResult = 'saved' | 'downloaded' | 'cancelled' | 'failed'

// Some browsers have the save dialog's API but no dialog: embedded and in-app browsers reject at once, with the same
// AbortError a person's Cancel gives. Nobody can answer a dialog this fast, so a rejection sooner than this falls back
// to a download. Before 1.11.1 it counted as a cancel, so those exports made no file and said nothing.
export const NO_DIALOG_MS = 300

export async function saveFile(filename: string, data: BlobPart, type: string, description: string): Promise<SaveResult> {
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker
  if (picker) {
    const asked = performance.now()
    let handle: Awaited<ReturnType<Picker>> | null = null
    try {
      const extension = filename.slice(filename.lastIndexOf('.'))
      handle = await picker.call(window, { suggestedName: filename, types: [{ description, accept: { [type]: [extension] } }] })
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      if (aborted && performance.now() - asked >= NO_DIALOG_MS) return 'cancelled'
      // Otherwise the dialog is unavailable or failed before anyone could answer it: download instead.
    }
    if (handle) {
      try {
        const writable = await handle.createWritable()
        await writable.write(data)
        await writable.close()
        return 'saved'
      } catch {
        // Writing to the chosen file failed: offer the download instead.
      }
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([data], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}
