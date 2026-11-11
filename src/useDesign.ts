import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyHistory, record, redo as redoStep, undo as undoStep, type History } from './lib/history'
import { planChange, type Doc } from './lib/changes'
import type { Settings } from './lib/settings'
import { patternRegion } from './voronoi/pattern'
import { typicalSpacing } from './voronoi/seeding'
import { runJob, type Job, type JobResult } from './worker/jobs'
import { PatternClient } from './worker/patternClient'

// The design being edited, with undo, unsaved-change tracking, and the background jobs that make and
// relax points. The rules for what a settings change does to the points are in lib/changes.ts.

export type { Doc }
// quiet: a routine Auto-relax message, which never replaces a warning that's showing. spoken: what screen
// readers hear instead of the text, so a step counter isn't read out many times a second.
export type Status = { text: string; warning?: boolean; quiet?: boolean; spoken?: string } | null

const AUTO_MAX_STEPS = 3000

// A relax step's result, keeping any point the person moved while it ran (`from` is what the step started
// with, `now` the points since) and the point they're holding. Null when points were added or erased meanwhile.
export function keepEdits(relaxed: Float64Array, from: Float64Array, now: Float64Array, held = -1): Float64Array | null {
  if (now.length !== from.length) return null
  let out = relaxed
  const keep = (i: number) => { if (out === relaxed) out = relaxed.slice(); out[i] = now[i]; out[i + 1] = now[i + 1] }
  if (now !== from) for (let i = 0; i < now.length; i += 2) if (now[i] !== from[i] || now[i + 1] !== from[i + 1]) keep(i)
  if (held >= 0 && held * 2 + 1 < now.length) keep(held * 2)
  return out
}

export function freshDoc(settings: Settings): Doc {
  return { settings, points: runJob({ kind: 'generate', settings }).points, handEdited: false, stale: false }
}

// The spacing the last generated pattern used, so turning Auto spacing off can keep it.
export function spacingOf(settings: Settings): number {
  return runJob({ kind: 'generate', settings: { ...settings, relaxSteps: 0 } }).spacing
}

