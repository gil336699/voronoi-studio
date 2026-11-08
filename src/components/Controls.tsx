import { type ReactNode, useId, useState } from 'react'
import { rangeFill } from '../lib/rangeFill'
import { decimals, fromUnits, stepFor, toUnits, trimZeros, UNIT_LABEL, type Units } from '../lib/units'

// Form controls shared by the panels. Each one carries a one-sentence description (data-tip) that the
// tooltip layer shows on hover and keyboard focus. An unavailable control shows why instead.

type Tip = { tip: string; unavailable?: string | false; shortcut?: string }

export function Button({ tip, unavailable, shortcut, className, onClick, children, label, pressed }: Tip & {
  className?: string; onClick: () => void; children: ReactNode; label?: string; pressed?: boolean
}) {
  // aria-disabled keeps the button focusable and hoverable, so its reason can still be read.
  return <button type="button" className={className} aria-label={label} aria-pressed={pressed} aria-disabled={unavailable ? true : undefined}
    data-tip={unavailable || tip} data-key={shortcut} onClick={() => { if (!unavailable) onClick() }}>{children}</button>
}

export function SwitchField({ label, checked, onChange, tip, unavailable }: Tip & { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="switch-row" data-tip={unavailable || tip}>
    <span>{label}</span>
    <input type="checkbox" role="switch" checked={checked} disabled={Boolean(unavailable)} onChange={event => onChange(event.currentTarget.checked)} />
  </label>
}

export type Option<T extends string> = { value: T; label: string; tip: string; unavailable?: string | false }

export function Segmented<T extends string>({ label, options, value, onChange, unavailable, hideLabel }: {
  label: string; options: Option<T>[]; value: T; onChange: (value: T) => void; unavailable?: string | false; hideLabel?: boolean
}) {
  const id = useId()
  return <div className="field">
    {!hideLabel && <span className="field-label" id={id}>{label}</span>}
    <div className="button-row segmented" role="group" aria-labelledby={hideLabel ? undefined : id} aria-label={hideLabel ? label : undefined}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(option => {
        const off = unavailable || option.unavailable
        return <button key={option.value} type="button" aria-pressed={option.value === value}
          aria-disabled={off ? true : undefined} data-tip={off || option.tip}
          onClick={() => { if (!off) onChange(option.value) }}>{option.label}</button>
      })}
    </div>
  </div>
}

export function SliderField({ label, value, min, max, step = 1, onChange, format, tip, unavailable, log }: Tip & {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void
  format?: (value: number) => string; log?: boolean
}) {
  // Log sliders give equal travel to 10→100 and 1,000→10,000, which suits counts.
  const toTrack = (v: number) => (log ? Math.log(v) : v)
  const fromTrack = (t: number) => (log ? Math.exp(t) : t)
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  return <label className="field" data-tip={unavailable || tip}>
    <span className="field-label"><span>{label}</span><b>{format ? format(value) : value}</b></span>
    <input type="range" min={toTrack(min)} max={toTrack(max)} step={log ? 'any' : step} value={toTrack(value)} disabled={Boolean(unavailable)}
      style={rangeFill(toTrack(value), toTrack(min), toTrack(max))} aria-valuetext={format ? format(value) : String(value)}
      onChange={event => onChange(snap(fromTrack(Number(event.currentTarget.value))))} />
  </label>
}

// A number box that lets people type freely, applying each valid value as they go and tidying up on blur.
export function DraftNumber({ value, min, max, step = 1, digits = 0, onChange, disabled, className = 'number-input', labelledBy, label }: {
  value: number; min: number; max: number; step?: number; digits?: number; onChange: (value: number) => void
  disabled?: boolean; className?: string; labelledBy?: string; label?: string
}) {
  // What was typed, and the value it was typed against. It shows only while that is still the value, so a
  // change from elsewhere (an import, a linked field, Undo) replaces it instead of being overwritten on blur.
  const [draft, setDraft] = useState<{ text: string; at: number } | null>(null)
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
  const typing = draft !== null && same(draft.at, value)
  const shown = typing ? draft.text : trimZeros(value.toFixed(digits))
  const commit = () => {
    // Only text that was actually typed is applied, so tabbing through a field never rounds its value.
    if (typing) {
      const v = Number(draft.text)
      if (draft.text.trim() !== '' && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
    }
    setDraft(null)
  }
  return <input className={className} type="number" inputMode="decimal" min={min} max={max} step={step} value={shown} disabled={disabled}
    aria-labelledby={labelledBy} aria-label={label}
    onChange={event => {
      const text = event.currentTarget.value
      const v = Number(text)
      const valid = text.trim() !== '' && Number.isFinite(v) && v >= min && v <= max
      setDraft({ text, at: valid ? v : value })
      if (valid) onChange(v)
    }}
    onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') commit() }} />
}

export function NumberField({ label, value, min, max, step = 1, digits = 0, suffix, onChange, tip, unavailable, compact }: Tip & {
  label: string; value: number; min: number; max: number; step?: number; digits?: number; suffix?: string
  onChange: (value: number) => void; compact?: boolean
}) {
  return <label className={compact ? 'field compact-field' : 'field'} data-tip={unavailable || tip}>
    <span className="field-label"><span>{label}</span></span>
    <span className="number-wrap">
      <DraftNumber value={value} min={min} max={max} step={step} digits={digits} onChange={onChange} disabled={Boolean(unavailable)} />
      {suffix && <span className="suffix" aria-hidden="true">{suffix}</span>}
    </span>
  </label>
}

// A length in the sheet's unit, stored in millimetres.
export function LengthField({ label, mm, min, max, units, dpi, onChange, tip, unavailable, small, compact }: Tip & {
  label: string; mm: number; min: number; max: number; units: Units; dpi: number; onChange: (mm: number) => void; small?: boolean; compact?: boolean
}) {
  return <NumberField label={label} value={toUnits(mm, units, dpi)} min={toUnits(min, units, dpi)} max={toUnits(max, units, dpi)}
    step={stepFor(units, small)} digits={decimals(units, small) + 1} suffix={UNIT_LABEL[units]} tip={tip} unavailable={unavailable} compact={compact}
    onChange={value => onChange(fromUnits(value, units, dpi))} />
}

export function ColorField({ label, value, onChange, tip, unavailable }: Tip & { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-row" data-tip={unavailable || tip}>
    <span>{label}</span>
    <span className="color-value"><code>{value.toUpperCase()}</code>
      <input type="color" value={value} disabled={Boolean(unavailable)} onChange={event => onChange(event.currentTarget.value)} />
    </span>
  </label>
}

export function Section({ title, children, tip }: { title: string; children: ReactNode; tip?: string }) {
  return <section>
    <h2 data-tip={tip}>{title}</h2>
    {children}
  </section>
}
