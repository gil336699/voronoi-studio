// When to write the session copy that comes back after a reload or a crash: a moment after the last change,
// but never more than `most` ms after the first change not yet written. Auto-relax changes the points many
// times a second, so waiting for a quiet moment alone would never write while it runs.
export type Autosave = { changed: () => void; flush: () => void; dispose: () => void }

export function createAutosave(write: () => void, quiet = 600, most = 2000): Autosave {
  let timer: ReturnType<typeof setTimeout> | undefined
  let since = 0 // when the oldest change not yet written was made, or 0
  const flush = () => {
    clearTimeout(timer)
    if (!since) return
    since = 0
    write()
  }
  return {
    changed() {
      const now = Date.now()
      if (!since) since = now
      clearTimeout(timer)
      timer = setTimeout(flush, Math.max(0, Math.min(quiet, since + most - now)))
    },
    flush,
    dispose: () => clearTimeout(timer),
  }
}
