/**
 * Finding the objects of a drawing: the ones drawn under a point of the screen, and the ones in a rectangle of
 * the world. Also the frames drawn around a selection.
 *
 * Under a point, only what is drawn counts, as the renderer draws it. A rectangle is compared with exact
 * positions instead, so it works at any depth, for objects too small or too far to be drawn as well. Its sides
 * may follow a turned view (see `OrientedRectangle`). Objects are where their transforms put them.
 */

import {
  type Camera,
  ORIGIN,
  type Point,
  type ScreenPoint,
  type Turn,
  type Viewport,
  normalizeAngle,
  turnOf,
  turned,
  unturned,
  worldToScreen,
} from "./camera";
import { type Item, withTransform } from "./drawing";
import { type Dyadic, add, compare, fromNumber, mul, neg, shift, sub, toNumber } from "./dyadic";
import { type PlacedSection, type SectionProjection, placedSections } from "./placement";
import { type SelectionOptions, drawableProjection, sectionExtent } from "./render";
import type { LocalPoint } from "./stroke";
import { turnedExactly } from "./transform";

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
 * A rectangle whose sides follow axes turned by `-angle` degrees: a world point `w` is in it when its coordinates
 * `R(angle) · (w - origin)`, computed exactly, are in `bounds`. A rectangle dragged on the screen is one, with the
 * camera's center and angle (its sides follow the screen); so is the frame of an object turned by `-angle`. With
 * an angle of 0, it is the plain rectangle `origin + bounds`.
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

/** A placed section's local point in turned, mirrored axes: `R · M · local`. */
function placedLocal(turn: Turn, mirror: boolean, p: { readonly x: number; readonly y: number }): ScreenPoint {
  return turned(turn, p.x, mirror ? -p.y : p.y);
}

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

