import { describe, expect, it } from 'vitest'
import { isDrag } from './drag'

describe('telling a click from a drag', () => {
  it('counts a press as a drag only past a few pixels: 4 with a mouse or pen, 8 with a finger', () => {
    for (const [dx, dy, type, drag] of [
      [0, 0, 'mouse', false], [1, 0, 'mouse', false], [3, 2, 'mouse', false], [4, 0, 'mouse', true], [3, 3, 'pen', true],
      [7, 0, 'touch', false], [0, 8, 'touch', true], [-20, 5, 'mouse', true],
    ] as [number, number, string, boolean][]) expect(isDrag(dx, dy, type)).toBe(drag)
  })
})
