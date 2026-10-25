import {
  type Camera,
  type Drawing,
  type Scene,
  type ScreenPoint,
  type Stroke,
  type Viewport,
  StrokeRecorder,
  createCamera,
  pan,
  zoomAt,
} from "@eurekanvas/engine";
import { Rope } from "./rope";

/** The same wheel step as the previous version of the engine: one notch (a `deltaY` of 100) is a factor of 1.2 or 0.8. */
export const WHEEL_STEP = 1 / 500;

/** Thickness of the stroke on the screen, in pixels, at the moment it is drawn. */
export const STROKE_WIDTH_PIXELS = 3;

/** The lengths, in pixels, that the keys step through for the rope of fixed length. */
export const ROPE_LENGTHS = [4, 8, 16, 32, 64, 128] as const;

export const DEFAULT_ROPE_LENGTH = 16;

/** The lags, in milliseconds, that the keys step through for the rope that follows the speed of the hand. */
export const LAG_TIMES = [25, 50, 100, 200, 400] as const;

export const DEFAULT_LAG = 50;

/** The longest rope that follows the speed of the hand, in pixels. */
export const SPEED_ROPE_MAX = 128;

export type PenKind = "raw" | "fixed" | "speed";

/**
 * The pen. `raw`: the stroke goes through every pointer position. `fixed`: a rope of `length` pixels (see
 * `Rope`). `speed`: a rope as long as the distance the pointer moved in the last `lag` milliseconds, between
 * `MIN_SPEED_ROPE` and `SPEED_ROPE_MAX` pixels. Each kind keeps its setting while another one is in use.
 */
export interface Pen {
  readonly kind: PenKind;
  readonly length: number;
  readonly lag: number;
}

export const DEFAULT_PEN: Pen = { kind: "speed", length: DEFAULT_ROPE_LENGTH, lag: DEFAULT_LAG };

/** The rope of one stroke drawn with `pen`. */
function ropeFor(pen: Pen): Rope {
  switch (pen.kind) {
    case "raw":
      return new Rope(0);
    case "fixed":
      return new Rope(pen.length);
    case "speed":
      return new Rope(SPEED_ROPE_MAX, pen.lag);
  }
}

export type Button = "primary" | "middle" | "secondary";

/** The zoom factor for a wheel movement: `deltaY > 0` zooms out, `deltaY < 0` zooms in. */
export function wheelZoomFactor(deltaY: number): number {
  const amount = Math.min(0.99, Math.max(-0.99, -deltaY * WHEEL_STEP));
  return 1 + amount;
}

export interface EditorStats {
  readonly strokes: number;
  readonly sections: number;
  readonly points: number;
}

/**
 * What the zveceditor tool does, without any DOM: it is given pointer and wheel events and keeps the
 * camera and the strokes. The page forwards browser events to it and draws its `scene`.
 *
 * - primary button: draw (with Space held: move the view);
 * - middle or secondary button: move the view. It can be pressed while the primary button is down: the
 *   stroke is paused, the view follows the pointer, and drawing goes on from the same place of the
 *   stroke when the button is released;
 * - wheel: zoom around the pointer, also while drawing. The point of the world under the pointer does not
 *   move, so zooming alone adds nothing to the stroke: the next pointer move continues it, with the
 *   thickness that makes it `STROKE_WIDTH_PIXELS` thick on the screen at that moment.
 *
 * The pen can be smoothed with a rope (see `Rope` and `Pen`): the stroke follows the pointer at a distance of
 * at most the rope length, which removes the tremor of a hand. Without a rope the stroke goes through every
 * pointer position. Times are in milliseconds, as in `PointerEvent.timeStamp`.
 */
export class Editor {
  private _camera: Camera = createCamera();
  private _viewport: Viewport;
  private finished: readonly Stroke[] = [];
  /** The finished strokes before each action (a stroke, an added drawing, a clear), for `undo`. */
  private readonly history: (readonly Stroke[])[] = [];
  private recorder: StrokeRecorder | null = null;
  private rope = new Rope(0);
  private _pen: Pen = { ...DEFAULT_PEN, kind: "raw" };
  /** How many of the secondary and middle buttons are down. */
  private panButtons = 0;
  /** The primary button is down with Space held: it moves the view instead of drawing. */
  private spacePanning = false;
  private spaceHeld = false;
  /** Where the pointer was at the last event. */
  private last: ScreenPoint = { x: 0, y: 0 };

  constructor(viewport: Viewport) {
    this._viewport = viewport;
  }

  get camera(): Camera {
    return this._camera;
  }

  get viewport(): Viewport {
    return this._viewport;
  }

  /** The finished strokes, in drawing order: what is saved. */
  get strokes(): readonly Stroke[] {
    return this.finished;
  }

  /** What to draw: the finished strokes, then the one being drawn. */
  get scene(): Scene {
    const current = this.recorder?.stroke;
    return {
      camera: this._camera,
      viewport: this._viewport,
      strokes: current === undefined ? this.finished : [...this.finished, current],
    };
  }

