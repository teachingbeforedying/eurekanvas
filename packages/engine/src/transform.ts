/**
 * Where an object is placed: a similarity applied to the coordinates it was drawn with.
 *
 *     T(p) = position + 2^zLevel · factor · R(angle) · M · (p − origin)
 *
 * - `origin` is an exact point of the coordinates the object was drawn with: the pivot. `position` is the exact
 *   world point where it lands. Only the difference `p − origin` is turned and scaled, so the precision is
 *   relative to the size of the object, at any depth, whatever the angle.
 * - The scale is written like the camera's, `2^zLevel · factor` with `factor` in [1, 2), so that it stays finite
 *   at any depth.
 * - `angle` is in degrees, in [0, 360), clockwise on the screen like the camera's; quarter turns are exact.
 * - `M` is the mirror: `(x, y) → (x, −y)` when `mirror` is true, applied before the turn.
 *
 * Every product of an exact difference by a cosine, a sine or a factor is exact (a `number` is a dyadic): a
 * transform loses nothing but the rounding of its own coefficients.
 */

import { ORIGIN, type Point, type Turn, normalizeAngle, normalizeZoom, turnOf } from "./camera";
import { type Dyadic, add, equals, fromNumber, mul, neg, shift, sub } from "./dyadic";

export interface Transform {
  readonly origin: Point;
  readonly position: Point;
  /** Integer. */
  readonly zLevel: number;
  /** In [1, 2). */
  readonly factor: number;
  /** Degrees, in [0, 360). */
  readonly angle: number;
  readonly mirror: boolean;
}

export const IDENTITY: Transform = Object.freeze({ origin: ORIGIN, position: ORIGIN, zLevel: 0, factor: 1, angle: 0, mirror: false });

export interface TransformOptions {
  readonly origin?: Point;
  readonly position?: Point;
  readonly zLevel?: number;
  /** Any positive, finite factor: it is brought into [1, 2) by adjusting `zLevel`. */
  readonly factor?: number;
  /** Any finite angle: it is brought into [0, 360). */
  readonly angle?: number;
  readonly mirror?: boolean;
}

/** A transform, by default the identity. Without `position`, the pivot stays where it is. */
export function createTransform(options: TransformOptions = {}): Transform {
  const origin = options.origin ?? ORIGIN;
  return {
    origin,
    position: options.position ?? origin,
    ...normalizeZoom(options.zLevel ?? 0, options.factor ?? 1),
    angle: normalizeAngle(options.angle ?? 0),
    mirror: options.mirror ?? false,
  };
}

/** Whether a transform leaves every point where it is. */
export function isIdentity(t: Transform): boolean {
  return t.zLevel === 0 && t.factor === 1 && t.angle === 0 && !t.mirror && equals(t.origin.x, t.position.x) && equals(t.origin.y, t.position.y);
}

/** `k · R · (x, y)` for an exact offset, exactly: `k` is a scale given as `2^level · factor`. */
export function turnedExactly(turn: Turn, level: number, factor: number, x: Dyadic, y: Dyadic): Point {
  const k = fromNumber(factor);
  const cos = mul(fromNumber(turn.cos), k);
  const sin = mul(fromNumber(turn.sin), k);
  return {
    x: shift(sub(mul(cos, x), mul(sin, y)), level),
    y: shift(add(mul(sin, x), mul(cos, y)), level),
  };
}

/** `T(p)`, exactly (for the rounded coefficients of `T`). */
export function applyTransform(t: Transform, p: Point): Point {
  const dx = sub(p.x, t.origin.x);
  const dy = sub(p.y, t.origin.y);
  const offset = turnedExactly(turnOf(t.angle), t.zLevel, t.factor, dx, t.mirror ? neg(dy) : dy);
  return { x: add(t.position.x, offset.x), y: add(t.position.y, offset.y) };
}

/** `outer ∘ inner`: first `inner`, then `outer`. Its pivot is the pivot of `inner`. */
export function composeTransforms(outer: Transform, inner: Transform): Transform {
  return {
    origin: inner.origin,
    position: applyTransform(outer, inner.position),
    ...normalizeZoom(outer.zLevel + inner.zLevel, outer.factor * inner.factor),
    // M · R(a) = R(−a) · M: a mirrored outer transform turns the inner angle the other way
    angle: normalizeAngle(outer.angle + (outer.mirror ? -inner.angle : inner.angle)),
    mirror: outer.mirror !== inner.mirror,
  };
}

/** `T`, then a turn by `degrees` (clockwise on the screen) around the exact world point `center`. */
export function turnedAround(t: Transform, center: Point, degrees: number): Transform {
  const offset = turnedExactly(turnOf(degrees), 0, 1, sub(t.position.x, center.x), sub(t.position.y, center.y));
  return {
    ...t,
    position: { x: add(center.x, offset.x), y: add(center.y, offset.y) },
    angle: normalizeAngle(t.angle + degrees),
  };
}

/**
 * `T`, then a mirror across the line through `center` whose direction makes `lineAngle` degrees with the world's
 * x axis (clockwise on the screen). A mirror across a line at angle φ is `R(2φ) · M`.
 */
export function mirroredAcross(t: Transform, center: Point, lineAngle: number): Transform {
  const dx = sub(t.position.x, center.x);
  const dy = sub(t.position.y, center.y);
  const offset = turnedExactly(turnOf(2 * lineAngle), 0, 1, dx, neg(dy));
  return {
    ...t,
    position: { x: add(center.x, offset.x), y: add(center.y, offset.y) },
    // R(2φ) · M · R(a) · M_t = R(2φ − a) · M · M_t
    angle: normalizeAngle(2 * lineAngle - t.angle),
    mirror: !t.mirror,
  };
}
