/**
 * What a renderer draws, and the choice of which sections of a stroke are worth drawing.
 *
 * The engine does not know any drawing library. A renderer (fabric.js, a plain 2D canvas...) implements
 * `Renderer` and is given a `Scene` whenever something changes.
 */

import type { Camera, Viewport } from "./camera";
import { type Section, type SectionProjection, type Stroke, projectSection } from "./stroke";

export interface Scene {
  readonly camera: Camera;
  readonly viewport: Viewport;
  /** In drawing order: finished strokes first, then the stroke being drawn, if any. */
  readonly strokes: readonly Stroke[];
}

export interface Renderer {
  /** The size of the drawing area, in CSS pixels, has changed. */
  resize(viewport: Viewport): void;
  /** Draws the scene, replacing whatever was drawn before. */
  render(scene: Scene): void;
  /** Releases everything the renderer holds. It must not be used afterwards. */
  dispose(): void;
}

/** A section together with the transformation that places it on the screen. */
export interface DrawableSection {
  readonly section: Section;
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

interface Extent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly maxWidth: number;
}

// Sections are immutable, so their extent can be remembered for as long as the section object lives.
const extents = new WeakMap<Section, Extent>();

function extentOf(section: Section): Extent {
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
  strokes: readonly Stroke[],
  camera: Camera,
  viewport: Viewport,
  options: SelectionOptions = {},
): DrawableSection[] {
  const maxLevelGap = options.maxLevelGap ?? DEFAULT_MAX_LEVEL_GAP;
  const minPixels = options.minPixels ?? DEFAULT_MIN_PIXELS;
  const maxReachPixels = options.maxReachPixels ?? DEFAULT_MAX_REACH_PIXELS;
  const drawable: DrawableSection[] = [];

  for (const stroke of strokes) {
    for (const section of stroke.sections) {
      if (camera.zLevel - section.zLevel > maxLevelGap) continue;
      const projection = projectSection(section, camera, viewport);
      if (projection === null) continue;

      const extent = extentOf(section);
      const half = extent.maxWidth / 2;
      const { origin, scale } = projection;
      const reach = Math.max(Math.abs(extent.minX), Math.abs(extent.maxX), Math.abs(extent.minY), Math.abs(extent.maxY)) + half;
      if (reach * scale > maxReachPixels) continue;
      const left = origin.x + (extent.minX - half) * scale;
      const right = origin.x + (extent.maxX + half) * scale;
      const top = origin.y + (extent.minY - half) * scale;
      const bottom = origin.y + (extent.maxY + half) * scale;

      if (Math.max(right - left, bottom - top) < minPixels) continue;
      if (right < 0 || left > viewport.width || bottom < 0 || top > viewport.height) continue;
      drawable.push({ section, projection });
    }
  }
  return drawable;
}
