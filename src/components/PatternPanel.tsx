import { memo } from 'react'
import { RANGES, type Settings } from '../lib/settings'
import { formatLength } from '../lib/units'
import { Button, DraftNumber, LengthField, NumberField, Section, Segmented, SliderField, SwitchField, type Option } from './Controls'
import type { Placement } from '../voronoi/seeding'
import type { DensityMode } from '../voronoi/density'
import type { PictureFit } from '../voronoi/picture'
import { PICTURE_TYPES } from '../lib/pictureFile'

export type Change = (patch: Partial<Settings>, key?: string) => void

const PLACEMENTS: Option<Placement>[] = [
  { value: 'random', label: 'Random', tip: 'Points land anywhere, so cells vary in size and can clump.' },
  { value: 'even', label: 'Even', tip: 'Poisson-disk placement keeps a minimum gap between points, so cells spread out evenly but stay organic.' },
  { value: 'hex', label: 'Hex', tip: 'Points on a hexagonal grid make a honeycomb. Add jitter to loosen it.' },
  { value: 'square', label: 'Square', tip: 'Points on a square grid make square cells. Add jitter to loosen it.' },
]
const PLACEMENT_HINT: Record<Placement, string> = {
  random: 'Random: points can land anywhere, so some cells are large and some clump together.',
  even: 'Even: keeps a minimum spacing, so cells spread out evenly but still look natural.',
  hex: 'Hex: a honeycomb grid. Jitter moves each point a little for a looser look.',
  square: 'Square: a square grid. Jitter moves each point a little for a looser look.',
}
const DENSITIES: Option<DensityMode>[] = [
  { value: 'none', label: 'None', tip: 'Cells are about the same size everywhere.' },
  { value: 'linear', label: 'Linear', tip: 'Cells get smaller toward one side of the sheet.' },
  { value: 'radial', label: 'Radial', tip: 'Cells get smaller toward the centre, or toward the edge.' },
  { value: 'picture', label: 'Picture', tip: `Cells get smaller where a picture is dark, or where it’s light. Use a ${PICTURE_TYPES} file.` },
]
const FITS: Option<PictureFit>[] = [
  { value: 'fit', label: 'Fit', tip: 'Show the whole picture, centred. Around it counts as white paper.' },
  { value: 'fill', label: 'Fill', tip: 'Cover the whole sheet, centred, cutting off what doesn’t fit.' },
]
const size = (w: number, h: number) => `${w.toLocaleString()} × ${h.toLocaleString()} px`

