import { Color, type FabricObject, Path, Rect, StaticCanvas, util } from "fabric";
import {
  type PathCommand,
  type Renderer,
  type Scene,
  type ScreenBounds,
  type Section,
  type SectionProjection,
  type Stroke,
  type Turn,
  type Viewport,
  selectDrawableSections,
  strokeOutline,
  turnOf,
  turned,
  viewBounds,
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
 * Each section of a stroke becomes one fabric `Path`, drawn in the section's own local units and placed
 * on the screen by a transformation relative to the camera. A section is immutable, so its `Path` is
 * built once and kept for as long as the section object lives; only its transformation and its colour
 * change. The selected strokes are drawn in the selection colour, with one dashed frame around them all, and
 * the rectangle being dragged to select is drawn on top.
 */
export class FabricRenderer implements Renderer {
  private readonly canvas: StaticCanvas;
  private readonly paths = new WeakMap<Section, Path>();
  private readonly color: string;
  private readonly selectionColor: string;
  private readonly touchingColor: string;
  private readonly maxLevelGap: number | undefined;
  private readonly frame: Rect;
  private readonly band: Rect;
  /** The sections of the selected strokes, remembered for the set of strokes they come from. */
  private selectedSections: { readonly from: ReadonlySet<Stroke> | undefined; readonly sections: ReadonlySet<Section> } = {
    from: undefined,
    sections: new Set(),
  };
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
    const drawable = selectDrawableSections(scene.strokes, scene.camera, scene.viewport, options);
    const selected = this.sectionsOf(scene.selectedStrokes);
    const next: FabricObject[] = drawable.map(({ section, projection }) => {
      const path = this.pathFor(section);
      place(path, projection);
      path.set("fill", selected.has(section) ? this.selectionColor : this.color);
      return path;
    });
    this.drawn = next.length;

    if (scene.selectionBounds) {
      // the frame follows the axes of the drawing: it turns with the view
      const box = viewBounds(scene.camera, scene.selectionBounds);
      const padded = {
        left: box.left - FRAME_PADDING,
        top: box.top - FRAME_PADDING,
        right: box.right + FRAME_PADDING,
        bottom: box.bottom + FRAME_PADDING,
      };
      if (placeTurnedBox(this.frame, padded, turnOf(scene.camera.angle), scene.viewport)) next.push(this.frame);
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

  private sectionsOf(strokes: ReadonlySet<Stroke> | undefined): ReadonlySet<Section> {
    if (this.selectedSections.from !== strokes) {
      const sections = new Set<Section>();
      for (const stroke of strokes ?? []) for (const section of stroke.sections) sections.add(section);
      this.selectedSections = { from: strokes, sections };
    }
    return this.selectedSections.sections;
  }

  dispose(): void {
    this.shown = [];
    void this.canvas.dispose();
  }

  private pathFor(section: Section): Path {
    const known = this.paths.get(section);
    if (known !== undefined) return known;
    const path = new Path(toPathData(strokeOutline(section.points)), {
      fill: this.color,
      stroke: null,
      strokeWidth: 0,
      objectCaching: false,
      selectable: false,
      evented: false,
    });
    this.paths.set(section, path);
    return path;
  }
}

/**
 * Places a section's path so that its local point `(x, y)` lands at `origin + R · (x, y) * scale`, `R` being
 * the view's turn. A fabric `Path` draws its coordinates minus `pathOffset` (the centre of its box) around its
 * own centre, and `applyTransformToObject` positions the object by that centre.
 */
function place(path: Path, projection: SectionProjection): void {
  const { origin, scale, turn } = projection;
  const centre = turned(turn, path.pathOffset.x * scale, path.pathOffset.y * scale);
  util.applyTransformToObject(path, [
    turn.cos * scale,
    turn.sin * scale,
    -turn.sin * scale,
    turn.cos * scale,
    origin.x + centre.x,
    origin.y + centre.y,
  ]);
  path.setCoords();
}

/**
 * Places a rectangle given along the axes of the drawing, in pixels from the middle of the screen (see
 * `viewBounds`), turned with the view around the middle. In a straight view its 1-pixel line lies on whole
 * pixels. A side far beyond the screen is drawn just outside it, since the canvas computes with single
 * precision. Returns `false` when the rectangle cannot be seen.
 */
function placeTurnedBox(rect: Rect, box: ScreenBounds, turn: Turn, viewport: Viewport): boolean {
  const middle = { x: viewport.width / 2, y: viewport.height / 2 };
  const reach = Math.hypot(middle.x, middle.y) + OFF_SCREEN_MARGIN; // the screen is this close to the middle, whatever the turn
  if (box.right < -reach || box.left > reach || box.bottom < -reach || box.top > reach) return false;
  // a line centred on a half pixel covers whole pixels
  const side = (value: number, centre: number): number => Math.round(centre + Math.min(reach, Math.max(-reach, value))) + 0.5 - centre;
  const left = side(box.left, middle.x);
  const right = side(box.right, middle.x);
  const top = side(box.top, middle.y);
  const bottom = side(box.bottom, middle.y);
  const centre = turned(turn, (left + right) / 2, (top + bottom) / 2);
  rect.set({ width: right - left, height: bottom - top });
  util.applyTransformToObject(rect, [turn.cos, turn.sin, -turn.sin, turn.cos, middle.x + centre.x, middle.y + centre.y]);
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
