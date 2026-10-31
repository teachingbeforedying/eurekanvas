import { describe, expect, it } from "vitest";
import {
  type Camera,
  type Point,
  type ScreenPoint,
  type Viewport,
  ORIGIN,
  createCamera,
  log2Scale,
  normalizeAngle,
  pan,
  rotateAt,
  scale,
  screenToWorld,
  shortestAngle,
  turnOf,
  worldToScreen,
  zoomAt,
} from "./camera";
import { dyadic, equals, fromNumber, significantBits } from "./dyadic";
import { createRandom } from "./test-utils";

const viewport: Viewport = { width: 800, height: 600 };
const middle: ScreenPoint = { x: 400, y: 300 };

function samePoint(a: Point, b: Point): boolean {
  return equals(a.x, b.x) && equals(a.y, b.y);
}

function repeatZoom(camera: Camera, anchor: ScreenPoint, ratio: number, times: number): Camera {
  let current = camera;
  for (let i = 0; i < times; i++) current = zoomAt(current, viewport, anchor, ratio);
  return current;
}

describe("createCamera", () => {
  it("starts at the origin with one pixel per world unit", () => {
    const camera = createCamera();
    expect(camera.center).toBe(ORIGIN);
    expect(camera.zLevel).toBe(0);
    expect(camera.factor).toBe(1);
    expect(scale(camera)).toBe(1);
  });

  it("brings any positive factor into [1, 2)", () => {
    expect(createCamera({ factor: 6 })).toMatchObject({ zLevel: 2, factor: 1.5 });
    expect(createCamera({ factor: 0.3, zLevel: 5 })).toMatchObject({ zLevel: 3, factor: 1.2 });
  });

  it("rejects invalid zooms", () => {
    expect(() => createCamera({ factor: 0 })).toThrow(RangeError);
    expect(() => createCamera({ factor: -1 })).toThrow(RangeError);
    expect(() => createCamera({ factor: Number.NaN })).toThrow(RangeError);
    expect(() => createCamera({ zLevel: 1.5 })).toThrow(RangeError);
  });

  it("has a log2 scale that stays finite where the scale itself does not", () => {
    const deep = createCamera({ zLevel: 5000, factor: 1.5 });
    expect(scale(deep)).toBe(Infinity);
    expect(log2Scale(deep)).toBeCloseTo(5000 + Math.log2(1.5), 12);
  });
});

describe("screen and world conversion", () => {
  it("maps the middle of the screen to the center", () => {
    const camera = createCamera();
    expect(samePoint(screenToWorld(camera, viewport, middle), ORIGIN)).toBe(true);
    expect(worldToScreen(camera, viewport, ORIGIN)).toEqual(middle);
  });

  it("is the identity at scale 1, up to a translation", () => {
    const camera = createCamera();
    const world = screenToWorld(camera, viewport, { x: 500, y: 250 });
    expect(world.x).toEqual(dyadic(100n));
    expect(world.y).toEqual(dyadic(-50n));
  });

  it("round-trips screen -> world -> screen at depths from -1000 to +1000 levels", () => {
    const random = createRandom(10);
    for (const zLevel of [-1000, -500, 0, 500, 1000]) {
      // a center with about 1000 bits of precision
      const center: Point = {
        x: dyadic(random.bits(1000) | 1n, 1000),
        y: dyadic(-(random.bits(1000) | 1n), 1000),
      };
      const camera = createCamera({ center, zLevel, factor: 1 + random.next() });
      for (let i = 0; i < 200; i++) {
        const p = { x: random.next() * viewport.width, y: random.next() * viewport.height };
        const back = worldToScreen(camera, viewport, screenToWorld(camera, viewport, p));
        expect(Math.abs(back.x - p.x)).toBeLessThan(1e-9);
        expect(Math.abs(back.y - p.y)).toBeLessThan(1e-9);
      }
      expect(worldToScreen(camera, viewport, center)).toEqual(middle);
    }
  });

  it("reports points that are very far as infinitely far", () => {
    const camera = createCamera({ zLevel: 1000 });
    const far = { x: dyadic(1n, -2000), y: ORIGIN.y };
    expect(worldToScreen(camera, viewport, far).x).toBe(Infinity);
  });

  it("rejects invalid input", () => {
    const camera = createCamera();
    expect(() => screenToWorld(camera, { width: 0, height: 600 }, middle)).toThrow(RangeError);
    expect(() => screenToWorld(camera, { width: 800, height: Number.NaN }, middle)).toThrow(RangeError);
    expect(() => screenToWorld(camera, viewport, { x: Number.NaN, y: 0 })).toThrow(RangeError);
    expect(() => worldToScreen(camera, { width: -1, height: 600 }, ORIGIN)).toThrow(RangeError);
  });
});

