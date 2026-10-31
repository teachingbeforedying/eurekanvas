/**
 * Finding the objects of a drawing: the ones drawn under a point of the screen, and the ones in a rectangle of
 * the world.
 *
 * Under a point, only what is drawn counts, as the renderer draws it. A rectangle is compared with exact
 * positions instead, so it works at any depth, for objects too small or too far to be drawn as well. Its sides
 * may follow a turned view (see `OrientedRectangle`).
 */

import { type Camera, ORIGIN, type Point, type ScreenPoint, type Turn, type Viewport, turnOf, turned, unturned } from "./camera";
import { type Item, itemStrokes } from "./drawing";
import { type Dyadic, add, compare, fromNumber, mul, shift, sub, toNumber } from "./dyadic";
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
 * A rectangle whose sides follow the axes of a view turned by `angle` degrees: a world point `w` is in it when its
 * view coordinates `R(angle) · (w - origin)`, computed exactly, are in `bounds`. A rectangle dragged on the screen
 * is one, with the camera's center and angle. With an angle of 0, it is the plain rectangle `origin + bounds`.
 */
export interface OrientedRectangle {
  readonly origin: Point;
  readonly angle: number;
  readonly bounds: WorldBounds;
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
  const { origin, scale, turn } = projection;
  const back = unturned(turn, p.x - origin.x, p.y - origin.y);
  const qx = back.x / scale;
  const qy = back.y / scale;
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

/** `R · (point - origin)`, exactly: the cosine and the sine are numbers, so dyadics too. */
function viewCoordinates(point: Point, origin: Point, turn: Turn): Point {
  const dx = sub(point.x, origin.x);
  const dy = sub(point.y, origin.y);
  const cos = fromNumber(turn.cos);
  const sin = fromNumber(turn.sin);
  return { x: sub(mul(cos, dx), mul(sin, dy)), y: add(mul(sin, dx), mul(cos, dy)) };
}

/** The rectangle of a view turned by `angle` around `origin` with these two opposite corners, given as world points. */
export function orientedRectangle(a: Point, b: Point, origin: Point, angle: number): OrientedRectangle {
  const turn = turnOf(angle);
  return { origin, angle, bounds: boundsFromCorners(viewCoordinates(a, origin, turn), viewCoordinates(b, origin, turn)) };
}

/** A plain rectangle of the world, as an `OrientedRectangle` with an angle of 0. */
export function worldRectangle(bounds: WorldBounds): OrientedRectangle {
  return { origin: ORIGIN, angle: 0, bounds };
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

/**
 * Where an exact rectangle of the world lies before the view's turn: in pixels from the middle of the screen,
 * along the axes of the world. On the screen, it is this box turned by the camera's angle around the middle.
 */
export function viewBounds(camera: Camera, bounds: WorldBounds): ScreenBounds {
  const pixels = (value: Dyadic, center: Dyadic): number => toNumber(shift(sub(value, center), camera.zLevel)) * camera.factor;
  return {
    left: pixels(bounds.minX, camera.center.x),
    top: pixels(bounds.minY, camera.center.y),
    right: pixels(bounds.maxX, camera.center.x),
    bottom: pixels(bounds.maxY, camera.center.y),
  };
}

/** Whether the segment from `a` to `b` meets the box (Liang-Barsky clipping). */
function segmentMeetsBox(a: ScreenPoint, b: ScreenPoint, box: ScreenBounds): boolean {
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
  return clip(-dx, a.x - box.left) && clip(dx, box.right - a.x) && clip(-dy, a.y - box.top) && clip(dy, box.bottom - a.y);
}

function widened(box: ScreenBounds, by: number): ScreenBounds {
  return { left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by };
}

/** Where the box of a section's ink is, against a rectangle: compared exactly, in the rectangle's view coordinates. */
function placeOf(section: Section, rectangle: OrientedRectangle, turn: Turn): "outside" | "inside" | "crossing" {
  const box = sectionBounds(section);
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.maxY },
  ].map((corner) => viewCoordinates(corner, rectangle.origin, turn));
  // the box around the turned box: it is inside the rectangle exactly when its four corners are
  const around = corners.slice(1).reduce((bounds, corner) => unionBounds(bounds, boundsFromCorners(corner, corner)), boundsFromCorners(corners[0] as Point, corners[0] as Point));
  if (!intersects(rectangle.bounds, around)) return "outside";
  return contains(rectangle.bounds, around) ? "inside" : "crossing";
}

