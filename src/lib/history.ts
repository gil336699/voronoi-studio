// Undo and redo for the whole design. Quick runs of the same change (dragging a slider) share one step.
export type History<T> = { past: T[]; future: T[]; lastKey: string | null; lastTime: number }

export const LIMIT = 60
const MERGE_MS = 700

export const emptyHistory = <T,>(): History<T> => ({ past: [], future: [], lastKey: null, lastTime: 0 })

// Record the state before a change. Changes with the same key in quick succession merge into one step.
export function record<T>(history: History<T>, before: T, key: string | null, now = Date.now()): History<T> {
  if (key && key === history.lastKey && now - history.lastTime < MERGE_MS) return { ...history, future: [], lastTime: now }
  return { past: [...history.past, before].slice(-LIMIT), future: [], lastKey: key, lastTime: now }
}

export function undo<T>(history: History<T>, current: T): { history: History<T>; state: T } | null {
  const state = history.past[history.past.length - 1]
  if (state === undefined) return null
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future], lastKey: null, lastTime: 0 }, state }
}

export function redo<T>(history: History<T>, current: T): { history: History<T>; state: T } | null {
  const state = history.future[0]
  if (state === undefined) return null
  return { history: { past: [...history.past, current].slice(-LIMIT), future: history.future.slice(1), lastKey: null, lastTime: 0 }, state }
}