describe("pan", () => {
  it("makes the content follow the pointer", () => {
    for (const zLevel of [-700, 0, 700]) {
      const camera = createCamera({ zLevel, factor: 1.3 });
      const point = screenToWorld(camera, viewport, { x: 123, y: 456 });
      const panned = pan(camera, 10, -5);
      const before = worldToScreen(camera, viewport, point);
      const after = worldToScreen(panned, viewport, point);
      expect(Math.abs(after.x - (before.x + 10))).toBeLessThan(1e-9);
      expect(Math.abs(after.y - (before.y - 5))).toBeLessThan(1e-9);
    }
  });

  it("is undone exactly by the opposite pan", () => {
    for (const zLevel of [-1000, 0, 1000]) {
      const camera = createCamera({ zLevel, factor: 1.7 });
      const back = pan(pan(camera, 37.25, -81.5), -37.25, 81.5);
      expect(samePoint(back.center, camera.center)).toBe(true);
      expect(back.zLevel).toBe(zLevel);
    }
  });

  it("rejects non-finite offsets", () => {
    expect(() => pan(createCamera(), Number.NaN, 0)).toThrow(RangeError);
    expect(() => pan(createCamera(), 0, Infinity)).toThrow(RangeError);
  });
});

describe("zoomAt", () => {
  const anchor: ScreenPoint = { x: 123.4, y: 567.8 };

  it("keeps the point under the anchor exactly fixed through 5000 zoom-ins and 5000 zoom-outs", () => {
    const start = createCamera();
    const target = screenToWorld(start, viewport, anchor);

    const deep = repeatZoom(start, anchor, 1.1, 5000); // about 2^687
    expect(deep.zLevel).toBeGreaterThan(680);
    expect(samePoint(screenToWorld(deep, viewport, anchor), target)).toBe(true);

    const back = repeatZoom(deep, anchor, 1 / 1.1, 5000);
    expect(samePoint(screenToWorld(back, viewport, anchor), target)).toBe(true);
    expect(Math.abs(log2Scale(back) - log2Scale(start))).toBeLessThan(1e-9);
  }, 30_000);

  it("keeps the center of a camera that zooms around the middle of the screen", () => {
    const start = createCamera({ center: { x: dyadic(5n, 3), y: dyadic(-7n, 2) } });
    const zoomed = repeatZoom(start, middle, 3, 100);
    expect(samePoint(zoomed.center, start.center)).toBe(true);
  });

  it("keeps factor in [1, 2) and zLevel an integer", () => {
    const random = createRandom(12);
    let camera = createCamera();
    for (let i = 0; i < 1000; i++) {
      const ratio = 10 ** (random.next() * 2 - 1); // from 0.1 to 10
      camera = zoomAt(camera, viewport, { x: random.next() * 800, y: random.next() * 600 }, ratio);
      expect(camera.factor).toBeGreaterThanOrEqual(1);
      expect(camera.factor).toBeLessThan(2);
      expect(Number.isInteger(camera.zLevel)).toBe(true);
    }
  });

  it("shifts zLevel by exactly 1 for a ratio of 2, leaving factor untouched", () => {
    const camera = createCamera({ zLevel: 3, factor: 1.2345 });
    const zoomed = zoomAt(camera, viewport, anchor, 2);
    expect(zoomed.zLevel).toBe(4);
    expect(zoomed.factor).toBe(1.2345);
    const out = zoomAt(camera, viewport, anchor, 0.5);
    expect(out.zLevel).toBe(2);
    expect(out.factor).toBe(1.2345);
  });

  it("handles ratios that would overflow or underflow a number", () => {
    const start = createCamera();
    const target = screenToWorld(start, viewport, anchor);
    const huge = zoomAt(start, viewport, anchor, 1e300);
    expect(log2Scale(huge)).toBeCloseTo(Math.log2(1e300), 9);
    expect(samePoint(screenToWorld(huge, viewport, anchor), target)).toBe(true);
    const tiny = zoomAt(start, viewport, anchor, 1e-300);
    expect(log2Scale(tiny)).toBeCloseTo(Math.log2(1e-300), 9);
    expect(samePoint(screenToWorld(tiny, viewport, anchor), target)).toBe(true);
  });

  it("rejects invalid ratios and viewports", () => {
    const camera = createCamera();
    for (const ratio of [0, -1, Number.NaN, Infinity]) {
      expect(() => zoomAt(camera, viewport, anchor, ratio)).toThrow(RangeError);
    }
    expect(() => zoomAt(camera, { width: 0, height: 0 }, anchor, 2)).toThrow(RangeError);
    expect(() => zoomAt(camera, viewport, { x: Infinity, y: 0 }, 2)).toThrow(RangeError);
  });

  it("does not make a deep point jump when zooming back out", () => {
    // Zoom in 700 levels around the anchor, then look at the point that was under it.
    const deep = repeatZoom(createCamera(), anchor, 2, 700);
    expect(deep.zLevel).toBe(700);
    const point = screenToWorld(deep, viewport, anchor);

    // Drag the canvas a little: the point follows the pointer, at 700 levels deep.
    const panned = pan(deep, 10, 5);
    const shown = worldToScreen(panned, viewport, point);
    expect(Math.abs(shown.x - (anchor.x + 10))).toBeLessThan(1e-9);
    expect(Math.abs(shown.y - (anchor.y + 5))).toBeLessThan(1e-9);

    // Zoom out around the middle: the point's distance to the middle halves at every step.
    // A screen coordinate is a number, and near 400 it cannot show offsets below about 6e-14 pixel:
    // so the halving is only checked while the distance is large enough to be measured.
    let camera = panned;
    let distance = Math.hypot(shown.x - middle.x, shown.y - middle.y);
    expect(distance).toBeGreaterThan(300);
    for (let level = 0; level < 700; level++) {
      camera = zoomAt(camera, viewport, middle, 0.5);
      const now = worldToScreen(camera, viewport, point);
      const nextDistance = Math.hypot(now.x - middle.x, now.y - middle.y);
      if (distance > 1e-3) expect(Math.abs(nextDistance / distance - 0.5)).toBeLessThan(1e-9);
      expect(nextDistance).toBeLessThanOrEqual(distance); // it only ever gets closer
      distance = nextDistance;
    }
    expect(camera.zLevel).toBe(0);
    expect(distance).toBeLessThan(1e-9); // the point has reached the middle of the screen

    // Zooming around the middle never moved the center, so the exact offset of the point is unchanged.
    expect(samePoint(camera.center, panned.center)).toBe(true);
  });

  it("keeps the anchor exactly in a turned view", () => {
    const start = createCamera({ angle: 33 });
    const target = screenToWorld(start, viewport, anchor);
    const deep = repeatZoom(start, anchor, 1.7, 300);
    expect(samePoint(screenToWorld(deep, viewport, anchor), target)).toBe(true);
  });

  it("grows the center's precision with the depth, about one bit per level", () => {
    const random = createRandom(13);
    const anchorPoint = { x: random.next() * 800, y: random.next() * 600 };
    const camera = repeatZoom(createCamera(), anchorPoint, 2, 500);
    const bits = significantBits(camera.center.x);
    expect(bits).toBeGreaterThan(400);
    expect(bits).toBeLessThan(700);
  });
});