/**
 * The rectangle in the section's local units, along the axes of the rectangle: the section's points are then
 * `R · local`. A side far beyond the section is on the same side of all its points: it is brought closer, so
 * that it fits in a `number`.
 */
function localRectangle(section: Section, rectangle: OrientedRectangle, turn: Turn): ScreenBounds {
  const extent = sectionExtent(section);
  const limit = 2 * Math.max(Math.abs(extent.minX), Math.abs(extent.maxX), Math.abs(extent.minY), Math.abs(extent.maxY)) + extent.maxWidth + 1;
  const anchor = viewCoordinates(section.anchor, rectangle.origin, turn);
  const local = (side: Dyadic, from: Dyadic): number =>
    Math.min(limit, Math.max(-limit, toNumber(shift(sub(side, from), section.zLevel))));
  const { bounds } = rectangle;
  return {
    left: local(bounds.minX, anchor.x),
    top: local(bounds.minY, anchor.y),
    right: local(bounds.maxX, anchor.x),
    bottom: local(bounds.maxY, anchor.y),
  };
}

/**
 * Whether the ink of a section touches a rectangle. When the rectangle only crosses the box of the section, each
 * segment is compared with the rectangle widened by half its thickness (as a square: near a corner of the
 * rectangle, up to 0.4 thickness too generous).
 */
function sectionTouches(section: Section, rectangle: OrientedRectangle, turn: Turn): boolean {
  const place = placeOf(section, rectangle, turn);
  if (place !== "crossing") return place === "inside";
  const box = localRectangle(section, rectangle, turn);
  const points = section.points.map((p) => ({ ...turned(turn, p.x, p.y), width: p.width }));
  const first = points[0];
  if (first === undefined) return false;
  if (points.length === 1) return segmentMeetsBox(first, first, widened(box, first.width / 2));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as LocalPoint;
    const b = points[i] as LocalPoint;
    if (segmentMeetsBox(a, b, widened(box, Math.max(a.width, b.width) / 2))) return true;
  }
  return false;
}

/** Whether the ink of a section is entirely inside a rectangle: each of its round ends is. */
function sectionInside(section: Section, rectangle: OrientedRectangle, turn: Turn): boolean {
  const place = placeOf(section, rectangle, turn);
  if (place !== "crossing") return place === "inside";
  const box = localRectangle(section, rectangle, turn);
  return section.points.every((p) => {
    const q = turned(turn, p.x, p.y);
    const half = p.width / 2;
    return q.x - half >= box.left && q.x + half <= box.right && q.y - half >= box.top && q.y + half <= box.bottom;
  });
}

/**
 * The objects that a rectangle takes (see `RectangleMode`), in drawing order, as indices into `items`. Exact at
 * any depth, and for every object, drawn or not.
 */
export function itemsInRectangle(items: readonly Item[], rectangle: OrientedRectangle, mode: RectangleMode): number[] {
  const turn = turnOf(rectangle.angle);
  const taken: number[] = [];
  items.forEach((item, index) => {
    const sections = itemStrokes(item).flatMap((stroke) => stroke.sections);
    const take =
      mode === "inside"
        ? sections.length > 0 && sections.every((section) => sectionInside(section, rectangle, turn))
        : sections.some((section) => sectionTouches(section, rectangle, turn));
    if (take) taken.push(index);
  });
  return taken;
}
