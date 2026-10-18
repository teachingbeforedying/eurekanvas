/**
 * Strokes drawn while zooming, as a sequence of "bouts".
 *
 * A bout is a stretch of the stroke drawn at one integer zoom level. It has an exact anchor (a world
 * point) and its points are small floats relative to that anchor, in local units of `2^-zLevel` world
 * units (about one screen pixel when the camera is at that level with a factor of 1).
 *
 * Each time the camera's `zLevel` changes, a new bout starts exactly where the previous one ended: the
 * last point of a bout and the anchor of the next one are the very same exact point.
 *
 * The exact position of a local point is DEFINED as `anchor + local * 2^-zLevel` (see `pointWorld`).
 */

import { add, dyadicFromString, dyadicToString, equals, fromNumber, shift, sub, toNumber } from "./dyadic";
import { type Camera, type Point, type ScreenPoint, type Viewport, screenToWorld, worldToScreen } from "./camera";

/** An offset from the anchor of a bout, in local units (world offset * 2^zLevel). */
export interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

export interface Bout {
  readonly anchor: Point;
  /** Integer. The camera level at which this bout was drawn. */
  readonly zLevel: number;
  /** Never empty. `points[0]` is always `(0, 0)`: the anchor itself. */
  readonly points: readonly LocalPoint[];
}

export interface Stroke {
  readonly bouts: readonly Bout[];
}

const LOCAL_ORIGIN: LocalPoint = Object.freeze({ x: 0, y: 0 });

/** The exact world position of point `index` of a bout. */
export function pointWorld(bout: Bout, index: number): Point {
  const local = bout.points[index];
  if (local === undefined) throw new RangeError(`the bout has no point ${index}`);
  return {
    x: add(bout.anchor.x, shift(fromNumber(local.x), -bout.zLevel)),
    y: add(bout.anchor.y, shift(fromNumber(local.y), -bout.zLevel)),
  };
}

/** All the exact points of a stroke, in order. The junctions between bouts appear only once. */
export function strokeWorldPoints(stroke: Stroke): Point[] {
  const points: Point[] = [];
  stroke.bouts.forEach((bout, boutIndex) => {
    for (let i = boutIndex === 0 ? 0 : 1; i < bout.points.length; i++) points.push(pointWorld(bout, i));
  });
  return points;
}

function localOffset(point: Point, anchor: Point, zLevel: number): LocalPoint {
  const x = toNumber(shift(sub(point.x, anchor.x), zLevel));
  const y = toNumber(shift(sub(point.y, anchor.y), zLevel));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("the point is too far from the anchor of its bout to be stored as a number");
  }
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y }; // no -0
}

interface OpenBout {
  readonly anchor: Point;
  readonly zLevel: number;
  readonly points: LocalPoint[];
}

/**
 * Records a stroke point by point. It is a mutable object because a stroke grows while it is drawn:
 * copying an immutable array at every point would make drawing quadratic.
 */
export class StrokeRecorder {
  private readonly closed: Bout[] = [];
  private open: OpenBout | null = null;

  /**
   * Adds a point given in world coordinates, drawn while the camera was at `zLevel`.
   * A point identical to the previous one is ignored (pointer events often repeat).
   */
  addPoint(point: Point, zLevel: number): void {
    if (!Number.isInteger(zLevel)) throw new RangeError(`zLevel must be an integer, got ${zLevel}`);

    const open = this.open;
    if (open === null) {
      this.open = { anchor: point, zLevel, points: [LOCAL_ORIGIN] };
      return;
    }

    if (open.zLevel === zLevel) {
      const local = localOffset(point, open.anchor, zLevel);
      const last = open.points[open.points.length - 1] as LocalPoint;
      if (local.x !== last.x || local.y !== last.y) open.points.push(local);
      return;
    }

    // The level changed: the new bout starts exactly where the previous one ended.
    const junction = pointWorld(open, open.points.length - 1);
    const local = localOffset(point, junction, zLevel);
    if (local.x === 0 && local.y === 0) return; // still on the junction: wait for a real move
    this.closed.push(open);
    this.open = { anchor: junction, zLevel, points: [LOCAL_ORIGIN, local] };
  }

  /** Adds a point given on the screen, using the camera as it is right now. */
  addScreenPoint(camera: Camera, viewport: Viewport, p: ScreenPoint): void {
    this.addPoint(screenToWorld(camera, viewport, p), camera.zLevel);
  }

  /** A snapshot of the stroke. It does not change when more points are added afterwards. */
  get stroke(): Stroke {
    const open = this.open;
    if (open === null) return { bouts: [...this.closed] };
    return { bouts: [...this.closed, { anchor: open.anchor, zLevel: open.zLevel, points: [...open.points] }] };
  }
}

/** Where the local points of a bout appear on the screen: `origin + local * scale`. */
export interface BoutProjection {
  readonly origin: ScreenPoint;
  readonly scale: number;
}

