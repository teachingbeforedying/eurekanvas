import { Color, type FabricObject, Path, Rect, StaticCanvas, util } from "fabric";
import {
  type PathCommand,
  type Renderer,
  type PlacedSection,
  type RectangleOnScreen,
  type Scene,
  type ScreenBounds,
  type Section,
  type SectionProjection,
  type Viewport,
  rectangleOnScreen,
  selectDrawableSections,
  strokeOutline,
  turnOf,
  turned,
  unturned,
} from "@eurekanvas/engine";

export interface FabricRendererOptions {
  /** Colour of the strokes. Default: black. */
  readonly color?: string;
  /** Colour of the selected strokes, of the frame around them, and of the rectangle dragged from left to right. Default: blue. */
  readonly selectionColor?: string;
  /** Colour of the rectangle dragged from right to left, which takes what it touches. Default: green. */
  readonly touchingColor?: string;
  /** Colour of the background. Default: white. */
  readonly background?: string;
  /** Passed on to `selectDrawableSections`. */
  readonly maxLevelGap?: number;
}

/** Space between the selected ink and its frame, in pixels. */
const FRAME_PADDING = 4;

/** How far beyond the screen, in pixels, a side of the frame or of the rectangle is drawn at most. */
const OFF_SCREEN_MARGIN = 10;

/** Opacity of the inside of the selection rectangle. */
const BAND_FILL_OPACITY = 0.12;

/** Dashes of the frame and of the rectangle that takes what it touches: dash and gap lengths, in pixels. */
const DASHES = [6, 4];

type PathData = ConstructorParameters<typeof Path>[0];

/** The engine's neutral path commands, in the form fabric expects (SVG path commands as arrays). */
function toPathData(commands: readonly PathCommand[]): PathData {
  const data = commands.map((command) => {
    switch (command.type) {
      case "M":
      case "L":
        return [command.type, command.x, command.y];
      case "A":
        return ["A", command.radius, command.radius, 0, command.largeArc ? 1 : 0, command.sweep ? 1 : 0, command.x, command.y];
      case "Z":
        return ["Z"];
    }
  });
  return data as unknown as PathData;
}

/**
 * Draws strokes with fabric.js, on a static canvas (fabric's own selection and controls are not used: the
 * selection comes with the scene).
 *
 * Each placed section of a stroke becomes one fabric `Path`, drawn in the section's own local units and placed
 * on the screen by a transformation relative to the camera (with the turn and the mirror of its object). The
 * outline of a section is computed once for as long as the section object lives, and its `Path` once for as
 * long as the placed section lives; only the transformation and the colour change. The selected sections are
 * drawn in the selection colour, with one dashed frame around the selection, and the rectangle being dragged to
 * select is drawn on top.
 */
export class FabricRenderer implements Renderer {
  private readonly canvas: StaticCanvas;
  private readonly outlines = new WeakMap<Section, PathData>();
  private readonly paths = new WeakMap<PlacedSection, Path>();
  private readonly color: string;
  private readonly selectionColor: string;
  private readonly touchingColor: string;
  private readonly maxLevelGap: number | undefined;
  private readonly frame: Rect;
  private readonly band: Rect;
  private shown: FabricObject[] = [];
  private drawn = 0;

  constructor(element: HTMLCanvasElement, viewport: Viewport, options: FabricRendererOptions = {}) {
    this.color = options.color ?? "#000000";
    this.selectionColor = options.selectionColor ?? "#1a66ff";
    this.touchingColor = options.touchingColor ?? "#1f9d55";
    this.maxLevelGap = options.maxLevelGap;
    this.canvas = new StaticCanvas(element, {
      width: viewport.width,
      height: viewport.height,
      backgroundColor: options.background ?? "#ffffff",
      renderOnAddRemove: false,
    });
    const box = { originX: "left", originY: "top", strokeWidth: 1, objectCaching: false, selectable: false, evented: false } as const;
    this.frame = new Rect({ ...box, fill: "", stroke: this.selectionColor, strokeDashArray: DASHES });
    this.band = new Rect({ ...box });
  }

  /** How many sections the last `render` call drew. */
  get drawnSections(): number {
    return this.drawn;
  }

  resize(viewport: Viewport): void {
    this.canvas.setDimensions({ width: viewport.width, height: viewport.height });
  }

  render(scene: Scene): void {
    const options = this.maxLevelGap === undefined ? {} : { maxLevelGap: this.maxLevelGap };
    const drawable = selectDrawableSections(scene.sections, scene.camera, scene.viewport, options);
    const selected = scene.selectedSections;
    const next: FabricObject[] = drawable.map(({ placed, projection }) => {
      const path = this.pathFor(placed);
      place(path, projection);
      path.set("fill", selected?.has(placed) ? this.selectionColor : this.color);
      return path;
    });
    this.drawn = next.length;

    if (scene.selectionFrame) {
      // the frame follows the axes of the drawing, or of the selected object: it turns with them
      const frame = rectangleOnScreen(scene.camera, scene.viewport, scene.selectionFrame);
      if (placeFrame(this.frame, frame, scene.viewport)) next.push(this.frame);
    }
    if (scene.band) {
      const { from, to, mode } = scene.band;
      const box = { left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), right: Math.max(from.x, to.x), bottom: Math.max(from.y, to.y) };
      const color = mode === "inside" ? this.selectionColor : this.touchingColor;
      this.band.set({
        stroke: color,
        fill: new Color(color).setAlpha(BAND_FILL_OPACITY).toRgba(),
        strokeDashArray: mode === "inside" ? null : DASHES,
      });
      if (placeBox(this.band, box, scene.viewport)) next.push(this.band);
    }

