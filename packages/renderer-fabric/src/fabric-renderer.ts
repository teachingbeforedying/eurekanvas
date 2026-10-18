import { Path, StaticCanvas, util } from "fabric";
import {
  type PathCommand,
  type Renderer,
  type Scene,
  type Section,
  type SectionProjection,
  type Viewport,
  selectDrawableSections,
  strokeOutline,
} from "@eurekanvas/engine";

export interface FabricRendererOptions {
  /** Colour of the strokes. Default: black. */
  readonly color?: string;
  /** Colour of the background. Default: white. */
  readonly background?: string;
  /** Passed on to `selectDrawableSections`. */
  readonly maxLevelGap?: number;
}

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
 * Draws strokes with fabric.js, on a static canvas (no selection or controls for now).
 *
 * Each section of a stroke becomes one fabric `Path`, drawn in the section's own local units and placed
 * on the screen by a transformation relative to the camera. A section is immutable, so its `Path` is
 * built once and kept for as long as the section object lives; only its transformation changes with the
 * camera.
 */
export class FabricRenderer implements Renderer {
  private readonly canvas: StaticCanvas;
  private readonly paths = new WeakMap<Section, Path>();
  private readonly color: string;
  private readonly maxLevelGap: number | undefined;
  private shown: Path[] = [];

  constructor(element: HTMLCanvasElement, viewport: Viewport, options: FabricRendererOptions = {}) {
    this.color = options.color ?? "#000000";
    this.maxLevelGap = options.maxLevelGap;
    this.canvas = new StaticCanvas(element, {
      width: viewport.width,
      height: viewport.height,
      backgroundColor: options.background ?? "#ffffff",
      renderOnAddRemove: false,
    });
  }

  /** How many sections the last `render` call drew. */
  get drawnSections(): number {
    return this.shown.length;
  }

  resize(viewport: Viewport): void {
    this.canvas.setDimensions({ width: viewport.width, height: viewport.height });
  }

  render(scene: Scene): void {
    const options = this.maxLevelGap === undefined ? {} : { maxLevelGap: this.maxLevelGap };
    const drawable = selectDrawableSections(scene.strokes, scene.camera, scene.viewport, options);
    const next = drawable.map(({ section, projection }) => {
      const path = this.pathFor(section);
      place(path, projection);
      return path;
    });
    if (this.shown.length > 0) this.canvas.remove(...this.shown);
    if (next.length > 0) this.canvas.add(...next);
    this.shown = next;
    this.canvas.renderAll();
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
 * Places a section's path so that its local point `(x, y)` lands at `origin + (x, y) * scale`.
 * A fabric `Path` draws its coordinates minus `pathOffset` (the centre of its box) around its own centre,
 * and `applyTransformToObject` positions the object by that centre.
 */
function place(path: Path, projection: SectionProjection): void {
  const { origin, scale } = projection;
  util.applyTransformToObject(path, [
    scale,
    0,
    0,
    scale,
    origin.x + path.pathOffset.x * scale,
    origin.y + path.pathOffset.y * scale,
  ]);
  path.setCoords();
}
