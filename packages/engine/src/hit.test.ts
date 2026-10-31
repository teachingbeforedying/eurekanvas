import { describe, expect, it } from "vitest";
import { type Point, type Viewport, createCamera } from "./camera";
import type { Item } from "./drawing";
import { type Dyadic, add, fromNumber, shift } from "./dyadic";
import { boundsFromCorners, boundsOf, boundsToScreen, itemBounds, itemsAt, itemsInRectangle } from "./hit";
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
    expect(itemsInRectangle(items, rect(-10, -10, 60, 10), "inside")).toEqual([2]);
    expect(itemsInRectangle(items, rect(-10, -10, 60, 10), "touching")).toEqual([0, 2]);
    expect(itemsInRectangle(items, rect(60, 10, -10, -10), "touching")).toEqual([0, 2]); // corners in any order
    expect(itemsInRectangle([], rect(-10, -10, 60, 10), "touching")).toEqual([]);
  });

  it("counts the ink, thickness included, not the box of the stroke", () => {
    const diagonal = stroke([[0, 0], [100, 100]]);
    expect(itemsInRectangle([diagonal], rect(80, 0, 100, 20), "touching")).toEqual([]); // in its box, off its ink
    expect(itemsInRectangle([diagonal], rect(40, 40, 60, 45), "touching")).toEqual([0]);

    const thick = stroke([[0, 0], [50, 0]], 0, 10); // 5 units on each side
    expect(itemsInRectangle([thick], rect(0, 4, 10, 20), "touching")).toEqual([0]);
    expect(itemsInRectangle([thick], rect(0, 6, 10, 20), "touching")).toEqual([]);
    expect(itemsInRectangle([thick], rect(-1, -1, 51, 1), "inside")).toEqual([]); // its points are inside, its ink is not
    expect(itemsInRectangle([thick], rect(-6, -6, 56, 6), "inside")).toEqual([0]);

    // thin along y = 0, thick (20 units) far away: the box of the ink reaches 10 units above the thin part
    const recorder = new StrokeRecorder();
    for (const [x, y, width] of [[0, 0, 1], [50, 0, 1], [50, 100, 1], [300, 100, 20]] as const) recorder.addPoint(pt(x, y), 0, width);
    const thinThenThick = recorder.stroke;
    expect(itemsInRectangle([thinThenThick], rect(0, -8, 40, -2), "touching")).toEqual([]);
    expect(itemsInRectangle([thinThenThick], rect(0, -8, 40, -0.4), "touching")).toEqual([0]);

    const dot = stroke([[0, 0]], 0, 10);
    expect(itemsInRectangle([dot], rect(3, -1, 10, 1), "touching")).toEqual([0]);
    expect(itemsInRectangle([dot], rect(6, -1, 10, 1), "touching")).toEqual([]);
  });

  it("takes a group whole: touched by one of its strokes, or inside with all of them", () => {
    const group: Item = { items: [stroke([[0, 0], [10, 0]]), stroke([[100, 0], [110, 0]])] };
    expect(itemsInRectangle([group], rect(-5, -5, 20, 5), "touching")).toEqual([0]);
    expect(itemsInRectangle([group], rect(-5, -5, 20, 5), "inside")).toEqual([]);
    expect(itemsInRectangle([group], rect(-5, -5, 120, 5), "inside")).toEqual([0]);
  });

  it("is exact far deeper than a number could tell apart", () => {
    // 100 units of level 60 long, starting at (1, 1): about 10^-16 world units, invisible from level 0
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(1, 1), 60);
    recorder.addPoint({ x: exact(1, 100, 60), y: fromNumber(1) }, 60);
    const tiny = recorder.stroke;
    expect(itemsInRectangle([tiny], rect(0, 0, 2, 2), "inside")).toEqual([0]);
    const fromMiddle = { minX: exact(1, 50, 60), minY: fromNumber(0), maxX: fromNumber(2), maxY: fromNumber(2) };
    expect(itemsInRectangle([tiny], fromMiddle, "inside")).toEqual([]);
    expect(itemsInRectangle([tiny], fromMiddle, "touching")).toEqual([0]);
    const beyond = { ...fromMiddle, minX: exact(1, 102, 60) };
    expect(itemsInRectangle([tiny], beyond, "touching")).toEqual([]);
  });

  it("is exact for a huge stroke seen through a small rectangle", () => {
    // 100 units of level -60 long: 100 * 2^60 world units, and 2^59 on each side of y = 0
    const huge = stroke([[0, 0], [100 * 2 ** 60, 0]], -60);
    const middle = 50 * 2 ** 60;
    expect(itemsInRectangle([huge], rect(middle, 2 ** 58, middle + 1, 2 ** 58 + 1), "touching")).toEqual([0]);
    expect(itemsInRectangle([huge], rect(middle, 2 ** 60, middle + 1, 2 ** 60 + 1), "touching")).toEqual([]);
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

  it("appears on the screen where the camera shows it", () => {
    expect(boundsToScreen(camera, viewport, rect(0, 0, 10, 20))).toEqual({ left: 640, top: 360, right: 650, bottom: 380 });
  });
});
