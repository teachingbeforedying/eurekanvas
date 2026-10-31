import { describe, expect, it } from "vitest";
import { ORIGIN, type Point, type Viewport, createCamera } from "./camera";
import type { Item } from "./drawing";
import { type Dyadic, add, fromNumber, shift } from "./dyadic";
import {
  boundsFromCorners,
  boundsOf,
  itemBounds,
  itemsAt,
  itemsInRectangle,
  orientedRectangle,
  rectangleOnScreen,
  worldRectangle,
} from "./hit";
import { type Stroke, StrokeRecorder } from "./stroke";

// With the default camera (level 0, centre at the world origin), world point (x, y) is at screen (640 + x, 360 + y).
const viewport: Viewport = { width: 1280, height: 720 };
const camera = createCamera();

function pt(x: number, y: number): Point {
  return { x: fromNumber(x), y: fromNumber(y) };
}

function stroke(points: readonly (readonly [number, number])[], zLevel = 0, width = 1): Stroke {
  const recorder = new StrokeRecorder();
  for (const [x, y] of points) recorder.addPoint(pt(x, y), zLevel, width);
  return recorder.stroke;
}

/** The exact rectangle from (x1, y1) to (x2, y2). */
function rect(x1: number, y1: number, x2: number, y2: number) {
  return boundsFromCorners(pt(x1, y1), pt(x2, y2));
}

/** The same, as a rectangle to select with, not turned. */
function area(x1: number, y1: number, x2: number, y2: number) {
  return worldRectangle(rect(x1, y1, x2, y2));
}

/** `whole + fraction * 2^-k`, exactly. */
function exact(whole: number, fraction: number, k: number): Dyadic {
  return add(fromNumber(whole), shift(fromNumber(fraction), -k));
}

describe("itemsAt", () => {
  it("takes a stroke under the pointer, or at most `tolerance` pixels from the edge of its ink", () => {
    const line = stroke([[0, 0], [100, 0]], 0, 2); // 1 pixel on each side of y = 0
    expect(itemsAt([line], camera, viewport, { x: 690, y: 360 })).toEqual([0]);
    expect(itemsAt([line], camera, viewport, { x: 690, y: 365 }, 4)).toEqual([0]); // 4 pixels from the edge
    expect(itemsAt([line], camera, viewport, { x: 690, y: 365 }, 3.9)).toEqual([]);
    expect(itemsAt([line], camera, viewport, { x: 743, y: 360 }, 2)).toEqual([0]); // beyond the round end
    expect(itemsAt([line], camera, viewport, { x: 743, y: 360 }, 1.9)).toEqual([]);
  });

  it("counts the thickness of the stroke, point by point", () => {
    const thick = stroke([[0, 0], [100, 0]], 0, 20);
    expect(itemsAt([thick], camera, viewport, { x: 690, y: 369 })).toEqual([0]);
    expect(itemsAt([thick], camera, viewport, { x: 690, y: 371 })).toEqual([]);

    // from 2 to 20 units thick: 11 in the middle
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(0, 0), 0, 2);
    recorder.addPoint(pt(100, 0), 0, 20);
    const tapered = recorder.stroke;
    expect(itemsAt([tapered], camera, viewport, { x: 690, y: 365.4 })).toEqual([0]);
    expect(itemsAt([tapered], camera, viewport, { x: 690, y: 365.6 })).toEqual([]);

    const dot = stroke([[0, 0]], 0, 10);
    expect(itemsAt([dot], camera, viewport, { x: 645, y: 360 })).toEqual([0]);
    expect(itemsAt([dot], camera, viewport, { x: 646, y: 360 })).toEqual([]);
  });

  it("measures the tolerance in pixels of the screen, whatever the zoom", () => {
    const line = stroke([[0, 0], [100, 0]], 0, 1);
    const zoomed = createCamera({ zLevel: 2 }); // 4 pixels per unit: the stroke is 4 pixels thick
    expect(itemsAt([line], zoomed, viewport, { x: 800, y: 365 }, 3)).toEqual([0]);
    expect(itemsAt([line], zoomed, viewport, { x: 800, y: 365 }, 2.9)).toEqual([]);
  });

  it("gives the objects topmost first, and takes a group by any of its strokes", () => {
    const below = stroke([[0, 0], [100, 0]]);
    const crossing = stroke([[50, -50], [50, 50]]);
    const elsewhere = stroke([[300, 100], [400, 100]]);
    const group: Item = { items: [elsewhere, crossing] };
    const above = stroke([[40, 0], [60, 0]]);
    const items = [below, group, above];
    expect(itemsAt(items, camera, viewport, { x: 690, y: 360 })).toEqual([2, 1, 0]);
    expect(itemsAt(items, camera, viewport, { x: 990, y: 460 })).toEqual([1]);
    expect(itemsAt(items, camera, viewport, { x: 600, y: 600 }, 4)).toEqual([]);
    expect(itemsAt([], camera, viewport, { x: 690, y: 360 })).toEqual([]);
  });

  it("finds the ink where a turned view shows it", () => {
    const line = stroke([[0, 0], [100, 0]], 0, 2);
    const quarter = createCamera({ angle: 90 }); // the line goes down the screen from the middle
    expect(itemsAt([line], quarter, viewport, { x: 640, y: 410 })).toEqual([0]);
    expect(itemsAt([line], quarter, viewport, { x: 645, y: 410 }, 4)).toEqual([0]);
    expect(itemsAt([line], quarter, viewport, { x: 645, y: 410 }, 3.9)).toEqual([]);
    expect(itemsAt([line], quarter, viewport, { x: 690, y: 360 }, 4)).toEqual([]); // where it is in a straight view
    const thirty = createCamera({ angle: 30 });
    const along = { x: 640 + 50 * Math.cos(Math.PI / 6), y: 360 + 50 * Math.sin(Math.PI / 6) };
    expect(itemsAt([line], thirty, viewport, along)).toEqual([0]);
    expect(itemsAt([line], thirty, viewport, { x: along.x + 3, y: along.y - 5 }, 4)).toEqual([]);
  });

  it("does not take what is not drawn: a section too small to see cannot be hit", () => {
    const tiny = stroke([[0, 0], [0.25, 0]], 10); // a quarter of a pixel
    expect(itemsAt([tiny], camera, viewport, { x: 640, y: 360 }, 4)).toEqual([]);
    expect(itemsAt([tiny], camera, viewport, { x: 640, y: 360 }, 4, { minPixels: 0 })).toEqual([0]);
  });
});

