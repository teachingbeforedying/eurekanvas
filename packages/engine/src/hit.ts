/**
 * Finding the objects of a drawing: the ones drawn under a point of the screen, and the ones in a rectangle of
 * the world.
 *
 * Under a point, only what is drawn counts, as the renderer draws it. A rectangle is compared with exact
 * positions instead, so it works at any depth, for objects too small or too far to be drawn as well.
 */

import { type Camera, type Point, type ScreenPoint, type Viewport, worldToScreen } from "./camera";
import { type Item, itemStrokes } from "./drawing";
import { type Dyadic, add, compare, fromNumber, shift, sub, toNumber } from "./dyadic";
import { type SelectionOptions, drawableProjection, sectionExtent } from "./render";
import type { LocalPoint, Section, SectionProjection } from "./stroke";

/** An exact rectangle of the world, with `minX <= maxX` and `minY <= maxY`. */
export interface WorldBounds {
  readonly minX: Dyadic;
  readonly minY: Dyadic;
  readonly maxX: Dyadic;
  readonly maxY: Dyadic;
}

/** A rectangle on the screen, in pixels. Its sides are infinite when they are too far away to be a `number`. */
export interface ScreenBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Which objects a rectangle takes, as in AutoCAD: `inside`, the objects entirely inside it (dragged from left
 * to right); `touching`, the objects it touches (dragged from right to left).
 */
export type RectangleMode = "inside" | "touching";

/**
 * Whether the ink of a section comes within `tolerance` of the point `(qx, qy)`, all in the section's local
 * units. The thickness at a point of a segment is taken as the linear blend of the thicknesses of its ends,
 * which is what the tapered capsules of the outline draw, to within a sliver.
 */
function nearInk(points: readonly LocalPoint[], qx: number, qy: number, tolerance: number): boolean {
  const first = points[0];
  if (first === undefined) return false;
  if (points.length === 1) return Math.hypot(qx - first.x, qy - first.y) <= first.width / 2 + tolerance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as LocalPoint;
    const b = points[i] as LocalPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((qx - a.x) * dx + (qy - a.y) * dy) / length2));
    const half = (a.width + (b.width - a.width) * t) / 2;
    if (Math.hypot(qx - (a.x + dx * t), qy - (a.y + dy * t)) <= half + tolerance) return true;
  }
  return false;
}

function sectionHit(section: Section, projection: SectionProjection, p: ScreenPoint, tolerancePixels: number): boolean {
  const { origin, scale } = projection;
  const qx = (p.x - origin.x) / scale;
  const qy = (p.y - origin.y) / scale;
  const tolerance = tolerancePixels / scale;
  const extent = sectionExtent(section);
  const reach = extent.maxWidth / 2 + tolerance;
  if (qx < extent.minX - reach || qx > extent.maxX + reach || qy < extent.minY - reach || qy > extent.maxY + reach) return false;
  return nearInk(section.points, qx, qy, tolerance);
}

/**
 * The objects drawn at `p` on the screen, or whose ink is at most `tolerance` pixels away, topmost first, as
 * indices into `items`. Only what is drawn counts: a section that `selectDrawableSections` leaves out (too
 * small, too far...) cannot be hit. A group is hit when one of its strokes is.
 */
export function itemsAt(
  items: readonly Item[],
  camera: Camera,
  viewport: Viewport,
  p: ScreenPoint,
  tolerance = 0,
  options: SelectionOptions = {},
): number[] {
  const hits: number[] = [];
  for (let index = items.length - 1; index >= 0; index--) {
    const strokes = itemStrokes(items[index] as Item);
    const hit = strokes.some((stroke) =>
      stroke.sections.some((section) => {
        const projection = drawableProjection(section, camera, viewport, options);
        return projection !== null && sectionHit(section, projection, p, tolerance);
      }),
    );
    if (hit) hits.push(index);
  }
  return hits;
}

/** The exact rectangle with these two opposite corners. */
export function boundsFromCorners(a: Point, b: Point): WorldBounds {
  const [minX, maxX] = compare(a.x, b.x) <= 0 ? [a.x, b.x] : [b.x, a.x];
  const [minY, maxY] = compare(a.y, b.y) <= 0 ? [a.y, b.y] : [b.y, a.y];
  return { minX, minY, maxX, maxY };
}

export function unionBounds(a: WorldBounds, b: WorldBounds): WorldBounds {
  return {
    minX: compare(a.minX, b.minX) <= 0 ? a.minX : b.minX,
    minY: compare(a.minY, b.minY) <= 0 ? a.minY : b.minY,
    maxX: compare(a.maxX, b.maxX) >= 0 ? a.maxX : b.maxX,
    maxY: compare(a.maxY, b.maxY) >= 0 ? a.maxY : b.maxY,
  };
}

function intersects(a: WorldBounds, b: WorldBounds): boolean {
  return compare(a.minX, b.maxX) <= 0 && compare(b.minX, a.maxX) <= 0 && compare(a.minY, b.maxY) <= 0 && compare(b.minY, a.maxY) <= 0;
}

function contains(outer: WorldBounds, inner: WorldBounds): boolean {
  return (
    compare(outer.minX, inner.minX) <= 0 &&
    compare(inner.maxX, outer.maxX) <= 0 &&
    compare(outer.minY, inner.minY) <= 0 &&
    compare(inner.maxY, outer.maxY) <= 0
  );
}

