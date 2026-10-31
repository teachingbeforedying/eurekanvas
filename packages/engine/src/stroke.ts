/**
 * Strokes drawn while zooming, as a sequence of sections.
 *
 * A section is a stretch of the stroke drawn at one integer zoom level. It has an exact anchor (a world
 * point) and its points are small floats relative to that anchor, in local units of `2^-zLevel` world
 * units (about one screen pixel when the camera is at that level with a factor of 1).
 *
 * Each point also carries the thickness of the stroke at that point, in the same local units. The
 * thickness is chosen when the point is drawn so that it is constant on the screen at that moment;
 * seen from elsewhere, the stroke gets thinner as it goes deeper.
 *
 * Each time the camera's `zLevel` changes, a new section starts exactly where the previous one ended: the
 * last point of a section and the anchor of the next one are the very same exact point, with the same
 * thickness expressed in the new section's units.
 *
 * The exact position of a local point is DEFINED as `anchor + local * 2^-zLevel` (see `pointWorld`).
 */

import { add, dyadicFromString, dyadicToString, equals, fromNumber, shift, sub, toNumber } from "./dyadic";
import {
  type Camera,
  type Point,
  type ScreenPoint,
  type Turn,
  type Viewport,
  screenToWorld,
  turnOf,
  turned,
  worldToScreen,
} from "./camera";

/** A point of a section: an offset from the anchor and the stroke thickness there, in local units. */
export interface LocalPoint {
  readonly x: number;
  readonly y: number;
  /** Positive and finite. */
  readonly width: number;
}

export interface Section {
  readonly anchor: Point;
  /** Integer. The camera level at which this section was drawn. */
  readonly zLevel: number;
  /** Never empty. `points[0]` is always at offset `(0, 0)`: the anchor itself. */
  readonly points: readonly LocalPoint[];
}

export interface Stroke {
  readonly sections: readonly Section[];
}

/** The exact world position of point `index` of a section. */
export function pointWorld(section: Section, index: number): Point {
  const local = section.points[index];
  if (local === undefined) throw new RangeError(`the section has no point ${index}`);
  return {
    x: add(section.anchor.x, shift(fromNumber(local.x), -section.zLevel)),
    y: add(section.anchor.y, shift(fromNumber(local.y), -section.zLevel)),
  };
}

/** All the exact points of a stroke, in order. The junctions between sections appear only once. */
export function strokeWorldPoints(stroke: Stroke): Point[] {
  const points: Point[] = [];
  stroke.sections.forEach((section, sectionIndex) => {
    for (let i = sectionIndex === 0 ? 0 : 1; i < section.points.length; i++) points.push(pointWorld(section, i));
  });
  return points;
}

/**
 * A width expressed in the units of another level: local units are `2^-zLevel` world units, so moving
 * from level `from` to level `to` multiplies a width by `2^(to - from)`. Exact, unless it overflows.
 */
export function convertWidth(width: number, from: number, to: number): number {
  let result = width;
  let k = to - from;
  while (k > 1000) {
    result *= 2 ** 1000;
    k -= 1000;
  }
  while (k < -1000) {
    result *= 2 ** -1000;
    k += 1000;
  }
  result *= 2 ** k;
  if (!(Number.isFinite(result) && result > 0)) {
    throw new RangeError(`a width of ${width} cannot be expressed at a level ${to - from} away`);
  }
  return result;
}

function assertWidth(width: number): void {
  if (!(Number.isFinite(width) && width > 0)) throw new RangeError(`width must be positive and finite, got ${width}`);
}

function localOffset(point: Point, anchor: Point, zLevel: number): { x: number; y: number } {
  const x = toNumber(shift(sub(point.x, anchor.x), zLevel));
  const y = toNumber(shift(sub(point.y, anchor.y), zLevel));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("the point is too far from the anchor of its section to be stored as a number");
  }
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y }; // no -0
}