describe("itemsInRectangle", () => {
  it("takes what is entirely inside (`inside`) or what it touches (`touching`), in drawing order", () => {
    const within = stroke([[0, 0], [50, 0]]);
    const across = stroke([[40, 0], [100, 0]]);
    const away = stroke([[200, 0], [300, 0]]);
    const items = [across, away, within];
    expect(itemsInRectangle(items, area(-10, -10, 60, 10), "inside")).toEqual([2]);
    expect(itemsInRectangle(items, area(-10, -10, 60, 10), "touching")).toEqual([0, 2]);
    expect(itemsInRectangle(items, area(60, 10, -10, -10), "touching")).toEqual([0, 2]); // corners in any order
    expect(itemsInRectangle([], area(-10, -10, 60, 10), "touching")).toEqual([]);
  });

  it("counts the ink, thickness included, not the box of the stroke", () => {
    const diagonal = stroke([[0, 0], [100, 100]]);
    expect(itemsInRectangle([diagonal], area(80, 0, 100, 20), "touching")).toEqual([]); // in its box, off its ink
    expect(itemsInRectangle([diagonal], area(40, 40, 60, 45), "touching")).toEqual([0]);

    const thick = stroke([[0, 0], [50, 0]], 0, 10); // 5 units on each side
    expect(itemsInRectangle([thick], area(0, 4, 10, 20), "touching")).toEqual([0]);
    expect(itemsInRectangle([thick], area(0, 6, 10, 20), "touching")).toEqual([]);
    expect(itemsInRectangle([thick], area(-1, -1, 51, 1), "inside")).toEqual([]); // its points are inside, its ink is not
    expect(itemsInRectangle([thick], area(-6, -6, 56, 6), "inside")).toEqual([0]);

    // thin along y = 0, thick (20 units) far away: the box of the ink reaches 10 units above the thin part
    const recorder = new StrokeRecorder();
    for (const [x, y, width] of [[0, 0, 1], [50, 0, 1], [50, 100, 1], [300, 100, 20]] as const) recorder.addPoint(pt(x, y), 0, width);
    const thinThenThick = recorder.stroke;
    expect(itemsInRectangle([thinThenThick], area(0, -8, 40, -2), "touching")).toEqual([]);
    expect(itemsInRectangle([thinThenThick], area(0, -8, 40, -0.4), "touching")).toEqual([0]);

    const dot = stroke([[0, 0]], 0, 10);
    expect(itemsInRectangle([dot], area(3, -1, 10, 1), "touching")).toEqual([0]);
    expect(itemsInRectangle([dot], area(6, -1, 10, 1), "touching")).toEqual([]);
  });

  it("takes a group whole: touched by one of its strokes, or inside with all of them", () => {
    const group: Item = { items: [stroke([[0, 0], [10, 0]]), stroke([[100, 0], [110, 0]])] };
    expect(itemsInRectangle([group], area(-5, -5, 20, 5), "touching")).toEqual([0]);
    expect(itemsInRectangle([group], area(-5, -5, 20, 5), "inside")).toEqual([]);
    expect(itemsInRectangle([group], area(-5, -5, 120, 5), "inside")).toEqual([0]);
  });

  it("is exact far deeper than a number could tell apart", () => {
    // 100 units of level 60 long, starting at (1, 1): about 10^-16 world units, invisible from level 0
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(1, 1), 60);
    recorder.addPoint({ x: exact(1, 100, 60), y: fromNumber(1) }, 60);
    const tiny = recorder.stroke;
    expect(itemsInRectangle([tiny], area(0, 0, 2, 2), "inside")).toEqual([0]);
    const fromMiddle = { minX: exact(1, 50, 60), minY: fromNumber(0), maxX: fromNumber(2), maxY: fromNumber(2) };
    expect(itemsInRectangle([tiny], worldRectangle(fromMiddle), "inside")).toEqual([]);
    expect(itemsInRectangle([tiny], worldRectangle(fromMiddle), "touching")).toEqual([0]);
    const beyond = { ...fromMiddle, minX: exact(1, 102, 60) };
    expect(itemsInRectangle([tiny], worldRectangle(beyond), "touching")).toEqual([]);
  });

  it("is exact for a huge stroke seen through a small rectangle", () => {
    // 100 units of level -60 long: 100 * 2^60 world units, and 2^59 on each side of y = 0
    const huge = stroke([[0, 0], [100 * 2 ** 60, 0]], -60);
    const middle = 50 * 2 ** 60;
    expect(itemsInRectangle([huge], area(middle, 2 ** 58, middle + 1, 2 ** 58 + 1), "touching")).toEqual([0]);
    expect(itemsInRectangle([huge], area(middle, 2 ** 60, middle + 1, 2 ** 60 + 1), "touching")).toEqual([]);
  });

  it("follows the sides of a turned view", () => {
    // turned by -45°, the diagonal from (0, 0) to (100, 100) is horizontal: from 0 to 141.4 along the first axis
    const diagonal = stroke([[0, 0], [100, 100]]);
    const aside = stroke([[100, 0], [110, 0]]);
    const thin = { origin: ORIGIN, angle: 315, bounds: rect(-5, -3, 150, 3) };
    expect(itemsInRectangle([diagonal, aside], thin, "inside")).toEqual([0]);
    expect(itemsInRectangle([diagonal, aside], thin, "touching")).toEqual([0]);
    // a thin rectangle across the middle of the diagonal, which its straight box would not tell apart
    const across = { origin: ORIGIN, angle: 315, bounds: rect(60, -20, 80, 20) };
    expect(itemsInRectangle([diagonal, aside], across, "touching")).toEqual([0]);
    expect(itemsInRectangle([diagonal, aside], { ...across, bounds: rect(60, 1, 80, 20) }, "touching")).toEqual([]);
  });

  it("is exact on the sides of a quarter turn", () => {
    // turned by 90°, the view coordinates of (x, y) are (-y, x): the line is 2 units thick around the second axis
    const line = stroke([[0, 0], [50, 0]], 0, 2);
    const turned = (x1: number, y1: number, x2: number, y2: number) => ({ origin: ORIGIN, angle: 90, bounds: rect(x1, y1, x2, y2) });
    expect(itemsInRectangle([line], turned(-1, -1, 1, 51), "inside")).toEqual([0]);
    expect(itemsInRectangle([line], turned(-0.99, -1, 1, 51), "inside")).toEqual([]);
    expect(itemsInRectangle([line], turned(1, 10, 5, 20), "touching")).toEqual([0]);
    expect(itemsInRectangle([line], turned(1.01, 10, 5, 20), "touching")).toEqual([]);
  });

  it("is made from two world corners, in the view's coordinates", () => {
    expect(orientedRectangle(pt(0, 0), pt(-10, 10), ORIGIN, 90).bounds).toEqual(rect(-10, -10, 0, 0));
    expect(orientedRectangle(pt(3, 4), pt(5, 1), pt(1, 1), 0).bounds).toEqual(rect(2, 0, 4, 3));
  });
});

