/**
 * What a renderer draws, and the choice of which sections of a stroke are worth drawing.
 *
 * The engine does not know any drawing library. A renderer (fabric.js, a plain 2D canvas...) implements
 * `Renderer` and is given a `Scene` whenever something changes.
 */

import type { Camera, ScreenPoint, Viewport } from "./camera";
import type { OrientedRectangle, RectangleMode } from "./hit";
import { farOutline } from "./far";
import type { PathCommand } from "./outline";
import { type PlacedSection, type SectionProjection, backgroundWidth, projectSection, sectionExtent, sectionScale } from "./placement";
import type { Stroke } from "./stroke";

/** The rectangle being dragged to select objects, on the screen: from where it started to the pointer. */
export interface SelectionBand {
  readonly from: ScreenPoint;
  readonly to: ScreenPoint;
  readonly mode: RectangleMode;
}

export interface Scene {
  readonly camera: Camera;
  readonly viewport: Viewport;
  /** What to draw, in drawing order: the sections of the objects where they put them, then the stroke being drawn. */
  readonly sections: readonly PlacedSection[];
  /** The same strokes, as they were drawn (before their objects place them): to count them. */
  readonly strokes: readonly Stroke[];
  /** The sections of the selected objects, drawn in another colour. */
  readonly selectedSections?: ReadonlySet<PlacedSection>;
  /** The exact frame around the selection, drawn dashed; `null` with nothing selected. */
  readonly selectionFrame?: OrientedRectangle | null;
  /** When the selection is a part of a group: the frames of the groups around it, drawn more discreetly. */
  readonly parentFrames?: readonly OrientedRectangle[];
  /** The rectangle being dragged to select, if any. */
  readonly band?: SelectionBand | null;
  /** The brush around the pointer, on the screen, if it is shown. */
  readonly brushOutline?: { readonly center: ScreenPoint; readonly radius: number } | null;
}

export interface Renderer {
  /** The size of the drawing area, in CSS pixels, has changed. */
  resize(viewport: Viewport): void;
  /** Draws the scene, replacing whatever was drawn before. */
  render(scene: Scene): void;
  /** Releases everything the renderer holds. It must not be used afterwards. */
  dispose(): void;
}

/** A placed section, with how to put it on the screen. */
export interface DrawableSection {
  readonly placed: PlacedSection;
  /** The transformation that puts its outline on the screen; `null` when `outline` says what to draw instead. */
  readonly projection: SectionProjection | null;
  /** Its ink cut to the screen, in the coordinates of the screen, for a section that reaches too far for a canvas. */
  readonly outline: readonly PathCommand[] | null;
  /** Its ink is somewhere as thick as the screen: it is a background there. */
  readonly background: boolean;
}

/** Sections smaller than this on the screen, in pixels, are not worth drawing. */
export const DEFAULT_MIN_PIXELS = 0.5;

/**
 * How far, in pixels, a section may reach from the point it is placed on and still be given to the canvas as it is.
 * The 2D canvas of a browser computes with single precision floats, so a section that reaches millions of pixels
 * away would be drawn in the wrong place. Measured in Chrome (docs/noyau.md): the error stays under 0.1 pixel up to
 * about 6 million pixels and is about 0.6 pixel at 10 million; this default keeps a margin. Beyond it, the ink is cut
 * to the screen first (see `farOutline`).
 */
export const DEFAULT_MAX_REACH_PIXELS = 4e6;

export interface SelectionOptions {
  readonly maxLevelGap?: number;
  readonly minPixels?: number;
  readonly maxReachPixels?: number;
}

/**
 * The sections to draw for this camera, in drawing order. A section is left out when it is smaller than `minPixels`
 * on the screen, or entirely outside the screen, or more levels away than `maxLevelGap` if it is given: there is no
 * limit otherwise, however deep the camera is. The stroke thickness counts: a thick stroke whose points are just off
 * the screen can still reach into it. A section that reaches more than `maxReachPixels` from where it is placed comes
 * with its ink cut to the screen, instead of a projection.
 */
export function selectDrawableSections(
  sections: readonly PlacedSection[],
  camera: Camera,
  viewport: Viewport,
  options: SelectionOptions = {},
): DrawableSection[] {
  const maxLevelGap = options.maxLevelGap ?? Infinity;
  const maxReachPixels = options.maxReachPixels ?? DEFAULT_MAX_REACH_PIXELS;
  const drawable: DrawableSection[] = [];
  for (const placed of sections) {
    if (camera.zLevel - placed.zLevel > maxLevelGap) continue;
    const extent = sectionExtent(placed.section);
    const background = extent.maxWidth >= backgroundWidth(placed, camera, viewport);
    const reach = Math.max(Math.abs(extent.minX), Math.abs(extent.maxX), Math.abs(extent.minY), Math.abs(extent.maxY)) + extent.maxWidth / 2;
    if (reach * sectionScale(placed, camera) > maxReachPixels) {
      const outline = farOutline(placed, camera, viewport);
      if (outline.length > 0) drawable.push({ placed, projection: null, outline, background });
    } else {
      const projection = drawableProjection(placed, camera, viewport, options);
      if (projection !== null) drawable.push({ placed, projection, outline: null, background });
    }
  }
  return drawable;
}

/**
 * Where a placed section is on the screen, as plain floats, or `null` when it is out of the screen or too small to
 * be drawn. The floats are precise enough for the local tests of a click, however far the section reaches.
 */
export function drawableProjection(
  placed: PlacedSection,
  camera: Camera,
  viewport: Viewport,
  options: SelectionOptions = {},
): SectionProjection | null {
  const maxLevelGap = options.maxLevelGap ?? Infinity;
  const minPixels = options.minPixels ?? DEFAULT_MIN_PIXELS;

  if (camera.zLevel - placed.zLevel > maxLevelGap) return null;
  const projection = projectSection(placed, camera, viewport);
  if (projection === null) return null;

  const extent = sectionExtent(placed.section);
  const half = extent.maxWidth / 2;
  const { origin, scale, turn } = projection;
  // the box of the ink, mirrored and turned: on the screen, the box around it
  const [x0, x1] = [extent.minX - half, extent.maxX + half];
  const [y0, y1] = projection.mirror ? [-extent.maxY - half, -extent.minY + half] : [extent.minY - half, extent.maxY + half];
  const least = (a: number, b: number): number => (a >= 0 ? a * x0 : a * x1) + (b >= 0 ? b * y0 : b * y1);
  const most = (a: number, b: number): number => (a >= 0 ? a * x1 : a * x0) + (b >= 0 ? b * y1 : b * y0);
  const left = origin.x + least(turn.cos, -turn.sin) * scale;
  const right = origin.x + most(turn.cos, -turn.sin) * scale;
  const top = origin.y + least(turn.sin, turn.cos) * scale;
  const bottom = origin.y + most(turn.sin, turn.cos) * scale;

  if (Math.max(right - left, bottom - top) < minPixels) return null;
  if (right < 0 || left > viewport.width || bottom < 0 || top > viewport.height) return null;
  return projection;
}
