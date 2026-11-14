// A press on the sheet becomes a drag only once the pointer has moved a few pixels from where it went down: 4 with a
// mouse or pen, 8 with a finger, about what operating systems use. A click, or the small wobble of a hand or a mouse
// while clicking, then moves nothing. Before 1.13.2 a click on a point that moved it by nothing at all still marked
// the design as edited and unsaved, as if it had been dragged.
export const DRAG_SLOP = { mouse: 4, touch: 8 }

// Whether a press that has moved by dx, dy screen pixels is a drag yet.
export function isDrag(dx: number, dy: number, pointerType: string): boolean {
  return Math.hypot(dx, dy) >= (pointerType === 'touch' ? DRAG_SLOP.touch : DRAG_SLOP.mouse)
}