// Memoised: the panel only re-renders when its own props change, not on every relax step.
export const PatternPanel = memo(function PatternPanel({ s, change, stale, onApply, actualCount, autoSpacingValue, exactSpacing, capped, onShuffle, onChoosePicture }: {
  s: Settings; change: Change; stale: boolean; onApply: () => void; actualCount: number; autoSpacingValue: number
  exactSpacing: () => number; capped: boolean; onShuffle: () => void; onChoosePicture: () => void
}) {
  const grid = s.placement === 'hex' || s.placement === 'square'
  const spacingOff = s.placement === 'random' && 'Random placement has no spacing to set.'
  const countLocked = !s.autoSpacing && s.placement !== 'random' && 'The spacing sets the count. Turn on Auto spacing to choose a count instead.'
  const densityOff = grid && 'Gradients work with Random and Even placement. Grids stay regular.'
  const pic = s.densityPicture
  // Picture without a picture yet asks for one first, and switches once it's read.
  const pickDensity = (density: DensityMode) => (density === 'picture' && !pic ? onChoosePicture() : change({ density }, 'density'))
  return <>
    {stale && <div className="notice" role="status">
      <p>You edited points by hand, so changed pattern settings aren't applied yet.</p>
      <Button className="primary wide" tip="Make a new pattern from these settings. This replaces your hand edits; Undo brings them back." onClick={onApply}>Apply settings…</Button>
    </div>}

    <Section title="Points">
      <div className="field count-field" data-tip={countLocked || 'How many cells to make. Grids round this to whole rows.'}>
        <span className="field-label">
          <span id="count-label">Cells</span>
          <DraftNumber className="number-input inline-number" labelledBy="count-label" min={RANGES.count[0]} max={RANGES.count[1]}
            value={s.count} disabled={Boolean(countLocked)} onChange={v => change({ count: Math.round(v) }, 'count')} />
        </span>
        <input type="range" aria-labelledby="count-label" min={Math.log(RANGES.count[0])} max={Math.log(RANGES.count[1])} step="any" value={Math.log(s.count)}
          disabled={Boolean(countLocked)} aria-valuetext={`${s.count} cells`}
          style={{ '--fill': `${((Math.log(s.count) - Math.log(RANGES.count[0])) / (Math.log(RANGES.count[1]) - Math.log(RANGES.count[0])) * 100).toFixed(1)}%` } as React.CSSProperties}
          onChange={event => change({ count: Math.round(Math.exp(Number(event.currentTarget.value))) }, 'count')} />
      </div>
      {(grid || countLocked || capped) && <p className="hint">{capped ? 'Stopped at 20,000 points, the most the app makes. Increase the spacing.' : `${actualCount.toLocaleString()} cells made.`}</p>}

      <Segmented label="Placement" options={PLACEMENTS} value={s.placement} onChange={placement => change({ placement }, 'placement')} />
      <p className="hint">{PLACEMENT_HINT[s.placement]}</p>

      <SwitchField label="Auto spacing" checked={s.autoSpacing || s.placement === 'random'} unavailable={spacingOff}
        tip="On: spacing follows the cell count and the sheet size. Off: you set the spacing, and the count follows."
        onChange={autoSpacing => change(autoSpacing ? { autoSpacing } : { autoSpacing, spacing: +exactSpacing().toFixed(4) }, 'autoSpacing')} />
      <LengthField label={s.placement === 'even' ? 'Minimum spacing' : 'Grid spacing'} mm={s.autoSpacing ? autoSpacingValue : s.spacing}
        min={RANGES.spacing[0]} max={RANGES.spacing[1]} units={s.units} dpi={s.dpi} small
        unavailable={spacingOff || (s.autoSpacing && `Auto spacing picks about ${formatLength(autoSpacingValue, s.units, s.dpi, true)} for this count. Turn Auto spacing off to set your own.`)}
        tip={s.placement === 'even' ? 'The smallest gap allowed between points, at the sparse end of any gradient.' : 'Distance between neighbouring grid points.'}
        onChange={spacing => change({ spacing }, 'spacing')} />
      <SliderField label="Jitter" value={Math.round(s.jitter * 100)} min={0} max={100} format={v => `${v} %`}
        unavailable={!grid && 'Jitter loosens Hex and Square grids only.'}
        tip="How far each grid point may wander, as a share of half the spacing." onChange={v => change({ jitter: v / 100 }, 'jitter')} />

      <details className="more">
        <summary data-tip="Seed number and Poisson-disk tries.">More</summary>
        <div className="seed-row">
          <NumberField label="Seed" value={s.seed} min={RANGES.seed[0]} max={RANGES.seed[1]} compact
            tip="The same seed and settings always give the same pattern. Note it to make a design again." onChange={seed => change({ seed: Math.round(seed) }, 'seed')} />
          <Button tip="Pick a new random seed, for a new pattern with the same settings." shortcut="G" onClick={onShuffle}>Shuffle</Button>
        </div>
        <SliderField label="Tries per point" value={s.tries} min={RANGES.tries[0]} max={RANGES.tries[1]}
          unavailable={s.placement !== 'even' && 'Tries apply to Even placement only.'}
          tip="How many spots Even placement tries around each point. More fills tighter but takes longer; 30 is standard." onChange={tries => change({ tries }, 'tries')} />
      </details>
    </Section>

    <Section title="Density gradient">
      <Segmented label="Gradient" hideLabel options={DENSITIES} value={s.density} unavailable={densityOff} onChange={pickDensity} />
      {densityOff ? <p className="hint">{densityOff}</p> : s.density !== 'none' && <>
        {s.density === 'picture' && (pic
          ? <div className="picture-file">
            <p className="hint"><b>{pic.name}</b>: {size(pic.sourceWidth, pic.sourceHeight)}
              {pic.sourceWidth !== pic.width ? `, used at ${size(pic.width, pic.height)}` : ''}.</p>
            <Button tip={`Use a different picture: ${PICTURE_TYPES}. You can also drop one on the window.`} onClick={onChoosePicture}>Replace…</Button>
          </div>
          : <Button className="primary wide" tip={`Choose a ${PICTURE_TYPES} file. You can also drop one on the window.`} onClick={onChoosePicture}>Choose picture…</Button>)}
        <SliderField label="Strength" value={s.densityStrength} min={RANGES.densityStrength[0]} max={RANGES.densityStrength[1]} step={0.5}
          format={v => `${v}×`} tip={s.density === 'picture' ? 'How many times smaller in area the cells in the darkest part are than in white.' : 'How many times smaller in area the smallest cells are than the largest.'}
          onChange={densityStrength => change({ densityStrength }, 'densityStrength')} />
        {s.density === 'linear' && <SliderField label="Direction" value={s.densityAngle} min={0} max={355} step={5} format={v => `${v}°`}
          tip="Cells get smaller toward this direction. 0° is right, 90° is up." onChange={densityAngle => change({ densityAngle }, 'densityAngle')} />}
        {s.density === 'radial' && <Segmented label="Small cells at" value={s.densityInvert ? 'edge' : 'centre'} onChange={v => change({ densityInvert: v === 'edge' }, 'densityInvert')}
          options={[{ value: 'centre', label: 'Centre', tip: 'The smallest cells gather in the middle.' }, { value: 'edge', label: 'Edge', tip: 'The smallest cells gather around the edge.' }]} />}
        {s.density === 'picture' && <>
          <Segmented label="Small cells at" value={s.pictureInvert ? 'light' : 'dark'} onChange={v => change({ pictureInvert: v === 'light' }, 'pictureInvert')}
            options={[{ value: 'dark', label: 'Dark', tip: 'Dark parts of the picture get the smallest cells, like ink.' }, { value: 'light', label: 'Light', tip: 'Light parts of the picture get the smallest cells.' }]} />
          <SliderField label="Contrast" value={s.pictureContrast} min={RANGES.pictureContrast[0]} max={RANGES.pictureContrast[1]} step={5}
            format={v => `${v > 0 ? '+' : ''}${v} %`} tip="Spread the mid-greys apart for a bolder pattern, or bring them together for a gentler one. The darkest and lightest parts are always stretched to black and white."
            onChange={pictureContrast => change({ pictureContrast }, 'pictureContrast')} />
          <LengthField label="Softness" mm={s.pictureSoftness} min={RANGES.pictureSoftness[0]} max={RANGES.pictureSoftness[1]} units={s.units} dpi={s.dpi} small
            tip="Blur the picture by about this distance first. Softens hard edges, and turns line drawings into cells that shrink near the lines."
            onChange={pictureSoftness => change({ pictureSoftness }, 'pictureSoftness')} />
          <Segmented label="Picture size" options={FITS} value={s.pictureFit} onChange={pictureFit => change({ pictureFit }, 'pictureFit')} />
        </>}
      </>}
    </Section>

    <Section title="Relaxation">
      <SliderField label="Steps when generating" value={s.relaxSteps} min={RANGES.relaxSteps[0]} max={RANGES.relaxSteps[1]}
        tip="Lloyd relaxation steps applied to each new pattern, and by each press of Relax." onChange={relaxSteps => change({ relaxSteps }, 'relaxSteps')} />
      <p className="hint">Each step moves every point to the centre of its cell. 1–3 steps give a natural, even look; many steps look very regular. <b>Relax</b> and <b>Auto-relax</b> are in the bar under the sheet.</p>
    </Section>
  </>
})
