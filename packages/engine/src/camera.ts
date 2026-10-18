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
 *
 * Only small offsets in pixels ever pass through a `number`: they are converted exactly to dyadics,
 * and added to (or subtracted from) the exact center.
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
}

export const ORIGIN: Point = Object.freeze({ x: ZERO, y: ZERO });

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
}

/** A camera at the world origin, with a scale of 1 pixel per world unit. */
export function createCamera(options: CameraOptions = {}): Camera {
  const { zLevel, factor } = normalizeZoom(options.zLevel ?? 0, options.factor ?? 1);
  return { center: options.center ?? ORIGIN, zLevel, factor };
}

/** Pixels per world unit, as a `number`. For display only: it is `Infinity` or `0` beyond 2^±1023. */
export function scale(camera: Camera): number {
  return 2 ** camera.zLevel * camera.factor;
}

/** log2 of the scale, finite at any depth. */
export function log2Scale(camera: Camera): number {
  return camera.zLevel + Math.log2(camera.factor);
}

/** The world offset corresponding to an offset of `pixels` on the screen. Exact once the pixels are given. */
function worldOffset(pixels: number, camera: Pick<Camera, "zLevel" | "factor">): Dyadic {
  return shift(fromNumber(pixels / camera.factor), -camera.zLevel);
}

export function screenToWorld(camera: Camera, viewport: Viewport, p: ScreenPoint): Point {
  assertViewport(viewport);
  assertScreenPoint(p);
  return {
    x: add(camera.center.x, worldOffset(p.x - viewport.width / 2, camera)),
    y: add(camera.center.y, worldOffset(p.y - viewport.height / 2, camera)),
  };
}

/**
 * Where a world point appears on the screen. Far from the viewport the result can be `±Infinity`:
 * the point is simply not visible. The difference with the center is exact, so a point very close
 * to the center keeps its full relative precision even at a huge zoom.
 */
export function worldToScreen(camera: Camera, viewport: Viewport, point: Point): ScreenPoint {
  assertViewport(viewport);
  return {
    x: toNumber(shift(sub(point.x, camera.center.x), camera.zLevel)) * camera.factor + viewport.width / 2,
    y: toNumber(shift(sub(point.y, camera.center.y), camera.zLevel)) * camera.factor + viewport.height / 2,
  };
}

/** Drags the canvas by a number of pixels: the content follows the pointer. */
export function pan(camera: Camera, dxPixels: number, dyPixels: number): Camera {
  assertFinite(dxPixels, "dx");
  assertFinite(dyPixels, "dy");
  return {
    ...camera,
    center: {
      x: sub(camera.center.x, worldOffset(dxPixels, camera)),
      y: sub(camera.center.y, worldOffset(dyPixels, camera)),
    },
  };
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
  const next = normalizeZoom(camera.zLevel + part.zLevel, camera.factor * part.factor);

  const anchored = screenToWorld(camera, viewport, anchor);
  return {
    ...next,
    center: {
      x: sub(anchored.x, worldOffset(anchor.x - viewport.width / 2, next)),
      y: sub(anchored.y, worldOffset(anchor.y - viewport.height / 2, next)),
    },
  };
}
