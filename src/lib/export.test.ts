import { describe, expect, it } from 'vitest'
import { arcFromBulge, type Outline } from '../voronoi/holes'
import { buildGeometry, patternRegion } from '../voronoi/pattern'
import { seedPoints } from '../voronoi/seeding'
import { cutDxf, LAYER_INNER, LAYER_OUTER } from './dxfExport'
import { DEFAULTS, seedSettings, type Settings } from './settings'
import { artworkSvg, laserSvg, outlinePath } from './svgExport'

const design = (over: Partial<Settings> = {}) => {
  const s = { ...DEFAULTS, ...over }
  const points = seedPoints(seedSettings(s), patternRegion(s)).points
  return { s, points, g: buildGeometry(points, s) }
}

// Pairs of DXF group codes and values, as a reader sees them.
const dxfPairs = (text: string) => {
  const lines = text.trimEnd().split('\n')
  const pairs: [number, string][] = []
  for (let i = 0; i < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]])
  return pairs
}

describe('SVG export', () => {
  it('writes the artwork at real size, with each edge once', () => {
    const { s, points, g } = design()
    const svg = artworkSvg(g, points, s)
    expect(svg).toContain('width="200mm" height="200mm" viewBox="0 0 200 200"')
    const edges = svg.match(/M[\d.]+ [\d.]+L/g) ?? []
    expect(edges.length).toBe(g.edges.internal.length)
    expect(svg.match(/<circle /g)).toHaveLength(300)
  })

  it('keeps pixel sizes for pixel artwork and inches for inch sheets', () => {
    expect(artworkSvg(design({ units: 'px' }).g, new Float64Array(), { ...DEFAULTS, units: 'px' })).toContain('width="2362" height="2362"')
    expect(laserSvg(design().g, { ...DEFAULTS, units: 'in', width: 254, height: 127 })).toContain('width="10in" height="5in" viewBox="0 0 254 127"')
  })

  it('writes laser cuts as red hairlines, holes before the outer cut', () => {
    const { s, g } = design({ cellStyle: 'holes' })
    const svg = laserSvg(g, s)
    expect(svg).toContain('stroke="#ff0000" stroke-width="0.025"')
    expect(svg).not.toContain('<circle')
    expect(svg.match(/<path d=/g)).toHaveLength(g.holes.length)
    expect(svg.indexOf('cut-inner')).toBeLessThan(svg.indexOf('cut-outer'))
    expect(laserSvg(g, { ...s, sheetOutline: false })).not.toContain('cut-outer')
  })

  it('draws rounded corners as SVG arcs', () => {
    const { g } = design({ cellStyle: 'holes', cornerRadius: 1 })
    const d = outlinePath(g.holes[0].outline)
    expect(d.match(/A/g)?.length).toBe(g.holes[0].outline.points.length / 2)
    expect(d.endsWith('Z')).toBe(true)
  })
})

describe('DXF export', () => {
  it('writes a well-formed R12 file with layers and units', () => {
    const { s, g } = design({ cellStyle: 'holes' })
    const pairs = dxfPairs(cutDxf(g, s))
    expect(pairs[0]).toEqual([0, 'SECTION'])
    expect(pairs[pairs.length - 1]).toEqual([0, 'EOF'])
    expect(pairs.every(([code]) => Number.isInteger(code))).toBe(true)
    expect(pairs.filter(p => p[0] === 0 && p[1] === 'POLYLINE')).toHaveLength(g.holes.length + 1)
    const header = pairs.findIndex(p => p[1] === '$INSUNITS')
    expect(pairs[header + 1]).toEqual([70, '4'])
    expect(pairs.some(p => p[0] === 8 && p[1] === LAYER_OUTER)).toBe(true)
  })

  it('writes inches, lines and a true circle for round sheets', () => {
    const { s, g } = design({ units: 'in', width: 254, height: 254, shape: 'ellipse' })
    const pairs = dxfPairs(cutDxf(g, s))
    expect(pairs[pairs.findIndex(p => p[1] === '$INSUNITS') + 1]).toEqual([70, '1'])
    expect(pairs.filter(p => p[0] === 0 && p[1] === 'LINE')).toHaveLength(g.edges.internal.length)
    expect(pairs.filter(p => p[0] === 0 && p[1] === 'CIRCLE')).toHaveLength(2)
    const radius = pairs.find(p => p[0] === 40)
    expect(Number(radius?.[1])).toBeCloseTo(5 - 5 / 25.4, 4)
  })

  it('flips y and keeps each arc centred on its corner', () => {
    const { s, g } = design({ cellStyle: 'holes', cornerRadius: 1.5 })
    const hole = g.holes[0]
    const pairs = dxfPairs(cutDxf(g, s))
    // Read the first hole's vertices and bulges back.
    const start = pairs.findIndex(p => p[1] === 'POLYLINE')
    const vertices: [number, number][] = [], bulges: number[] = []
    for (let i = start + 1; pairs[i][1] !== 'SEQEND'; i++) {
      if (pairs[i][1] !== 'VERTEX') continue
      const get = (code: number) => { for (let j = i + 1; j < pairs.length && pairs[j][0] !== 0; j++) if (pairs[j][0] === code) return Number(pairs[j][1]); return 0 }
      vertices.push([get(10), get(20)]); bulges.push(get(42))
    }
    const outline: Outline = { points: vertices, bulges }
    expect(outline.points).toHaveLength(hole.outline.points.length)
    const i = hole.outline.bulges.findIndex(b => b !== 0)
    const original = arcFromBulge(hole.outline.points[i], hole.outline.points[i + 1], hole.outline.bulges[i])
    const flipped = arcFromBulge(outline.points[i], outline.points[i + 1], outline.bulges[i])
    expect(flipped.cx).toBeCloseTo(original.cx, 3)
    expect(flipped.cy).toBeCloseTo(s.height - original.cy, 3)
    expect(flipped.r).toBeCloseTo(1.5, 3)
    expect(pairs.some(p => p[0] === 8 && p[1] === LAYER_INNER)).toBe(true)
  })
})
