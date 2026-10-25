import type { ScreenPoint } from "@eurekanvas/engine";

/** The shortest rope that follows the speed of the hand, in pixels: it still removes the smallest tremors. */
export const MIN_SPEED_ROPE = 4;

interface Sample {
  readonly p: ScreenPoint;
  readonly time: number;
}

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * A "rope" stabilizer, to draw smooth, tight lines with a shaky mouse.
 *
 * The brush is tied to the pointer by a rope of fixed length, in screen pixels. While the pointer stays
 * within a rope's length of the brush, the brush does not move at all, so every tremor smaller than the
 * rope disappears. When the pointer goes farther, the brush is pulled along the straight line towards it,
 * until it is exactly one rope's length away. A rope of length 0 is no rope: the brush is the pointer.
 *
 * With a lag, the length of the rope follows the speed of the hand: it is the distance between the pointer and
 * where the pointer was `lag` milliseconds before, between `MIN_SPEED_ROPE` and `length`. A fast hand gets a
 * long rope, so a smooth and tight line; a slow hand gets a short one, so the brush follows it closely, and a
 * hairpin can be as tight as one wants by slowing down in the turn.
 *
 * The rope is measured on the screen, because that is where the hand shakes. To draw finer details, zoom in.
 *
 * Everything here is in screen pixels. The editor tells the rope when the view moves or zooms, so that the
 * brush stays on the same place of the drawing.
 */
export class Rope {
  private brush: ScreenPoint = { x: 0, y: 0 };
  /** With a lag: where the pointer was during the last `lag` milliseconds, oldest first, and one sample before. */
  private samples: Sample[] = [];
  private _currentLength: number;

  constructor(
    readonly length: number,
    readonly lag = 0,
  ) {
    if (!(Number.isFinite(length) && length >= 0)) throw new RangeError(`rope length must be 0 or more, got ${length}`);
    if (!(Number.isFinite(lag) && lag >= 0)) throw new RangeError(`rope lag must be 0 or more, got ${lag}`);
    this._currentLength = this.initialLength();
  }

  /** Where the brush is. */
  get position(): ScreenPoint {
    return this.brush;
  }

  /** The length of the rope now, in pixels. It changes only with a lag. */
  get currentLength(): number {
    return this._currentLength;
  }

  /** Puts the brush on the pointer, to begin a stroke at `time` (in milliseconds). Returns the brush. */
  start(pointer: ScreenPoint, time = 0): ScreenPoint {
    this.brush = pointer;
    this.samples = this.lag > 0 ? [{ p: pointer, time }] : [];
    this._currentLength = this.initialLength();
    return this.brush;
  }

  /** The pointer moved, at `time` (in milliseconds). Returns the new position of the brush, or `null` if the brush did not move. */
  move(pointer: ScreenPoint, time = 0): ScreenPoint | null {
    if (this.lag > 0) this.follow(pointer, time);
    const length = this._currentLength;
    const dx = pointer.x - this.brush.x;
    const dy = pointer.y - this.brush.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= length) return null;
    const pulled =
      length === 0 ? pointer : { x: pointer.x - (dx / distance) * length, y: pointer.y - (dy / distance) * length };
    this.brush = pulled;
    return pulled;
  }

  /** The view zoomed by `ratio` around `pivot`: the brush keeps its place on the drawing. */
  zoomed(pivot: ScreenPoint, ratio: number): void {
    this.brush = {
      x: pivot.x + (this.brush.x - pivot.x) * ratio,
      y: pivot.y + (this.brush.y - pivot.y) * ratio,
    };
  }

  /**
   * The view moved by `(dx, dy)` pixels: the brush keeps its place on the drawing. The hand moved with the
   * view, not on the drawing, so its speed is measured again from here: until then, the rope keeps its length.
   */
  shifted(dx: number, dy: number): void {
    this.brush = { x: this.brush.x + dx, y: this.brush.y + dy };
    this.samples = [];
  }

  private initialLength(): number {
    return this.lag > 0 ? Math.min(MIN_SPEED_ROPE, this.length) : this.length;
  }

  /** With a lag: the pointer is at `pointer` at `time`, and the rope takes the distance it moved in the last `lag` ms. */
  private follow(pointer: ScreenPoint, time: number): void {
    const last = this.samples[this.samples.length - 1];
    const now = last === undefined ? time : Math.max(time, last.time); // a time that goes back counts as the last one
    this.samples.push({ p: pointer, time: now });
    const then = now - this.lag;
    // forget the samples before `then`, except the last of them, to know where the pointer was at `then`
    while (this.samples.length > 1 && (this.samples[1] as Sample).time <= then) this.samples.shift();
    const before = this.samples[0] as Sample;
    const after = this.samples[1];
    if (before.time > then || after === undefined) return; // the samples do not cover the lag yet: the length stays
    const k = (then - before.time) / (after.time - before.time);
    const there = { x: before.p.x + (after.p.x - before.p.x) * k, y: before.p.y + (after.p.y - before.p.y) * k };
    this._currentLength = Math.min(this.length, Math.max(MIN_SPEED_ROPE, distance(pointer, there)));
  }
}