/**
 * The transformation that places a bout on the screen, relative to the camera, as plain floats.
 * Returns `null` when it cannot be expressed that way (the origin is infinitely far, or the bout is
 * more than about 1 000 levels away from the camera, so its scale is 0 or infinite).
 *
 * This is a float computation: when the camera is much deeper than the bout, the origin is very far
 * from the screen and the result loses precision (see docs/noyau.md). The exact route for any point
 * is `worldToScreen(camera, viewport, pointWorld(bout, i))`.
 */
export function projectBout(bout: Bout, camera: Camera, viewport: Viewport): BoutProjection | null {
  const origin = worldToScreen(camera, viewport, bout.anchor);
  const scale = 2 ** (camera.zLevel - bout.zLevel) * camera.factor;
  if (!(Number.isFinite(origin.x) && Number.isFinite(origin.y) && Number.isFinite(scale) && scale > 0)) return null;
  return { origin, scale };
}

export function localToScreen(projection: BoutProjection, local: LocalPoint): ScreenPoint {
  return {
    x: projection.origin.x + local.x * projection.scale,
    y: projection.origin.y + local.y * projection.scale,
  };
}

export const STROKE_FORMAT = "eurekanvas/stroke";
export const STROKE_FORMAT_VERSION = 1;

/** The plain-data form of a stroke, ready for `JSON.stringify`. Specified in docs/format-trait.md. */
export interface StrokeJSON {
  readonly format: typeof STROKE_FORMAT;
  readonly version: typeof STROKE_FORMAT_VERSION;
  readonly bouts: readonly {
    readonly anchor: { readonly x: string; readonly y: string };
    readonly zLevel: number;
    readonly points: readonly (readonly [number, number])[];
  }[];
}

export function strokeToJSON(stroke: Stroke): StrokeJSON {
  return {
    format: STROKE_FORMAT,
    version: STROKE_FORMAT_VERSION,
    bouts: stroke.bouts.map((bout) => ({
      anchor: { x: dyadicToString(bout.anchor.x), y: dyadicToString(bout.anchor.y) },
      zLevel: bout.zLevel,
      points: bout.points.map((p): readonly [number, number] => [p.x, p.y]),
    })),
  };
}

function fail(message: string): never {
  throw new SyntaxError(`invalid stroke: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBout(raw: unknown, index: number): Bout {
  if (!isRecord(raw)) fail(`bout ${index} must be an object`);
  const anchor = raw["anchor"];
  if (!isRecord(anchor) || typeof anchor["x"] !== "string" || typeof anchor["y"] !== "string") {
    fail(`bout ${index} needs an anchor with text coordinates x and y`);
  }
  const zLevel = raw["zLevel"];
  if (typeof zLevel !== "number" || !Number.isInteger(zLevel)) fail(`bout ${index} needs an integer zLevel`);
  const rawPoints = raw["points"];
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) fail(`bout ${index} needs at least one point`);

  const points: LocalPoint[] = [];
  for (const [pointIndex, rawPoint] of (rawPoints as unknown[]).entries()) {
    if (!Array.isArray(rawPoint) || rawPoint.length !== 2) fail(`point ${pointIndex} of bout ${index} must be [x, y]`);
    const [x, y] = rawPoint as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      fail(`point ${pointIndex} of bout ${index} must contain finite numbers`);
    }
    points.push({ x, y });
  }
  const first = points[0] as LocalPoint;
  if (first.x !== 0 || first.y !== 0) fail(`the first point of bout ${index} must be [0, 0]`);

  return { anchor: { x: dyadicFromString(anchor["x"]), y: dyadicFromString(anchor["y"]) }, zLevel, points };
}

/**
 * Reads the plain-data form (for instance the result of `JSON.parse`). Strict: anything that does not
 * match the format throws a `SyntaxError`. Unknown extra fields are ignored.
 */
export function strokeFromJSON(json: unknown): Stroke {
  if (!isRecord(json)) fail("expected an object");
  if (json["format"] !== STROKE_FORMAT) fail(`format must be "${STROKE_FORMAT}"`);
  if (json["version"] !== STROKE_FORMAT_VERSION) fail(`unsupported version ${String(json["version"])}`);
  const rawBouts = json["bouts"];
  if (!Array.isArray(rawBouts)) fail("bouts must be an array");

  const bouts = (rawBouts as unknown[]).map((raw, index) => readBout(raw, index));
  for (let i = 1; i < bouts.length; i++) {
    const previous = bouts[i - 1] as Bout;
    const junction = pointWorld(previous, previous.points.length - 1);
    const anchor = (bouts[i] as Bout).anchor;
    if (!equals(anchor.x, junction.x) || !equals(anchor.y, junction.y)) {
      fail(`the anchor of bout ${i} must be the last point of bout ${i - 1}`);
    }
  }
  return { bouts };
}