function sectionHit(placed: PlacedSection, projection: SectionProjection, p: ScreenPoint, tolerancePixels: number): boolean {
  const { origin, scale, turn, mirror } = projection;
  const back = unturned(turn, p.x - origin.x, p.y - origin.y);
  const qx = back.x / scale;
  const qy = (mirror ? -back.y : back.y) / scale;
  const tolerance = tolerancePixels / scale;
  const extent = sectionExtent(placed.section);
  const reach = extent.maxWidth / 2 + tolerance;
  if (qx < extent.minX - reach || qx > extent.maxX + reach || qy < extent.minY - reach || qy > extent.maxY + reach) return false;
  return nearInk(placed.section.points, qx, qy, tolerance);
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
    const hit = placedSections(items[index] as Item).some((placed) => {
      const projection = drawableProjection(placed, camera, viewport, options);
      return projection !== null && sectionHit(placed, projection, p, tolerance);
    });
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

function boundsAround(points: readonly Point[]): WorldBounds {
  const first = points[0] as Point;
  return points.slice(1).reduce((bounds, p) => unionBounds(bounds, boundsFromCorners(p, p)), boundsFromCorners(first, first));
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

/** The center of a rectangle, as an exact world point. */
export function rectangleCenter(rectangle: OrientedRectangle): Point {
  const { bounds, origin } = rectangle;
  const middle = turnedExactly(
    turnOf(-rectangle.angle),
    0,
    1,
    shift(add(bounds.minX, bounds.maxX), -1),
    shift(add(bounds.minY, bounds.maxY), -1),
  );
  return { x: add(origin.x, middle.x), y: add(origin.y, middle.y) };
}

// Placed sections and objects are immutable, so their corners and bounds can be remembered for as long as they live.
const cornersOf = new WeakMap<PlacedSection, readonly Point[]>();
const boundsOfPlaced = new WeakMap<PlacedSection, WorldBounds>();
const itemBoxes = new WeakMap<Item, WorldBounds | null>();

/** The four exact corners of the box of a placed section's ink: the box of its points, widened by half its largest thickness. */
function placedCorners(placed: PlacedSection): readonly Point[] {
  const known = cornersOf.get(placed);
  if (known !== undefined) return known;
  const extent = sectionExtent(placed.section);
  const half = extent.maxWidth / 2;
  const turn = turnOf(placed.angle);
  const corner = (lx: number, ly: number): Point => {
    const offset = turnedExactly(turn, -placed.zLevel, placed.factor, fromNumber(lx), fromNumber(placed.mirror ? -ly : ly));
    return { x: add(placed.anchor.x, offset.x), y: add(placed.anchor.y, offset.y) };
  };
  const [x0, x1, y0, y1] = [extent.minX - half, extent.maxX + half, extent.minY - half, extent.maxY + half];
  const corners = [corner(x0, y0), corner(x1, y0), corner(x0, y1), corner(x1, y1)];
  cornersOf.set(placed, corners);
  return corners;
}

/** The exact box around a placed section's ink. */
function placedBounds(placed: PlacedSection): WorldBounds {
  const known = boundsOfPlaced.get(placed);
  if (known !== undefined) return known;
  const bounds = boundsAround(placedCorners(placed));
  boundsOfPlaced.set(placed, bounds);
  return bounds;
}

/** The exact box of an object's ink where its transforms put it, at whatever depth; `null` for an object without any section. */
export function itemBounds(item: Item): WorldBounds | null {
  const known = itemBoxes.get(item);
  if (known !== undefined) return known;
  let bounds: WorldBounds | null = null;
  for (const placed of placedSections(item)) {
    const box = placedBounds(placed);
    bounds = bounds === null ? box : unionBounds(bounds, box);
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
 * The frame of an object: the box of what it contains along its own axes, placed by its transform; along the
 * world's axes when it has no transform. Exact: a similarity turns a box into a box.
 */
export function itemFrame(item: Item): OrientedRectangle | null {
  const t = item.transform;
  if (t === undefined) {
    const bounds = itemBounds(item);
    return bounds === null ? null : worldRectangle(bounds);
  }
  const inner = itemBounds(withTransform(item, undefined));
  if (inner === null) return null;
  // R(-angle) · (T(p) - position) = scale · M · (p - origin)
  const scaled = (d: Dyadic): Dyadic => shift(mul(fromNumber(t.factor), d), t.zLevel);
  const minX = scaled(sub(inner.minX, t.origin.x));
  const maxX = scaled(sub(inner.maxX, t.origin.x));
  const top = scaled(sub(inner.minY, t.origin.y));
  const bottom = scaled(sub(inner.maxY, t.origin.y));
  const [minY, maxY] = t.mirror ? [neg(bottom), neg(top)] : [top, bottom];
  return { origin: t.position, angle: normalizeAngle(-t.angle), bounds: { minX, minY, maxX, maxY } };
}

/** The frame of a selection: the frame of its object when there is one, otherwise the box around them all along the world's axes. */
export function selectionFrame(items: readonly Item[]): OrientedRectangle | null {
  if (items.length === 1) return itemFrame(items[0] as Item);
  const bounds = boundsOf(items);
  return bounds === null ? null : worldRectangle(bounds);
}

/** Where a rectangle appears on the screen: its center, its size in pixels along its sides, and the angle of its sides. */
export interface RectangleOnScreen {
  readonly center: ScreenPoint;
  readonly width: number;
  readonly height: number;
  /** Degrees, in [0, 360), clockwise. */
  readonly angle: number;
}

export function rectangleOnScreen(camera: Camera, viewport: Viewport, rectangle: OrientedRectangle): RectangleOnScreen {
  const pixels = (length: Dyadic): number => toNumber(shift(length, camera.zLevel)) * camera.factor;
  const { bounds } = rectangle;
  return {
    center: worldToScreen(camera, viewport, rectangleCenter(rectangle)),
    width: pixels(sub(bounds.maxX, bounds.minX)),
    height: pixels(sub(bounds.maxY, bounds.minY)),
    angle: normalizeAngle(camera.angle - rectangle.angle),
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

/** Where the box of a placed section's ink is, against a rectangle: compared exactly, in the rectangle's coordinates. */
function placeOf(placed: PlacedSection, rectangle: OrientedRectangle, turn: Turn): "outside" | "inside" | "crossing" {
  // the box around the section's box, in the rectangle's coordinates: it is inside the rectangle exactly when its four corners are
  const around = boundsAround(placedCorners(placed).map((corner) => viewCoordinates(corner, rectangle.origin, turn)));
  if (!intersects(rectangle.bounds, around)) return "outside";
  return contains(rectangle.bounds, around) ? "inside" : "crossing";
}

/**
 * The rectangle in the section's local units, along the axes of the rectangle: the section's points are then
 * `R · M · local`. A side far beyond the section is on the same side of all its points: it is brought closer, so
 * that it fits in a `number`.
 */
function localRectangle(placed: PlacedSection, rectangle: OrientedRectangle, turn: Turn): ScreenBounds {
  const extent = sectionExtent(placed.section);
  const limit = 2 * Math.max(Math.abs(extent.minX), Math.abs(extent.maxX), Math.abs(extent.minY), Math.abs(extent.maxY)) + extent.maxWidth + 1;
  const anchor = viewCoordinates(placed.anchor, rectangle.origin, turn);
  const local = (side: Dyadic, from: Dyadic): number =>
    Math.min(limit, Math.max(-limit, toNumber(shift(sub(side, from), placed.zLevel)) / placed.factor));
  const { bounds } = rectangle;
  return {
    left: local(bounds.minX, anchor.x),
    top: local(bounds.minY, anchor.y),
    right: local(bounds.maxX, anchor.x),
    bottom: local(bounds.maxY, anchor.y),
  };
}

/**
 * Whether the ink of a placed section touches a rectangle. When the rectangle only crosses the box of the section,
 * each segment is compared with the rectangle widened by half its thickness (as a square: near a corner of the
 * rectangle, up to 0.4 thickness too generous).
 */
function sectionTouches(placed: PlacedSection, rectangle: OrientedRectangle, turn: Turn): boolean {
  const place = placeOf(placed, rectangle, turn);
  if (place !== "crossing") return place === "inside";
  const box = localRectangle(placed, rectangle, turn);
  const along = turnOf(rectangle.angle + placed.angle);
  const points = placed.section.points.map((p) => ({ ...placedLocal(along, placed.mirror, p), width: p.width }));
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

/** Whether the ink of a placed section is entirely inside a rectangle: each of its round ends is. */
function sectionInside(placed: PlacedSection, rectangle: OrientedRectangle, turn: Turn): boolean {
  const place = placeOf(placed, rectangle, turn);
  if (place !== "crossing") return place === "inside";
  const box = localRectangle(placed, rectangle, turn);
  const along = turnOf(rectangle.angle + placed.angle);
  return placed.section.points.every((p) => {
    const q = placedLocal(along, placed.mirror, p);
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
    const sections = placedSections(item);
    const take =
      mode === "inside"
        ? sections.length > 0 && sections.every((placed) => sectionInside(placed, rectangle, turn))
        : sections.some((placed) => sectionTouches(placed, rectangle, turn));
    if (take) taken.push(index);
  });
  return taken;
}