describe("turning the view", () => {
  const anchor: ScreenPoint = { x: 123.4, y: 567.8 };

  it("brings angles into [0, 360), and finds the shortest way to turn", () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(720)).toBe(0);
    expect(Object.is(normalizeAngle(-0), 0)).toBe(true);
    expect(normalizeAngle(-1e-20)).toBe(0); // would round to 360
    expect(shortestAngle(270)).toBe(-90);
    expect(shortestAngle(180)).toBe(180);
    expect(createCamera({ angle: -30 }).angle).toBe(330);
    expect(() => normalizeAngle(Number.NaN)).toThrow(RangeError);
  });

  it("gives exact quarter turns", () => {
    expect(turnOf(90)).toEqual({ cos: 0, sin: 1 });
    expect(turnOf(-180)).toEqual({ cos: -1, sin: 0 });
    expect(turnOf(270)).toEqual({ cos: 0, sin: -1 });
    expect(turnOf(360)).toEqual({ cos: 1, sin: 0 });
  });

  it("turns the drawing clockwise on the screen, around the middle", () => {
    const quarter = createCamera({ angle: 90 });
    // the world's x axis now points down the screen, and its y axis to the left
    expect(worldToScreen(quarter, viewport, { x: fromNumber(10), y: fromNumber(0) })).toEqual({ x: 400, y: 310 });
    expect(worldToScreen(quarter, viewport, { x: fromNumber(0), y: fromNumber(10) })).toEqual({ x: 390, y: 300 });
    expect(samePoint(screenToWorld(quarter, viewport, { x: 400, y: 310 }), { x: fromNumber(10), y: fromNumber(0) })).toBe(true);
    // a point too far for a number, straight along the turned axis: still exactly on the middle column
    expect(worldToScreen(quarter, viewport, { x: dyadic(1n, -2000), y: fromNumber(0) })).toEqual({ x: 400, y: Infinity });
    const thirty = createCamera({ angle: 30 });
    const shown = worldToScreen(thirty, viewport, { x: fromNumber(100), y: fromNumber(0) });
    expect(shown.x).toBeCloseTo(400 + 100 * Math.cos(Math.PI / 6), 12);
    expect(shown.y).toBeCloseTo(300 + 100 * Math.sin(Math.PI / 6), 12);
  });

  it("goes back from the screen to the world in a turned view", () => {
    const random = createRandom(21);
    for (let i = 0; i < 200; i++) {
      const camera = createCamera({ angle: random.next() * 360, zLevel: random.int(40) - 20, factor: 1 + random.next() });
      const p = { x: random.next() * 800, y: random.next() * 600 };
      const back = worldToScreen(camera, viewport, screenToWorld(camera, viewport, p));
      expect(Math.abs(back.x - p.x)).toBeLessThan(1e-9);
      expect(Math.abs(back.y - p.y)).toBeLessThan(1e-9);
    }
  });

  it("keeps the world point under the anchor exactly, whatever the angle", () => {
    const random = createRandom(22);
    let camera = createCamera({ zLevel: 30, factor: 1.3 });
    const target = screenToWorld(camera, viewport, anchor);
    for (let i = 0; i < 500; i++) camera = rotateAt(camera, viewport, anchor, random.next() * 720 - 360);
    expect(samePoint(screenToWorld(camera, viewport, anchor), target)).toBe(true);
    const shown = worldToScreen(camera, viewport, target);
    expect(Math.abs(shown.x - anchor.x)).toBeLessThan(1e-9);
    expect(Math.abs(shown.y - anchor.y)).toBeLessThan(1e-9);
  });

  it("makes four quarter turns around the middle a full turn, exactly", () => {
    const start = createCamera({ center: { x: dyadic(5n, 3), y: dyadic(-7n, 2) }, angle: 12.5 });
    let camera = start;
    for (let i = 0; i < 4; i++) camera = rotateAt(camera, viewport, middle, 90);
    expect(camera.angle).toBe(12.5);
    expect(samePoint(camera.center, start.center)).toBe(true);
  });

  it("pans along the screen, not along the world, in a turned view", () => {
    const quarter = createCamera({ angle: 90 });
    const point = { x: fromNumber(10), y: fromNumber(0) };
    const moved = pan(quarter, 7, -3);
    const before = worldToScreen(quarter, viewport, point);
    const after = worldToScreen(moved, viewport, point);
    expect(after).toEqual({ x: before.x + 7, y: before.y - 3 });
  });
});
