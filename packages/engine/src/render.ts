/**
 * What a renderer draws, and the choice of which sections of a stroke are worth drawing.
 *
 * The engine does not know any drawing library. A renderer (fabric.js, a plain 2D canvas...) implements
 * `Renderer` and is given a `Scene` whenever something changes.
 */

import type { Camera, ScreenPoint, Viewport } from "./camera";
import type { OrientedRectangle, RectangleMode } from "./hit";
import { type PlacedSection, type SectionProjection, projectSection } from "./placement";
import type { Section, Stroke } from "./stroke";

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
  /** The rectangle being dragged to select, if any. */
  readonly band?: SelectionBand | null;
}

export interface Renderer {
  /** The size of the drawing area, in CSS pixels, has changed. */
  resize(viewport: Viewport): void;
  /** Draws the scene, replacing whatever was drawn before. */
  render(scene: Scene): void;
  /** Releases everything the renderer holds. It must not be used afterwards. */
  dispose(): void;
}

/** A placed section together with the transformation that puts it on the screen. */
export interface DrawableSection {
  readonly placed: PlacedSection;
  readonly projection: SectionProjection;
}

/**
 * How many levels deeper than a section the camera may be and still draw it. The old engine drew objects
 * up to 24 levels larger than the screen. In practice `DEFAULT_MAX_REACH_PIXELS` is what limits drawing.
 */
export const DEFAULT_MAX_LEVEL_GAP = 24;

/** Sections smaller than this on the screen, in pixels, are not worth drawing. */
export const DEFAULT_MIN_PIXELS = 0.5;

/**
 * How far, in pixels, a section may reach from the point it is placed on. The 2D canvas of a browser
 * computes with single precision floats, so a section that reaches millions of pixels away is drawn in the
 * wrong place. Measured in Chrome (docs/noyau.md): the error stays under 0.1 pixel up to about 6 million
 * pixels and is about 0.6 pixel at 10 million; this default keeps a margin.
 */
export const DEFAULT_MAX_REACH_PIXELS = 4e6;

export interface SelectionOptions {
  readonly maxLevelGap?: number;
  readonly minPixels?: number;
  readonly maxReachPixels?: number;
}

/** The box of a section's points, in its local units, and its largest thickness. */
export interface SectionExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly maxWidth: number;
}

// Sections are immutable, so their extent can be remembered for as long as the section object lives.
const extents = new WeakMap<Section, SectionExtent>();

export function sectionExtent(section: Section): SectionExtent {
  const known = extents.get(section);
  if (known !== undefined) return known;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxWidth = 0;
  for (const p of section.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.width > maxWidth) maxWidth = p.width;
  }
  const extent = { minX, maxX, minY, maxY, maxWidth };
  extents.set(section, extent);
  return extent;
}

/**
 * The sections to draw for this camera, in drawing order. A section is left out when it cannot be placed
 * (see `projectSection`), when the camera is too many levels deeper than it, when it reaches more than
 * `maxReachPixels` away from where it is placed (the canvas would draw it imprecisely), when it is smaller
 * than `minPixels` on the screen, or when it is entirely outside the screen. The stroke thickness counts: a thick
 * stroke whose points are just off the screen can still reach into it.
 */
export function selectDrawableSections(
  sections: readonly PlacedSection[],
  camera: Camera,
  viewport: Viewport,
  options: SelectionOptions = {},
): DrawableSection[] {
  const drawable: DrawableSection[] = [];
  for (const placed of sections) {
    const projection = drawableProjection(placed, camera, viewport, options);
    if (projection !== null) drawable.push({ placed, projection });
  }
  return drawable;
}

/** Where a placed section is drawn on the screen, or `null` when it is left out (see `selectDrawableSections`). */
export function drawableProjection(
  placed: PlacedSection,
  camera: Camera,
  viewport: Viewport,
  options: SelectionOptions = {},
): SectionProjection | null {
  const maxLevelGap = options.maxLevelGap ?? DEFAULT_MAX_LEVEL_GAP;
  const minPixels = options.minPixels ?? DEFAULT_MIN_PIXELS;
  const maxReachPixels = options.maxReachPixels ?? DEFAULT_MAX_REACH_PIXELS;

  if (camera.zLevel - placed.zLevel > maxLevelGap) return null;
  const projection = projectSection(placed, camera, viewport);
  if (projection === null) return null;

  const extent = sectionExtent(placed.section);
  const half = extent.maxWidth / 2;
  const { origin, scale, turn } = projection;
  const reach = Math.max(Math.abs(extent.minX), Math.abs(extent.maxX), Math.abs(extent.minY), Math.abs(extent.maxY)) + half;
  if (reach * scale > maxReachPixels) return null;
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