interface OpenSection {
  readonly anchor: Point;
  readonly zLevel: number;
  readonly points: LocalPoint[];
}

/**
 * Records a stroke point by point. It is a mutable object because a stroke grows while it is drawn:
 * copying an immutable array at every point would make drawing quadratic.
 */
export class StrokeRecorder {
  private readonly closed: Section[] = [];
  private open: OpenSection | null = null;

  /**
   * Adds a point given in world coordinates, drawn while the camera was at `zLevel`, with a stroke
   * thickness of `width` local units of that level.
   * A point at the same position as the previous one is ignored (pointer events often repeat, and zooming
   * without moving must not add anything), whatever its width.
   */
  addPoint(point: Point, zLevel: number, width = 1): void {
    if (!Number.isInteger(zLevel)) throw new RangeError(`zLevel must be an integer, got ${zLevel}`);
    assertWidth(width);

    const open = this.open;
    if (open === null) {
      this.open = { anchor: point, zLevel, points: [{ x: 0, y: 0, width }] };
      return;
    }

    if (open.zLevel === zLevel) {
      const offset = localOffset(point, open.anchor, zLevel);
      const last = open.points[open.points.length - 1] as LocalPoint;
      if (offset.x !== last.x || offset.y !== last.y) open.points.push({ ...offset, width });
      return;
    }

    // The level changed: the new section starts exactly where the previous one ended.
    const last = open.points[open.points.length - 1] as LocalPoint;
    const junction = pointWorld(open, open.points.length - 1);
    const offset = localOffset(point, junction, zLevel);
    if (offset.x === 0 && offset.y === 0) return; // still on the junction: wait for a real move
    const junctionWidth = convertWidth(last.width, open.zLevel, zLevel);
    this.closed.push(open);
    this.open = {
      anchor: junction,
      zLevel,
      points: [{ x: 0, y: 0, width: junctionWidth }, { ...offset, width }],
    };
  }

  /**
   * Adds a point given on the screen, using the camera as it is right now. `widthPixels` is the thickness
   * of the stroke on the screen at this moment.
   */
  addScreenPoint(camera: Camera, viewport: Viewport, p: ScreenPoint, widthPixels = 1): void {
    assertWidth(widthPixels);
    // a local unit is `camera.factor` pixels on the screen right now
    this.addPoint(screenToWorld(camera, viewport, p), camera.zLevel, widthPixels / camera.factor);
  }

  /** A snapshot of the stroke. It does not change when more points are added afterwards. */
  get stroke(): Stroke {
    const open = this.open;
    if (open === null) return { sections: [...this.closed] };
    return { sections: [...this.closed, { anchor: open.anchor, zLevel: open.zLevel, points: [...open.points] }] };
  }
}

/** Where the local points of a section appear on the screen: `origin + R · local * scale`, `R` being the camera's turn. */
export interface SectionProjection {
  readonly origin: ScreenPoint;
  readonly scale: number;
  readonly turn: Turn;
}

/**
 * The transformation that places a section on the screen, relative to the camera, as plain floats.
 * Returns `null` when it cannot be expressed that way (the origin is infinitely far, or the section is
 * more than about 1 000 levels away from the camera, so its scale is 0 or infinite).
 *
 * This is a float computation: when the camera is much deeper than the section, the origin is very far
 * from the screen and the result loses precision (see docs/noyau.md). The exact route for any point
 * is `worldToScreen(camera, viewport, pointWorld(section, i))`.
 */
export function projectSection(section: Section, camera: Camera, viewport: Viewport): SectionProjection | null {
  const origin = worldToScreen(camera, viewport, section.anchor);
  const scale = 2 ** (camera.zLevel - section.zLevel) * camera.factor;
  if (!(Number.isFinite(origin.x) && Number.isFinite(origin.y) && Number.isFinite(scale) && scale > 0)) return null;
  return { origin, scale, turn: turnOf(camera.angle) };
}