  get stats(): EditorStats {
    const strokes = this.scene.strokes;
    let sections = 0;
    let points = 0;
    for (const stroke of strokes) {
      sections += stroke.sections.length;
      for (const section of stroke.sections) points += section.points.length;
    }
    return { strokes: strokes.length, sections, points };
  }

  /** A stroke is open: the primary button is down, even if the view is being moved meanwhile. */
  get isDrawing(): boolean {
    return this.recorder !== null;
  }

  /** The view follows the pointer. */
  get isMovingView(): boolean {
    return this.panButtons > 0 || this.spacePanning;
  }

  get pen(): Pen {
    return this._pen;
  }

  /** Changes the pen for the next strokes. Ignored while a stroke is being drawn. */
  setPen(pen: Pen): void {
    new Rope(pen.length, pen.lag); // refuses an invalid length or lag, whatever the kind
    if (this.isDrawing) return;
    this._pen = pen;
  }

  /** The length of the rope now, in pixels, while a stroke is drawn; `null` otherwise. */
  get ropeNow(): number | null {
    return this.recorder ? this.rope.currentLength : null;
  }

  pointerDown(p: ScreenPoint, button: Button, time = performance.now()): void {
    if (button === "primary") {
      if (this.isDrawing || this.isMovingView) return; // a second press, or a press while the view moves
      this.last = p;
      if (this.spaceHeld) {
        this.spacePanning = true;
        return;
      }
      this.recorder = new StrokeRecorder();
      this.rope = ropeFor(this._pen);
      this.recorder.addScreenPoint(this._camera, this._viewport, this.rope.start(p, time), STROKE_WIDTH_PIXELS);
    } else {
      this.panButtons += 1;
      this.last = p;
    }
  }

  pointerMove(p: ScreenPoint, time = performance.now()): void {
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    if (this.isMovingView) {
      this._camera = pan(this._camera, dx, dy);
      // the content follows the pointer, and so does the end of the stroke that is paused
      if (this.recorder) this.rope.shifted(dx, dy);
    } else if (this.recorder) {
      const brush = this.rope.move(p, time);
      if (brush) this.recorder.addScreenPoint(this._camera, this._viewport, brush, STROKE_WIDTH_PIXELS);
    }
    this.last = p;
  }

  /**
   * A button was released. Releasing the primary button ends the stroke where the brush is: nothing is added,
   * so the stroke is what was visible while drawing, even if the rope kept the brush behind the pointer.
   */
  pointerUp(button: Button = "primary"): void {
    if (button !== "primary") {
      this.panButtons = Math.max(0, this.panButtons - 1);
      return;
    }
    if (this.spacePanning) {
      this.spacePanning = false;
      return;
    }
    if (this.recorder) {
      this.commit([...this.finished, this.recorder.stroke]);
      this.recorder = null;
    }
  }

  /** Zooms around `p`, whatever the mode. */
  wheel(p: ScreenPoint, deltaY: number): void {
    const ratio = wheelZoomFactor(deltaY);
    this._camera = zoomAt(this._camera, this._viewport, p, ratio);
    if (this.recorder) this.rope.zoomed(p, ratio); // the end of the stroke stays on the drawing
  }

  /** While Space is held, the primary button moves the view instead of drawing. */
  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
  }

  resize(viewport: Viewport): void {
    // the centre of the view stays at the middle of the screen, so the drawing shifts by half the change
    const dx = (viewport.width - this._viewport.width) / 2;
    const dy = (viewport.height - this._viewport.height) / 2;
    this._viewport = viewport;
    if (this.recorder) this.rope.shifted(dx, dy);
  }

  /**
   * Puts back a saved drawing when the page opens, with nothing to undo. Strokes drawn before it came back are
   * kept, after its own: nothing is lost if it comes late. Its view is shown, unless a stroke is being drawn.
   */
  restore(drawing: Drawing): void {
    this.finished = [...drawing.strokes, ...this.finished];
    this.history.length = 0;
    if (!this.isDrawing) this._camera = drawing.view;
  }

  /**
   * Adds the strokes of a drawing where they were drawn, and shows its view. `undo` removes them all at once
   * (and leaves the view). Returns `false`, doing nothing, while a stroke is being drawn.
   */
  addDrawing(drawing: Drawing): boolean {
    if (this.isDrawing) return false;
    if (drawing.strokes.length > 0) this.commit([...this.finished, ...drawing.strokes]);
    this._camera = drawing.view;
    return true;
  }

  /** Removes every stroke; `undo` brings them all back. Returns `false`, doing nothing, while a stroke is being drawn. */
  clear(): boolean {
    if (this.isDrawing) return false;
    if (this.finished.length > 0) this.commit([]);
    return true;
  }

  /** Undoes the last action: a stroke, an added drawing or a clear. The view stays where it is. Does nothing while drawing. */
  undo(): void {
    if (this.isDrawing) return;
    const previous = this.history.pop();
    if (previous) this.finished = previous;
  }

  private commit(strokes: readonly Stroke[]): void {
    this.history.push(this.finished);
    this.finished = strokes;
  }

  /** Goes back to the starting view: the world origin at the middle of the screen, at the starting zoom. */
  resetView(): void {
    this._camera = createCamera();
  }
}