    if (this.shown.length > 0) this.canvas.remove(...this.shown);
    if (next.length > 0) this.canvas.add(...next);
    this.shown = next;
    this.canvas.renderAll();
  }

  dispose(): void {
    this.shown = [];
    void this.canvas.dispose();
  }

  private pathFor(placed: PlacedSection): Path {
    const known = this.paths.get(placed);
    if (known !== undefined) return known;
    const { section } = placed;
    let outline = this.outlines.get(section);
    if (outline === undefined) {
      outline = toPathData(strokeOutline(section.points));
      this.outlines.set(section, outline);
    }
    const path = new Path(outline, {
      fill: this.color,
      stroke: null,
      strokeWidth: 0,
      objectCaching: false,
      selectable: false,
      evented: false,
    });
    this.paths.set(placed, path);
    return path;
  }
}

/**
 * Places a section's path so that its local point `(x, y)` lands at `origin + R · M · (x, y) * scale`, `R` being
 * the turn of the view and of the object, `M` its mirror. A fabric `Path` draws its coordinates minus
 * `pathOffset` (the centre of its box) around its own centre, and `applyTransformToObject` positions the object by
 * that centre.
 */
function place(path: Path, projection: SectionProjection): void {
  const { origin, scale, turn, mirror } = projection;
  const m = mirror ? -1 : 1;
  const centre = turned(turn, path.pathOffset.x * scale, m * path.pathOffset.y * scale);
  util.applyTransformToObject(path, [
    turn.cos * scale,
    turn.sin * scale,
    -turn.sin * scale * m,
    turn.cos * scale * m,
    origin.x + centre.x,
    origin.y + centre.y,
  ]);
  path.setCoords();
}

/**
 * Places the dashed frame around a selection, at its angle, a few pixels away from the ink. In a straight frame,
 * its 1-pixel line lies on whole pixels. A side far beyond the screen is drawn just outside it, since the canvas
 * computes with single precision. Returns `false` when the frame cannot be seen.
 */
function placeFrame(rect: Rect, frame: RectangleOnScreen, viewport: Viewport): boolean {
  const { center, angle } = frame;
  if (!(Number.isFinite(center.x) && Number.isFinite(center.y))) return false;
  const turn = turnOf(angle);
  const middle = { x: viewport.width / 2, y: viewport.height / 2 };
  const reach = Math.hypot(middle.x, middle.y) + OFF_SCREEN_MARGIN; // the screen is this close to its middle, whatever the turn
  const seen = unturned(turn, middle.x - center.x, middle.y - center.y); // the middle of the screen, along the frame's sides
  const halfWidth = frame.width / 2 + FRAME_PADDING;
  const halfHeight = frame.height / 2 + FRAME_PADDING;
  let left = Math.max(-halfWidth, seen.x - reach);
  let right = Math.min(halfWidth, seen.x + reach);
  let top = Math.max(-halfHeight, seen.y - reach);
  let bottom = Math.min(halfHeight, seen.y + reach);
  if (left > right || top > bottom) return false;
  if (angle === 0) {
    // a line centred on a half pixel covers whole pixels
    const snap = (side: number, at: number): number => Math.round(at + side) + 0.5 - at;
    [left, right, top, bottom] = [snap(left, center.x), snap(right, center.x), snap(top, center.y), snap(bottom, center.y)];
  }
  const shift = turned(turn, (left + right) / 2, (top + bottom) / 2);
  rect.set({ width: right - left, height: bottom - top });
  util.applyTransformToObject(rect, [turn.cos, turn.sin, -turn.sin, turn.cos, center.x + shift.x, center.y + shift.y]);
  rect.setCoords();
  return true;
}

/**
 * Places a rectangle on the screen, its 1-pixel line on whole pixels. A side far beyond the screen is drawn just
 * outside it, since the canvas computes with single precision. Returns `false` when the rectangle cannot be seen.
 */
function placeBox(rect: Rect, box: ScreenBounds, viewport: Viewport): boolean {
  if (box.right < 0 || box.left > viewport.width || box.bottom < 0 || box.top > viewport.height) return false;
  const clamp = (value: number, size: number): number => Math.round(Math.min(size + OFF_SCREEN_MARGIN, Math.max(-OFF_SCREEN_MARGIN, value)));
  const left = clamp(box.left, viewport.width);
  const top = clamp(box.top, viewport.height);
  // `left` and `top` are the outer edge of the line: a 1-pixel line centred half a pixel inside covers whole pixels
  rect.set({ left, top, width: clamp(box.right, viewport.width) - left, height: clamp(box.bottom, viewport.height) - top });
  rect.setCoords();
  return true;
}
