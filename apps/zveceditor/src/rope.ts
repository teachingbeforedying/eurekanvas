import type { ScreenPoint } from "@eurekanvas/engine";

/**
 * A "rope" stabilizer, to draw smooth, tight lines with a shaky mouse.
 *
 * The brush is tied to the pointer by a rope of fixed length, in screen pixels. While the pointer stays
 * within a rope's length of the brush, the brush does not move at all, so every tremor smaller than the
 * rope disappears. When the pointer goes farther, the brush is pulled along the straight line towards it,
 * until it is exactly one rope's length away. A rope of length 0 is no rope: the brush is the pointer.
 *
 * The rope is measured on the screen, because that is where the hand shakes. To draw finer details, zoom in.
 *
 * Everything here is in screen pixels. The editor tells the rope when the view moves or zooms, so that the
 * brush stays on the same place of the drawing.
 */
export class Rope {
  private brush: ScreenPoint = { x: 0, y: 0 };

  constructor(readonly length: number) {
    if (!(Number.isFinite(length) && length >= 0)) throw new RangeError(`rope length must be 0 or more, got ${length}`);
  }

  /** Where the brush is. */
  get position(): ScreenPoint {
    return this.brush;
  }

  /** Puts the brush on the pointer, to begin a stroke. Returns the brush. */
  start(pointer: ScreenPoint): ScreenPoint {
    this.brush = pointer;
    return this.brush;
  }

  /** The pointer moved. Returns the new position of the brush, or `null` if the brush did not move. */
  move(pointer: ScreenPoint): ScreenPoint | null {
    const dx = pointer.x - this.brush.x;
    const dy = pointer.y - this.brush.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= this.length) return null;
    const pulled =
      this.length === 0
        ? pointer
        : { x: pointer.x - (dx / distance) * this.length, y: pointer.y - (dy / distance) * this.length };
    this.brush = pulled;
    return pulled;
  }

  /** The stroke ends: the brush goes to the pointer. Returns it, or `null` if it was already there. */
  finish(pointer: ScreenPoint): ScreenPoint | null {
    if (pointer.x === this.brush.x && pointer.y === this.brush.y) return null;
    this.brush = pointer;
    return pointer;
  }

  /** The view zoomed by `ratio` around `pivot`: the brush keeps its place on the drawing. */
  zoomed(pivot: ScreenPoint, ratio: number): void {
    this.brush = {
      x: pivot.x + (this.brush.x - pivot.x) * ratio,
      y: pivot.y + (this.brush.y - pivot.y) * ratio,
    };
  }

  /** The view moved by `(dx, dy)` pixels: the brush keeps its place on the drawing. */
  shifted(dx: number, dy: number): void {
    this.brush = { x: this.brush.x + dx, y: this.brush.y + dy };
  }
}