export function localToScreen(projection: SectionProjection, local: { readonly x: number; readonly y: number }): ScreenPoint {
  const offset = turned(projection.turn, local.x * projection.scale, local.y * projection.scale);
  return { x: projection.origin.x + offset.x, y: projection.origin.y + offset.y };
}

export const STROKE_FORMAT = "eurekanvas/stroke";
export const STROKE_FORMAT_VERSION = 1;

/** The plain-data form of a stroke, ready for `JSON.stringify`. Specified in docs/stroke-format.md. */
export interface StrokeJSON {
  readonly format: typeof STROKE_FORMAT;
  readonly version: typeof STROKE_FORMAT_VERSION;
  readonly sections: readonly {
    readonly anchor: { readonly x: string; readonly y: string };
    readonly zLevel: number;
    /** Each point is `[x, y, width]`. */
    readonly points: readonly (readonly [number, number, number])[];
  }[];
}

export function strokeToJSON(stroke: Stroke): StrokeJSON {
  return {
    format: STROKE_FORMAT,
    version: STROKE_FORMAT_VERSION,
    sections: stroke.sections.map((section) => ({
      anchor: { x: dyadicToString(section.anchor.x), y: dyadicToString(section.anchor.y) },
      zLevel: section.zLevel,
      points: section.points.map((p): readonly [number, number, number] => [p.x, p.y, p.width]),
    })),
  };
}

function fail(message: string): never {
  throw new SyntaxError(`invalid stroke: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSection(raw: unknown, index: number): Section {
  if (!isRecord(raw)) fail(`section ${index} must be an object`);
  const anchor = raw["anchor"];
  if (!isRecord(anchor) || typeof anchor["x"] !== "string" || typeof anchor["y"] !== "string") {
    fail(`section ${index} needs an anchor with text coordinates x and y`);
  }
  const zLevel = raw["zLevel"];
  if (typeof zLevel !== "number" || !Number.isInteger(zLevel)) fail(`section ${index} needs an integer zLevel`);
  const rawPoints = raw["points"];
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) fail(`section ${index} needs at least one point`);

  const points: LocalPoint[] = [];
  for (const [pointIndex, rawPoint] of (rawPoints as unknown[]).entries()) {
    if (!Array.isArray(rawPoint) || rawPoint.length !== 3) fail(`point ${pointIndex} of section ${index} must be [x, y, width]`);
    const [x, y, width] = rawPoint as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      fail(`point ${pointIndex} of section ${index} must have a finite x and y`);
    }
    if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
      fail(`point ${pointIndex} of section ${index} must have a positive, finite width`);
    }
    points.push({ x, y, width });
  }
  const first = points[0] as LocalPoint;
  if (first.x !== 0 || first.y !== 0) fail(`the first point of section ${index} must be at offset [0, 0]`);

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
  const rawSections = json["sections"];
  if (!Array.isArray(rawSections)) fail("sections must be an array");

  const sections = (rawSections as unknown[]).map((raw, index) => readSection(raw, index));
  for (let i = 1; i < sections.length; i++) {
    const previous = sections[i - 1] as Section;
    const current = sections[i] as Section;
    const lastIndex = previous.points.length - 1;
    const junction = pointWorld(previous, lastIndex);
    if (!equals(current.anchor.x, junction.x) || !equals(current.anchor.y, junction.y)) {
      fail(`the anchor of section ${i} must be the last point of section ${i - 1}`);
    }
    const lastWidth = (previous.points[lastIndex] as LocalPoint).width;
    let expectedWidth: number | null;
    try {
      expectedWidth = convertWidth(lastWidth, previous.zLevel, current.zLevel);
    } catch {
      expectedWidth = null;
    }
    if (expectedWidth === null || (current.points[0] as LocalPoint).width !== expectedWidth) {
      fail(`the first width of section ${i} must be the last width of section ${i - 1}, expressed at its level`);
    }
  }
  return { sections };
}