// Sections and objects are immutable, so their bounds can be remembered for as long as they live.
const sectionBoxes = new WeakMap<Section, WorldBounds>();
const itemBoxes = new WeakMap<Item, WorldBounds | null>();

/** The exact box of a section's ink: the box of its points, widened by half its largest thickness. */
function sectionBounds(section: Section): WorldBounds {
  const known = sectionBoxes.get(section);
  if (known !== undefined) return known;
  const extent = sectionExtent(section);
  const half = fromNumber(extent.maxWidth / 2);
  const world = (anchor: Dyadic, local: Dyadic): Dyadic => add(anchor, shift(local, -section.zLevel));
  const { x, y } = section.anchor;
  const bounds = {
    minX: world(x, sub(fromNumber(extent.minX), half)),
    minY: world(y, sub(fromNumber(extent.minY), half)),
    maxX: world(x, add(fromNumber(extent.maxX), half)),
    maxY: world(y, add(fromNumber(extent.maxY), half)),
  };
  sectionBoxes.set(section, bounds);
  return bounds;
}

/** The exact box of an object's ink, at whatever depth its strokes are; `null` for an object without any section. */
export function itemBounds(item: Item): WorldBounds | null {
  const known = itemBoxes.get(item);
  if (known !== undefined) return known;
  let bounds: WorldBounds | null = null;
  for (const stroke of itemStrokes(item)) {
    for (const section of stroke.sections) {
      const box = sectionBounds(section);
      bounds = bounds === null ? box : unionBounds(bounds, box);
    }
  }
  itemBoxes.set(item, bounds);
  return bounds;
}

/** The exact box around several objects; `null` when there is none (or none has a section). */
export function boundsOf(items: Iterable<Item>): WorldBounds | null {
  let bounds: WorldBounds | null = null;
  for (const item of items) {
    const box = itemBounds(item);
    if (box !== null) bounds = bounds === null ? box : unionBounds(bounds, box);
  }
  return bounds;
}

/** Where an exact rectangle of the world appears on the screen. */
export function boundsToScreen(camera: Camera, viewport: Viewport, bounds: WorldBounds): ScreenBounds {
  const topLeft = worldToScreen(camera, viewport, { x: bounds.minX, y: bounds.minY });
  const bottomRight = worldToScreen(camera, viewport, { x: bounds.maxX, y: bounds.maxY });
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
}

/** Whether the segment from `a` to `b` meets the box (Liang-Barsky clipping). */
function segmentMeetsBox(a: LocalPoint, b: LocalPoint, left: number, top: number, right: number, bottom: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  // keeps the part of the segment where `p * t <= q`
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x - left) && clip(dx, right - a.x) && clip(-dy, a.y - top) && clip(dy, bottom - a.y);
}

/**
 * Whether the ink of a section touches an exact rectangle. When the rectangle only crosses the box of the
 * section, its sides are brought into the section's local units and compared with each segment, widened by
 * half its thickness (as a square: near a corner of the rectangle, up to 0.4 thickness too generous).
 */
function sectionTouches(section: Section, rectangle: WorldBounds): boolean {
  const bounds = sectionBounds(section);
  if (!intersects(rectangle, bounds)) return false;
  if (contains(rectangle, bounds)) return true;

  // A side far beyond the section is on the same side of all its points: it is brought closer, so that it fits in a `number`.
  const extent = sectionExtent(section);
  const margin = extent.maxWidth + 1;
  const local = (world: Dyadic, anchor: Dyadic, low: number, high: number): number =>
    Math.min(high + margin, Math.max(low - margin, toNumber(shift(sub(world, anchor), section.zLevel))));
  const left = local(rectangle.minX, section.anchor.x, extent.minX, extent.maxX);
  const right = local(rectangle.maxX, section.anchor.x, extent.minX, extent.maxX);
  const top = local(rectangle.minY, section.anchor.y, extent.minY, extent.maxY);
  const bottom = local(rectangle.maxY, section.anchor.y, extent.minY, extent.maxY);

  const points = section.points;
  const first = points[0];
  if (first === undefined) return false;
  if (points.length === 1) {
    const half = first.width / 2;
    return first.x >= left - half && first.x <= right + half && first.y >= top - half && first.y <= bottom + half;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as LocalPoint;
    const b = points[i] as LocalPoint;
    const half = Math.max(a.width, b.width) / 2;
    if (segmentMeetsBox(a, b, left - half, top - half, right + half, bottom + half)) return true;
  }
  return false;
}

/**
 * The objects that an exact rectangle of the world takes (see `RectangleMode`), in drawing order, as indices
 * into `items`. Exact at any depth, and for every object, drawn or not.
 */
export function itemsInRectangle(items: readonly Item[], rectangle: WorldBounds, mode: RectangleMode): number[] {
  const taken: number[] = [];
  items.forEach((item, index) => {
    if (mode === "inside") {
      const bounds = itemBounds(item);
      if (bounds !== null && contains(rectangle, bounds)) taken.push(index);
    } else if (itemStrokes(item).some((stroke) => stroke.sections.some((section) => sectionTouches(section, rectangle)))) {
      taken.push(index);
    }
  });
  return taken;
}
