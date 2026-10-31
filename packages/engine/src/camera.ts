/**
 * The camera of the infinite canvas, as pure functions on immutable values.
 *
 * Conventions:
 * - World coordinates are exact dyadics. The screen is in pixels, with its origin at the top left.
 * - The y axis points down, in the world as on the screen (nothing to flip).
 * - `scale` (screen pixels per world unit) is `2^zLevel * factor`, with `factor` in [1, 2).
 *   `zLevel` is an integer and grows when zooming in. Storing the zoom this way keeps it finite at
 *   any depth: a `number` cannot hold 2^1024.
 * - `center` is the world point shown at the middle of the viewport.
 * - `angle`, in degrees, is how far the drawing is turned clockwise on the screen. A world offset `d` from
 *   the center appears at `R(angle) · d · scale` from the middle of the screen, with
 *   `R(a) = [cos a, -sin a; sin a, cos a]` (clockwise, since the y axis points down).
 *
 * Only small offsets in pixels ever pass through a `number`: they are converted exactly to dyadics,
 * and added to (or subtracted from) the exact center. A turn applies to such small offsets only.
 */

import { type Dyadic, ZERO, add, fromNumber, shift, sub, toNumber } from "./dyadic";

export interface Point {
  readonly x: Dyadic;
  readonly y: Dyadic;
}

/** A position on the screen, in pixels. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface Camera {
  readonly center: Point;
  /** Integer. Grows when zooming in. */
  readonly zLevel: number;
  /** In [1, 2). */
  readonly factor: number;
  /** In degrees, in [0, 360): how far the drawing is turned clockwise on the screen. */
  readonly angle: number;
}

export const ORIGIN: Point = Object.freeze({ x: ZERO, y: ZERO });

/** The cosine and the sine of an angle. */
export interface Turn {
  readonly cos: number;
  readonly sin: number;
}

/** An angle in degrees brought into [0, 360). */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new RangeError(`angle must be a finite number, got ${degrees}`);
  const rest = degrees % 360; // exact
  const angle = rest < 0 ? rest + 360 : rest;
  return angle === 360 || angle === 0 ? 0 : angle; // no 360 from rounding, and no -0
}

/** The same angle, in degrees, brought into (-180, 180]: the shortest way to turn by it. */
export function shortestAngle(degrees: number): number {
  const angle = normalizeAngle(degrees);
  return angle > 180 ? angle - 360 : angle;
}

/** The cosine and the sine of an angle in degrees, exact for quarter turns (they are then 0 or ±1). */
export function turnOf(degrees: number): Turn {
  const angle = normalizeAngle(degrees);
  if (angle === 0) return { cos: 1, sin: 0 };
  if (angle === 90) return { cos: 0, sin: 1 };
  if (angle === 180) return { cos: -1, sin: 0 };
  if (angle === 270) return { cos: 0, sin: -1 };
  const radians = (angle * Math.PI) / 180;
  return { cos: Math.cos(radians), sin: Math.sin(radians) };
}

/** `k * v`, where a coefficient of exactly 0 gives 0 even for an infinite `v`. */
function times(k: number, v: number): number {
  return k === 0 ? 0 : k * v;
}

/** `R · (x, y)`: turns an offset clockwise on the screen by `turn`. */
export function turned(turn: Turn, x: number, y: number): ScreenPoint {
  return { x: times(turn.cos, x) - times(turn.sin, y), y: times(turn.sin, x) + times(turn.cos, y) };
}

