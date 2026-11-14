import { memo } from 'react'
import { fieldReady, fieldShare, RANGES, type Settings } from '../lib/settings'
import { formatLength } from '../lib/units'
import { Button, DraftNumber, LengthField, NumberField, Section, Segmented, SelectField, SliderField, SwitchField, type Option } from './Controls'
import type { Placement } from '../voronoi/seeding'
import type { DensityMode } from '../voronoi/density'
import type { PictureFit } from '../voronoi/picture'
import type { VeinStart, VeinStyle } from '../voronoi/veins'
import { PICTURE_TYPES } from '../lib/pictureFile'
import type { FieldKind } from '../voronoi/field'
import { randomSeed } from '../voronoi/random'

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
  { value: 'fit', label: 'Fit', tip: 'Start from the whole picture fitted inside the sheet. Around it counts as white paper.' },
  { value: 'fill', label: 'Fill', tip: 'Start from the picture covering the whole sheet, cutting off what doesn’t fit.' },
]
const veinStyles = (imported: boolean): Option<VeinStyle>[] => [
  { value: 'none', label: 'None', tip: 'No veins: one pattern across the whole sheet.' },
  { value: 'wing', label: 'Wing', tip: 'Veins fan out from the start to the far edges and branch where they bunch up, like an insect wing’s main veins.' },
  { value: 'leaf', label: 'Leaf', tip: 'Veins grow out from the start and branch as they go, like a leaf’s veins (space colonization). They can join into loops.' },
  { value: 'imported', label: 'Imported', tip: 'The open lines from an SVG you imported.', unavailable: !imported && 'Import an SVG with open lines first, with Import veins… below, or a sheet shape whose file has open lines.' },
]
const STARTS: Option<VeinStart>[] = [
  { value: 'left', label: 'Left', tip: 'Veins start at the middle of the left side.' },
  { value: 'right', label: 'Right', tip: 'Veins start at the middle of the right side.' },
  { value: 'top', label: 'Top', tip: 'Veins start at the middle of the top.' },
  { value: 'bottom', label: 'Bottom', tip: 'Veins start at the middle of the bottom.' },
  { value: 'centre', label: 'Centre', tip: 'Veins spread out from the centre in every direction.' },
]
const VEIN_HINT: Record<Exclude<VeinStyle, 'none'> | 'loops', string> = {
  wing: 'Each region between veins gets its own cells, as in an insect wing. Veins run side by side near the start and spread to the far edges.',
  leaf: 'Veins fan out from the start, branch, and run on to the edge, tapering as they go. Each region between them gets its own cells.',
  loops: 'Thinner veins grow between the main veins and join where they meet, like a leaf’s finer veins. Each loop gets its own cells.',
  imported: 'Each region between your lines gets its own cells. Lines are as wide as Vein width at their start, narrowing by Taper.',
}
// What the stretch follows. The two that need something else say so in the list.
const stretchFields = (s: Settings): Option<FieldKind>[] => [
  { value: 'fixed', label: 'One direction', tip: 'Every cell stretches the same way, set by Direction.' },
  { value: 'centre', label: 'Around a centre', tip: 'Cells point out from a centre like rays, wrap round it in rings, or spiral in between.' },
  { value: 'saddle', label: 'Saddle', tip: 'Cells come in along one axis and leave along the other, as round a saddle point.' },
  { value: 'wave', label: 'Waves', tip: 'Cells follow wavy lines, like ripples or wood grain.' },
  { value: 'cells', label: 'Swirl grid', tip: 'A grid of swirls, each turning the other way from its neighbours, like convection cells.' },
  { value: 'noise', label: 'Noise', tip: 'Directions wander smoothly across the sheet, like a flow field.' },
  { value: 'curl', label: 'Swirling noise', tip: 'Smooth noise turned into eddies that wrap round each other, like smoke or marbling.' },
  { value: 'veins', label: 'Along the veins', tip: 'Cells line up with the nearest vein.', unavailable: s.veins === 'none' && 'turn on veins first' },
  { value: 'picture', label: 'Along the picture', tip: 'Cells run along the density picture’s contours, where dark meets light.', unavailable: !s.densityPicture && 'choose a picture first' },
]
const FIELD_HINT: Record<Exclude<FieldKind, 'fixed'>, string> = {
  centre: '0° turn sends cells out from the centre like rays, 90° wraps them round it in rings, and in between makes a spiral.',
  saddle: 'Cells come in along Direction and leave at right angles to it.',
  wave: 'Cells run along Direction, swinging from side to side.',
  cells: 'Neighbouring swirls turn opposite ways, and cells between them run straight.',
  noise: 'Directions wander smoothly; higher Detail turns more often. Cells too big to follow a turn stay round, so finer detail needs more cells.',
  curl: 'Eddies wrap round each other; higher Detail makes them smaller. Cells too big to follow an eddy stay round, so finer detail needs more cells.',
  veins: 'Cells near a vein run along it.',
  picture: 'The picture is placed as under Density. Cells in flat areas stay round.',
}
const size = (w: number, h: number) => `${w.toLocaleString()} × ${h.toLocaleString()} px`