describe("itemBounds", () => {
  it("is the exact box of the ink, at the level of each section", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(1, 2), 3, 2); // 2 units of level 3 thick: 1/4 of a world unit
    recorder.addPoint(pt(3, 2), 3, 2);
    const line = recorder.stroke;
    expect(itemBounds(line)).toEqual(rect(0.875, 1.875, 3.125, 2.125));
    const other = stroke([[-5, 10], [0, 10]], 0, 2);
    expect(itemBounds({ items: [line, other] })).toEqual(rect(-6, 1.875, 3.125, 11));
    expect(boundsOf([line, other])).toEqual(itemBounds({ items: [line, other] }));
    expect(boundsOf([])).toBeNull();
    expect(itemBounds({ sections: [] })).toBeNull();
  });

  it("appears on the screen with its center, its size and the angle of its sides", () => {
    expect(rectangleOnScreen(camera, viewport, area(0, 0, 10, 20))).toEqual({ center: { x: 645, y: 370 }, width: 10, height: 20, angle: 0 });
    const zoomed = createCamera({ center: pt(5, 10), zLevel: 1, angle: 90 });
    expect(rectangleOnScreen(zoomed, viewport, area(0, 0, 10, 20))).toEqual({ center: { x: 640, y: 360 }, width: 20, height: 40, angle: 90 });
  });
});
