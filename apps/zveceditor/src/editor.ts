import {
  type Camera,
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

/** The rope lengths, in pixels, that the keys step through. A length of 0 is no rope: the raw pen. */
export const ROPE_LENGTHS = [4, 8, 16, 32, 64, 128] as const;

export const DEFAULT_ROPE_LENGTH = 16;

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
 * The pen can be smoothed with a rope (see `Rope`): the stroke follows the pointer at a distance of at most
 * the rope length, which removes the tremor of a hand. Without a rope the stroke goes through every pointer
 * position.
 */
export class Editor {
  private _camera: Camera = createCamera();
  private _viewport: Viewport;
  private readonly finished: Stroke[] = [];
  private recorder: StrokeRecorder | null = null;
  private rope = new Rope(0);
  private _ropeLength = 0;
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

  /** The length of the rope of the pen, in pixels. 0 is the raw pen. */
  get ropeLength(): number {
    return this._ropeLength;
  }

  /** Changes the rope for the next strokes. Ignored while a stroke is being drawn. */
  setRopeLength(length: number): void {
    new Rope(length); // refuses an invalid length
    if (this.isDrawing) return;
    this._ropeLength = length;
  }

  pointerDown(p: ScreenPoint, button: Button): void {
    if (button === "primary") {
      if (this.isDrawing || this.isMovingView) return; // a second press, or a press while the view moves
      this.last = p;
      if (this.spaceHeld) {
        this.spacePanning = true;
        return;
      }
      this.recorder = new StrokeRecorder();
      this.rope = new Rope(this._ropeLength);
      this.recorder.addScreenPoint(this._camera, this._viewport, this.rope.start(p), STROKE_WIDTH_PIXELS);
    } else {
      this.panButtons += 1;
      this.last = p;
    }
  }

  pointerMove(p: ScreenPoint): void {
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    if (this.isMovingView) {
      this._camera = pan(this._camera, dx, dy);
      // the content follows the pointer, and so does the end of the stroke that is paused
      if (this.recorder) this.rope.shifted(dx, dy);
    } else if (this.recorder) {
      const brush = this.rope.move(p);
      if (brush) this.recorder.addScreenPoint(this._camera, this._viewport, brush, STROKE_WIDTH_PIXELS);
    }
    this.last = p;
  }

  /** A button was released. Releasing the primary button ends the stroke at the pointer. */
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
      const end = this.rope.finish(this.last);
      if (end) this.recorder.addScreenPoint(this._camera, this._viewport, end, STROKE_WIDTH_PIXELS);
      this.finished.push(this.recorder.stroke);
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

  /** Removes the last finished stroke. Does nothing while drawing. */
  undo(): void {
    if (this.isDrawing) return;
    this.finished.pop();
  }

  /** Goes back to the starting view: the world origin at the middle of the screen, at the starting zoom. */
  resetView(): void {
    this._camera = createCamera();
  }
}