// Memoised: the panel only re-renders when its own props change, not on every relax step.
export const PatternPanel = memo(function PatternPanel({ s, change, stale, onApply, actualCount, autoSpacingValue, exactSpacing, capped, onShuffle, onChoosePicture, onImportVeins }: {
  s: Settings; change: Change; stale: boolean; onApply: () => void; actualCount: number; autoSpacingValue: number
  exactSpacing: () => number; capped: boolean; onShuffle: () => void; onChoosePicture: () => void; onImportVeins: () => void
}) {
  const grid = s.placement === 'hex' || s.placement === 'square'
  const ready = fieldReady(s)
  const loops = s.veins === 'leaf' && s.veinLoops
  const share = ready ? fieldShare(s, actualCount || s.count) : null
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
        tip={`${s.placement === 'even' ? 'The smallest gap allowed between points, at the sparse end of any gradient.' : 'Distance between neighbouring grid points.'}${s.stretch > 1 ? ' With Stretch, it’s the spacing before stretching: points end up farther apart along the stretch and closer across it.' : ''}`}
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
            format={v => `${v > 0 ? '+' : ''}${v} %`} tip="Spread the mid-greys apart for a bolder pattern, or together for a gentler one. The darkest and lightest parts stay black and white."
            onChange={pictureContrast => change({ pictureContrast }, 'pictureContrast')} />
          <LengthField label="Softness" mm={s.pictureSoftness} min={RANGES.pictureSoftness[0]} max={RANGES.pictureSoftness[1]} units={s.units} dpi={s.dpi} small
            tip="Blur the picture by about this distance first. Softens hard edges, and turns line drawings into cells that shrink near the lines."
            onChange={pictureSoftness => change({ pictureSoftness }, 'pictureSoftness')} />
          <Segmented label="Picture size" options={FITS} value={s.pictureFit} onChange={pictureFit => change({ pictureFit }, 'pictureFit')} />
          <SliderField label="Scale" value={s.pictureScale} min={RANGES.pictureScale[0]} max={RANGES.pictureScale[1]} step={5} format={v => `${v} %`}
            tip="Make the picture smaller or larger, about its centre. 100 % is the Fit or Fill size; around the picture counts as white paper."
            onChange={pictureScale => change({ pictureScale }, 'pictureScale')} />
          <div className="pair two">
            <LengthField label="Move right" mm={s.pictureX} min={-s.width} max={s.width} units={s.units} dpi={s.dpi} small compact
              tip="Move the picture right from the centre of the sheet, or left below zero." onChange={pictureX => change({ pictureX }, 'pictureX')} />
            <LengthField label="Move down" mm={s.pictureY} min={-s.height} max={s.height} units={s.units} dpi={s.dpi} small compact
              tip="Move the picture down from the centre of the sheet, or up below zero." onChange={pictureY => change({ pictureY }, 'pictureY')} />
          </div>
          {(s.pictureScale !== 100 || s.pictureX !== 0 || s.pictureY !== 0) && <Button className="wide" tip="Back to 100 % and centred on the sheet."
            onClick={() => change({ pictureScale: 100, pictureX: 0, pictureY: 0 }, 'pictureReset')}>Reset size and position</Button>}
        </>}
      </>}
    </Section>

    <Section title="Stretch">
      <SliderField label="Amount" name="Stretch amount" value={s.stretch} min={RANGES.stretch[0]} max={RANGES.stretch[1]} step={0.1}
        format={v => (v <= 1 ? 'Off' : `${v.toFixed(1)}×`)} tip="Make cells longer in one direction, like wood grain or a dragonfly wing. At 2× relaxed cells are about twice as long as they are wide."
        onChange={stretch => change({ stretch: Math.round(stretch * 10) / 10 }, 'stretch')} />
      <SelectField label="Follows" name="Stretch follows" options={stretchFields(s)} value={s.stretchField}
        unavailable={s.stretch <= 1 && 'Turn the amount up from Off first.'} onChange={stretchField => change({ stretchField }, 'stretchField')} />
      {(!ready || s.stretchField === 'saddle' || s.stretchField === 'wave') &&
        <SliderField label="Direction" name="Stretch direction" value={s.stretchAngle} min={0} max={175} step={5} format={v => `${v}°`}
          unavailable={s.stretch <= 1 && 'Turn the amount up from Off first.'}
          tip={s.stretchField === 'saddle' && ready ? 'The axis cells come in along. 0° is right, 90° is up.' : s.stretchField === 'wave' && ready ? 'The way the waves run. 0° is right, 90° is up.' : 'The direction cells get longer in. 0° is right, 90° is up.'}
          onChange={stretchAngle => change({ stretchAngle }, 'stretchAngle')} />}
      {ready && (s.stretchField === 'centre' || s.stretchField === 'saddle') && <div className="pair two">
        <SliderField label="Centre X" name="Stretch centre X" value={s.stretchCentreX} min={0} max={100} format={v => `${v} %`}
          tip="Where the centre is across the sheet: 0 % is the left edge, 100 % the right." onChange={stretchCentreX => change({ stretchCentreX }, 'stretchCentreX')} />
        <SliderField label="Centre Y" name="Stretch centre Y" value={s.stretchCentreY} min={0} max={100} format={v => `${v} %`}
          tip="Where the centre is down the sheet: 0 % is the top, 100 % the bottom." onChange={stretchCentreY => change({ stretchCentreY }, 'stretchCentreY')} />
      </div>}
      {ready && s.stretchField === 'centre' &&
        <SliderField label="Turn" name="Stretch turn" value={s.stretchTurn} min={0} max={90} step={5} format={v => `${v}°`}
          tip="0° points cells out from the centre like rays, 90° wraps them round it in rings, in between spirals." onChange={stretchTurn => change({ stretchTurn }, 'stretchTurn')} />}
      {ready && s.stretchField === 'wave' && <>
        <SliderField label="Waves" name="Stretch waves" value={s.stretchWaves} min={RANGES.stretchWaves[0]} max={RANGES.stretchWaves[1]}
          tip="Full waves along the sheet’s longer side." onChange={stretchWaves => change({ stretchWaves }, 'stretchWaves')} />
        <SliderField label="Swing" name="Stretch swing" value={s.stretchSwing} min={RANGES.stretchSwing[0]} max={RANGES.stretchSwing[1]} step={5} format={v => `${v}°`}
          tip="How far the waves turn to each side of Direction." onChange={stretchSwing => change({ stretchSwing }, 'stretchSwing')} />
      </>}
      {ready && s.stretchField === 'cells' &&
        <SliderField label="Swirls" name="Stretch swirls" value={s.stretchCells} min={RANGES.stretchCells[0]} max={RANGES.stretchCells[1]}
          tip="Swirls along the sheet’s longer side." onChange={stretchCells => change({ stretchCells }, 'stretchCells')} />}
      {ready && (s.stretchField === 'noise' || s.stretchField === 'curl') && <>
        <SliderField label="Detail" name="Stretch detail" value={s.stretchScale} min={RANGES.stretchScale[0]} max={RANGES.stretchScale[1]}
          tip="How busy the field is: 1 is one broad sweep, 12 many small turns." onChange={stretchScale => change({ stretchScale }, 'stretchScale')} />
        <Button className="wide" tip="Pick another field with the same detail."
          onClick={() => change({ stretchSeed: randomSeed() }, 'stretchSeed')}>New flow</Button>
      </>}
      {s.stretch > 1 && (ready
        ? <>
          {share !== null && <p className="hint">Cells follow the field over <b>{Math.round(share * 100)} %</b> of the sheet.{share < 0.6 ? ' Elsewhere it turns too fast for cells this big, so they stay round: lower the field’s detail or add cells.' : ''}</p>}
          <p className="hint">{FIELD_HINT[s.stretchField as Exclude<FieldKind, 'fixed'>]} Each point measures distance with its own ellipse, turned to follow the field. Where nearby directions disagree, as at a swirl’s centre, cells stay round. In Holes style, check the narrowest hole.</p>
        </>
        : <p className="hint">{s.stretchField === 'veins' ? 'Turn on veins below to follow them. Until then, ' : s.stretchField === 'picture' ? 'Choose a picture under Density to follow it. Until then, ' : ''}Each point measures distance with an ellipse instead of a circle, so cells stay straight-edged but grow longer along {s.stretchAngle}°. Long cells leave long, thin webs between them: in Holes style, check the narrowest hole.</p>)}
    </Section>

    <Section title="Veins">
      <Segmented label="Veins" hideLabel options={veinStyles(Boolean(s.veinLines))} value={s.veins} onChange={veins => change({ veins }, 'veins')} />
      {s.veins === 'none'
        ? <p className="hint">Primary veins split the sheet into regions, each filled with its own cells, like an insect wing or a leaf.</p>
        : <>
          {s.veins !== 'imported' && <>
            {s.veins === 'leaf' && <SwitchField label="Join into loops" checked={s.veinLoops}
              tip="Veins join where they meet, closing loops as in most leaves. Off: they branch like a tree and run on to the edge."
              onChange={veinLoops => change({ veinLoops }, 'veinLoops')} />}
            <SliderField label={loops ? 'Loops' : 'Vein ends'} name={loops ? 'Vein loops' : 'Vein ends'} value={s.veinCount} min={RANGES.veinCount[0]} max={RANGES.veinCount[1]}
              tip={s.veins === 'wing' ? 'How many veins reach the edge. Veins that bunch up near the start join, so there are fewer there.' : loops ? 'About how many regions the veins close off.' : 'How many branch ends the veins have.'}
              onChange={veinCount => change({ veinCount }, 'veinCount')} />
            <Segmented label="Start from" options={STARTS} value={s.veinStart} onChange={veinStart => change({ veinStart }, 'veinStart')} />
          </>}
          <LengthField label="Vein width" mm={s.veinWidth} min={RANGES.veinWidth[0]} max={RANGES.veinWidth[1]} units={s.units} dpi={s.dpi} small
            tip="How wide veins are where they start. In Holes style, the web on each side adds to it." onChange={veinWidth => change({ veinWidth }, 'veinWidth')} />
          <SliderField label="Taper" value={s.veinTaper} min={RANGES.veinTaper[0]} max={RANGES.veinTaper[1]} step={5} format={v => `${v} %`}
            tip="How much narrower veins get toward their far ends." onChange={veinTaper => change({ veinTaper }, 'veinTaper')} />
          <p className="hint">{VEIN_HINT[loops ? 'loops' : s.veins]}</p>
        </>}
      <Button className="wide" tip="Use an SVG’s open lines as veins. They’re placed by the file’s page, or by its outline if it has one."
        onClick={onImportVeins}>Import veins…</Button>
      {s.veinLines && <p className="hint"><b>{s.veinLines.name}</b>: {s.veinLines.lines.length.toLocaleString()} {s.veinLines.lines.length === 1 ? 'line' : 'lines'}.{s.veins === 'imported' ? '' : ' Choose Imported to use them.'}</p>}
    </Section>

    <Section title="Relaxation">
      <SliderField label="Steps when generating" value={s.relaxSteps} min={RANGES.relaxSteps[0]} max={RANGES.relaxSteps[1]}
        tip="Lloyd relaxation steps applied to each new pattern, and by each press of Relax." onChange={relaxSteps => change({ relaxSteps }, 'relaxSteps')} />
      <p className="hint">Each step moves every point to the centre of its cell. 1–3 steps give a natural, even look; many steps look very regular. <b>Relax</b> and <b>Auto-relax</b> are in the bar under the sheet.</p>
    </Section>
  </>
})