/** `R⁻¹ · (x, y)`: undoes `turned`. */
export function unturned(turn: Turn, x: number, y: number): ScreenPoint {
  return { x: times(turn.cos, x) + times(turn.sin, y), y: times(turn.cos, y) - times(turn.sin, x) };
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number, got ${value}`);
}

function assertViewport(viewport: Viewport): void {
  if (!(Number.isFinite(viewport.width) && viewport.width > 0 && Number.isFinite(viewport.height) && viewport.height > 0)) {
    throw new RangeError(`viewport must have a positive, finite size, got ${viewport.width}x${viewport.height}`);
  }
}

function assertScreenPoint(p: ScreenPoint): void {
  assertFinite(p.x, "screen x");
  assertFinite(p.y, "screen y");
}

/** Brings a zoom `2^zLevel * factor` to its canonical form: `factor` in [1, 2), `zLevel` an integer. */
function normalizeZoom(zLevel: number, factor: number): { zLevel: number; factor: number } {
  if (!Number.isInteger(zLevel)) throw new RangeError(`zLevel must be an integer, got ${zLevel}`);
  if (!(Number.isFinite(factor) && factor > 0)) throw new RangeError(`zoom factor must be positive and finite, got ${factor}`);
  // Multiplying or dividing by 2 is exact, so the factor loses nothing here.
  while (factor >= 2) {
    factor /= 2;
    zLevel += 1;
  }
  while (factor < 1) {
    factor *= 2;
    zLevel -= 1;
  }
  return { zLevel, factor };
}

export interface CameraOptions {
  readonly center?: Point;
  readonly zLevel?: number;
  /** Any positive, finite factor: it is brought into [1, 2) by adjusting `zLevel`. */
  readonly factor?: number;
  /** In degrees, any finite angle: it is brought into [0, 360). */
  readonly angle?: number;
}

/** A camera at the world origin, with a scale of 1 pixel per world unit, not turned. */
export function createCamera(options: CameraOptions = {}): Camera {
  const { zLevel, factor } = normalizeZoom(options.zLevel ?? 0, options.factor ?? 1);
  return { center: options.center ?? ORIGIN, zLevel, factor, angle: normalizeAngle(options.angle ?? 0) };
}

/** Pixels per world unit, as a `number`. For display only: it is `Infinity` or `0` beyond 2^±1023. */
export function scale(camera: Camera): number {
  return 2 ** camera.zLevel * camera.factor;
}

/** log2 of the scale, finite at any depth. */
export function log2Scale(camera: Camera): number {
  return camera.zLevel + Math.log2(camera.factor);
}

/**
 * The world offset corresponding to an offset of `(dx, dy)` pixels on the screen. Exact once the turned-back
 * pixels are computed; always computed the same way, so that zooming and turning can rely on it.
 */
function worldOffset(camera: Camera, dx: number, dy: number): Point {
  const back = unturned(turnOf(camera.angle), dx / camera.factor, dy / camera.factor);
  return { x: shift(fromNumber(back.x), -camera.zLevel), y: shift(fromNumber(back.y), -camera.zLevel) };
}

export function screenToWorld(camera: Camera, viewport: Viewport, p: ScreenPoint): Point {
  assertViewport(viewport);
  assertScreenPoint(p);
  const offset = worldOffset(camera, p.x - viewport.width / 2, p.y - viewport.height / 2);
  return { x: add(camera.center.x, offset.x), y: add(camera.center.y, offset.y) };
}

/**
 * Where a world point appears on the screen. Far from the viewport the result can be infinite, or `NaN` in a
 * turned view: the point is simply not visible. The difference with the center is exact, so a point very
 * close to the center keeps its full relative precision even at a huge zoom.
 */
export function worldToScreen(camera: Camera, viewport: Viewport, point: Point): ScreenPoint {
  assertViewport(viewport);
  const dx = toNumber(shift(sub(point.x, camera.center.x), camera.zLevel)) * camera.factor;
  const dy = toNumber(shift(sub(point.y, camera.center.y), camera.zLevel)) * camera.factor;
  const offset = turned(turnOf(camera.angle), dx, dy);
  return { x: offset.x + viewport.width / 2, y: offset.y + viewport.height / 2 };
}

/** Drags the canvas by a number of pixels: the content follows the pointer. */
export function pan(camera: Camera, dxPixels: number, dyPixels: number): Camera {
  assertFinite(dxPixels, "dx");
  assertFinite(dyPixels, "dy");
  const offset = worldOffset(camera, dxPixels, dyPixels);
  return { ...camera, center: { x: sub(camera.center.x, offset.x), y: sub(camera.center.y, offset.y) } };
}

/**
 * Multiplies the scale by `ratio` (> 1 zooms in) while keeping the world point under `anchor` exactly
 * where it is on the screen.
 *
 * Why it is exact: the new center is `P - q`, with `P` the world point under the anchor and `q` the
 * offset of the anchor from the screen middle at the new zoom. `screenToWorld` then computes the very
 * same `q` and adds it back, so it finds `P` again with no rounding.
 */
export function zoomAt(camera: Camera, viewport: Viewport, anchor: ScreenPoint, ratio: number): Camera {
  assertViewport(viewport);
  assertScreenPoint(anchor);
  if (!(Number.isFinite(ratio) && ratio > 0)) throw new RangeError(`zoom ratio must be positive and finite, got ${ratio}`);

  // Split the ratio into a power of two and a part in [1, 2), so that a huge ratio cannot overflow.
  const part = normalizeZoom(0, ratio);
  const next = { ...camera, ...normalizeZoom(camera.zLevel + part.zLevel, camera.factor * part.factor) };
  return keepingAnchor(camera, next, viewport, anchor);
}

/**
 * Turns the view by `degrees` (clockwise on the screen) around `anchor`, which keeps the world point under it
 * exactly where it is, for the same reason as `zoomAt`.
 */
export function rotateAt(camera: Camera, viewport: Viewport, anchor: ScreenPoint, degrees: number): Camera {
  assertViewport(viewport);
  assertScreenPoint(anchor);
  return keepingAnchor(camera, { ...camera, angle: normalizeAngle(camera.angle + degrees) }, viewport, anchor);
}

/** `next`, with its center moved so that the world point under `anchor` with `camera` is under it again. */
function keepingAnchor(camera: Camera, next: Camera, viewport: Viewport, anchor: ScreenPoint): Camera {
  const anchored = screenToWorld(camera, viewport, anchor);
  const offset = worldOffset(next, anchor.x - viewport.width / 2, anchor.y - viewport.height / 2);
  return { ...next, center: { x: sub(anchored.x, offset.x), y: sub(anchored.y, offset.y) } };
}
