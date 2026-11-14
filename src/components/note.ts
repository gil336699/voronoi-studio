// A field's short-lived note, such as why a typed value changed. Kept out of Controls.tsx, which exports only
// components, so fast refresh keeps working.
import { useEffect, useState } from 'react'

// A note that clears itself after a few seconds.
export function useNote(): [string, (note: string) => void] {
  const [note, setNote] = useState('')
  useEffect(() => { if (!note) return; const timer = window.setTimeout(() => setNote(''), 6000); return () => window.clearTimeout(timer) }, [note])
  return [note, setNote]
}

// What a field says when a typed value was set to the nearest end of its range (before 1.11.1 it changed silently,
// so a negative width quietly became the smallest one).
export const clampNote = (label: string, shown: string, past: 'min' | 'max') =>
  `${label} can’t be ${past === 'min' ? 'under' : 'over'} ${shown}, so it’s ${shown}.`