export function useDesign(initial: () => { doc: Doc; saved: boolean }, onStatus: (status: Status) => void) {
  const [start] = useState(initial)
  const [doc, setDocState] = useState(start.doc)
  // The design as last saved. Undoing back to it counts as saved again.
  const [saved, setSaved] = useState<Doc | null>(start.saved ? start.doc : null)
  const [history, setHistory] = useState<History<Doc>>(emptyHistory)
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const [capped, setCapped] = useState(false)
  const [spacing, setSpacing] = useState(0)
  const docRef = useRef(doc)
  const client = useRef<PatternClient | null>(null)
  // Jobs started before the token last changed have their results dropped: after an Undo, a hand edit, New or
  // Open, a new pattern request, or a sheet change that moved the points.
  const token = useRef(0)
  // The Relax press or a new pattern, one at a time. Auto-relax steps are counted separately.
  const inFlight = useRef<'generate' | 'relax' | null>(null)
  // A new pattern is wanted. It's made from the settings current when it starts, not when it was asked for.
  const wanted = useRef(false)
  // The point being dragged, which relax steps leave under the pointer until it's let go.
  const held = useRef(-1)
  const autoOn = useRef(false)
  const status = useRef(onStatus)
  useEffect(() => { status.current = onStatus }, [onStatus])
  // Whether the "stopped at 20,000 points" warning is showing, so a later pattern clears only that message.
  const cappedShown = useRef(false)

  useEffect(() => {
    const c = new PatternClient()
    client.current = c
    return () => { c.dispose(); client.current = null }
  }, [])

  const run = useCallback((job: Job): Promise<JobResult> => client.current ? client.current.run(job) : Promise.resolve(runJob(job)), [])

  // Replace the design. key: undo-merge key, null for its own undo step, false to skip history.
  const apply = useCallback((next: Doc, key: string | null | false) => {
    if (key !== false) { const before = docRef.current; setHistory(h => record(h, before, key)) }
    docRef.current = next
    setDocState(next)
  }, [])

  // Forget the jobs running and the pattern waiting, for Undo, Redo, New, Open and hand edits.
  const drop = useCallback(() => { token.current++; wanted.current = false; held.current = -1 }, [])

  const stopAuto = useCallback((message?: string) => {
    if (!autoOn.current) return
    autoOn.current = false
    setAuto(false)
    // Without a message (Undo, a hand edit), clear "Relaxing · step…" so it doesn't linger.
    status.current(message ? { text: message } : null)
  }, [])

  // Auto-relax stays on until it is stopped, so setting changes can be watched as they relax. Each new
  // pattern, or points moved by a sheet change, starts the loop again; when the points settle it waits.
  // A new number in autoLoop ends older loops, so only one ever runs, and only one step is ever in the
  // worker: a step that returns after its loop was replaced hands over to the newest loop.
  const autoLoop = useRef(0)
  const autoStep = useRef(false)
  const resume = useRef<() => void>(() => {})
  // The loop has settled and is waiting for a change.
  const autoIdle = useRef(false)
  const kickAuto = useCallback(() => {
    if (!autoOn.current) return
    autoIdle.current = false
    const id = ++autoLoop.current
    const begin = docRef.current
    // Settled once no point moves more than a 2,000th of the typical spacing in a step.
    const tolerance = typicalSpacing(patternRegion(begin.settings), begin.points.length / 2) / 2000
    let steps = 0
    const loop = () => {
      // While a new pattern is being made, it restarts the loop when it arrives.
      if (!autoOn.current || id !== autoLoop.current || inFlight.current || autoStep.current) return
      const mine = token.current
      const current = docRef.current
      autoStep.current = true
      run({ kind: 'relax', settings: current.settings, points: current.points, steps: 1 }).then(result => {
        if (!autoOn.current || id !== autoLoop.current || mine !== token.current) return
        // Points dragged by hand while this step ran keep their new place; added or erased ones mean the step
        // no longer fits, so the next step relaxes the new set.
        const points = keepEdits(result.points, current.points, docRef.current.points, held.current)
        if (!points) { window.setTimeout(loop, 0); return }
        steps++
        apply({ ...docRef.current, points }, false)
        const done = result.maxMove < tolerance ? 'Settled after' : steps >= AUTO_MAX_STEPS ? 'Paused after' : ''
        // Short enough for the status line at 1280 px. The button stays pressed, and the status then ends
        // "· Auto-relax on", to show it's still on. Quiet: these never replace a warning.
        if (done) { autoIdle.current = true; status.current({ text: `${done} ${steps.toLocaleString()} ${steps === 1 ? 'step' : 'steps'}`, quiet: true }); return }
        status.current({ text: `Relaxing · step ${steps.toLocaleString()}`, quiet: true, spoken: 'Relaxing…' })
        window.setTimeout(loop, 16)
      }).catch(() => stopAuto('Auto-relax stopped.'))
        .finally(() => {
          autoStep.current = false
          if (id !== autoLoop.current || mine !== token.current) resume.current()
        })
    }
    resume.current = loop
    loop()
  }, [apply, run, stopAuto])

  // Make the wanted pattern in the worker. Called after every job, so a request made during a Relax press
  // still runs; with nothing wanted, Auto-relax carries on.
  const runQueue = useCallback(() => {
    const step = () => {
      if (inFlight.current) return
      if (!wanted.current) { kickAuto(); return }
      wanted.current = false
      const id = token.current
      inFlight.current = 'generate'
      setBusy(true)
      run({ kind: 'generate', settings: docRef.current.settings }).then(result => {
        if (id !== token.current) return
        apply({ ...docRef.current, points: result.points, handEdited: false, stale: false }, false)
        setCapped(result.capped)
        setSpacing(result.spacing)
        if (result.capped) { status.current({ text: 'Stopped at 20,000 points. Increase the spacing.', warning: true }); cappedShown.current = true }
        else if (cappedShown.current) { status.current(null); cappedShown.current = false }
      }).catch((error: Error) => status.current({ text: `The pattern could not be made: ${error.message}`, warning: true }))
        .finally(() => { inFlight.current = null; setBusy(false); step() })
    }
    step()
  }, [apply, run, kickAuto])

  // Ask for a new pattern from the current settings. Results of jobs already running are dropped.
  const regenerate = useCallback(() => {
    token.current++
    wanted.current = true
    runQueue()
  }, [runQueue])

  const change = useCallback((patch: Partial<Settings>, key?: string) => {
    const prev = docRef.current
    const { next, remake } = planChange(prev, patch)
    apply(next, `settings:${key ?? Object.keys(patch).join(',')}`)
    if (remake) regenerate()
    else if (next.points !== prev.points) {
      // Points moved to follow the sheet. A pattern on its way is made again for the new sheet; a Relax press
      // or Auto-relax step already running used the old positions, so its result is dropped.
      if (inFlight.current === 'generate' || wanted.current) regenerate()
      else { token.current++; kickAuto() }
    }
  }, [apply, regenerate, kickAuto])

  // A new pattern from the current settings, optionally with a new seed. Callers confirm first if points were edited.
  const generate = useCallback((seed?: number) => {
    const prev = docRef.current
    const settings = seed === undefined ? prev.settings : { ...prev.settings, seed }
    apply({ ...prev, settings, handEdited: false, stale: false }, null)
    regenerate()
  }, [apply, regenerate])

  const relaxOnce = useCallback(() => {
    if (inFlight.current || autoOn.current) return
    const before = docRef.current
    const mine = ++token.current
    inFlight.current = 'relax'
    setBusy(true)
    run({ kind: 'relax', settings: before.settings, points: before.points, steps: Math.max(1, before.settings.relaxSteps) }).then(result => {
      if (mine !== token.current) return
      setHistory(h => record(h, before, null))
      apply({ ...docRef.current, points: result.points }, false)
    }).catch((error: Error) => status.current({ text: `Relaxing failed: ${error.message}`, warning: true }))
      .finally(() => { inFlight.current = null; setBusy(false); runQueue() })
  }, [apply, run, runQueue])

  const toggleAuto = useCallback(() => {
    if (autoOn.current) { stopAuto('Auto-relax stopped.'); return }
    if (inFlight.current) return
    autoOn.current = true
    setAuto(true)
    token.current++
    const start = docRef.current
    setHistory(h => record(h, start, null))
    status.current({ text: 'Relaxing…' })
    kickAuto()
  }, [kickAuto, stopAuto])

  // Hand edits: one undo step per gesture, then live updates while the pointer moves. Auto-relax keeps
  // running, so the cells around a dragged point relax as it moves, and the point itself once it's let go.
  const beginEdit = useCallback(() => {
    const pending = inFlight.current === 'generate' || wanted.current
    drop()
    const before = docRef.current
    setHistory(h => record(h, before, null))
    // A new pattern was on its way: the edits keep the old points, so the changed settings wait to be applied.
    if (pending) apply({ ...before, stale: true }, false)
  }, [apply, drop])
  const editPoints = useCallback((points: Float64Array, holding = -1) => {
    held.current = holding
    apply({ ...docRef.current, points, handEdited: true }, false)
    if (autoOn.current && autoIdle.current) kickAuto() // settled: the edit starts it relaxing again
  }, [apply, kickAuto])
  const releasePoint = useCallback(() => { held.current = -1 }, [])

  // Replace the whole design, for New and Open. Undo can still return to the previous one.
  const replace = useCallback((next: Doc, isSaved: boolean) => {
    stopAuto()
    drop()
    apply(next, null)
    setSaved(isSaved ? next : null)
    setCapped(false)
    setSpacing(0) // the panel estimates the spacing until the next pattern reports it
  }, [apply, drop, stopAuto])

  const undo = useCallback(() => {
    const step = undoStep(history, docRef.current)
    if (!step) return
    stopAuto(); drop(); setSpacing(0)
    setHistory(step.history); docRef.current = step.state; setDocState(step.state)
  }, [history, drop, stopAuto])
  const redo = useCallback(() => {
    const step = redoStep(history, docRef.current)
    if (!step) return
    stopAuto(); drop(); setSpacing(0)
    setHistory(step.history); docRef.current = step.state; setDocState(step.state)
  }, [history, drop, stopAuto])

  return {
    doc, change, generate, relaxOnce, toggleAuto, beginEdit, editPoints, releasePoint, replace, undo, redo, stopAuto,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    unsaved: doc !== saved, markSaved: (what: Doc) => setSaved(what),
    busy, auto, capped, spacing,
  }
}
