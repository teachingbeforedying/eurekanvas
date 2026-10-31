import { describe, expect, it } from "vitest";
import { type Point, type Viewport, createCamera, worldToScreen } from "./camera";
import { type Item, withTransform } from "./drawing";
import { type Dyadic, add, equals, fromNumber, shift, sub, toNumber } from "./dyadic";
import { boundsFromCorners, itemBounds, itemFrame, itemsAt, itemsInRectangle, rectangleCenter, selectionFrame, worldRectangle } from "./hit";
import { placedSections } from "./placement";
import { selectDrawableSections } from "./render";
import { type Stroke, StrokeRecorder, pointWorld } from "./stroke";
import {
  IDENTITY,
  applyTransform,
  composeTransforms,
  createTransform,
  isIdentity,
  mirroredAcross,
  turnedAround,
} from "./transform";
import { createRandom } from "./test-utils";

const viewport: Viewport = { width: 1280, height: 720 };

function pt(x: number, y: number): Point {
  return { x: fromNumber(x), y: fromNumber(y) };
}

function same(a: Point, b: Point): boolean {
  return equals(a.x, b.x) && equals(a.y, b.y);
}

function stroke(points: readonly (readonly [number, number])[], zLevel = 0, width = 1): Stroke {
  const recorder = new StrokeRecorder();
  for (const [x, y] of points) recorder.addPoint(pt(x, y), zLevel, width);
  return recorder.stroke;
}

/** How far apart two points are, in world units, as a number. */
function gap(a: Point, b: Point): number {
  return Math.hypot(toNumber(sub(a.x, b.x)), toNumber(sub(a.y, b.y)));
}

describe("a transform", () => {
  it("turns, mirrors and scales around its pivot, then puts the pivot at its position", () => {
    const pivot = pt(10, 10);
    expect(applyTransform(IDENTITY, pt(3, 4))).toEqual(pt(3, 4));
    expect(applyTransform(createTransform({ origin: pivot, angle: 90 }), pt(11, 10))).toEqual(pt(10, 11)); // clockwise on the screen
    expect(applyTransform(createTransform({ origin: pivot, mirror: true }), pt(10, 11))).toEqual(pt(10, 9));
    expect(applyTransform(createTransform({ origin: pivot, zLevel: 1, factor: 1.5 }), pt(11, 10))).toEqual(pt(13, 10));
    expect(applyTransform(createTransform({ origin: pivot, position: pt(0, 0) }), pt(11, 10))).toEqual(pt(1, 0));
  });

  it("brings its factor into [1, 2) and its angle into [0, 360), and knows when it changes nothing", () => {
    expect(createTransform({ factor: 6, angle: -90 })).toMatchObject({ zLevel: 2, factor: 1.5, angle: 270 });
    expect(isIdentity(createTransform({ origin: pt(5, 5) }))).toBe(true);
    expect(isIdentity(createTransform({ origin: pt(5, 5), position: pt(5, 6) }))).toBe(false);
    expect(isIdentity(createTransform({ angle: 360 }))).toBe(true);
  });

  it("composes like applying one after the other: exactly for quarter turns and mirrors", () => {
    const random = createRandom(31);
    for (let i = 0; i < 50; i++) {
      const outer = createTransform({ origin: pt(random.int(20), random.int(20)), position: pt(random.int(20), 0), angle: 90 * random.int(4), mirror: random.int(2) === 1, zLevel: random.int(5) - 2 });
      const inner = createTransform({ origin: pt(random.int(20), 3), position: pt(1, random.int(20)), angle: 90 * random.int(4), mirror: random.int(2) === 1, factor: 1.25 });
      const p = pt(random.int(100), random.int(100));
      expect(same(applyTransform(composeTransforms(outer, inner), p), applyTransform(outer, applyTransform(inner, p)))).toBe(true);
    }
  });

  it("composes any angles to within the rounding of the cosine and the sine", () => {
    const outer = createTransform({ origin: pt(1, 2), position: pt(3, 4), angle: 33, mirror: true, factor: 1.7 });
    const inner = createTransform({ origin: pt(-5, 7), position: pt(0, 1), angle: 101, zLevel: 3 });
    const p = pt(12.5, -3.25);
    expect(gap(applyTransform(composeTransforms(outer, inner), p), applyTransform(outer, applyTransform(inner, p)))).toBeLessThan(1e-12);
  });

  it("comes back exactly after four quarter turns around a point, or two mirrors across the same line", () => {
    const start = createTransform({ origin: pt(3, 4), position: pt(5, 6), angle: 17 });
    let t = start;
    for (let i = 0; i < 4; i++) t = turnedAround(t, pt(100, -50), 90);
    expect(t).toEqual(start);
    for (const line of [0, 90, 45, 30]) {
      const twice = mirroredAcross(mirroredAcross(start, pt(7, 8), line), pt(7, 8), line);
      expect(twice.mirror).toBe(false);
      expect(twice.angle).toBeCloseTo(17, 9);
      expect(gap(twice.position, start.position)).toBeLessThan(1e-12);
    }
    expect(mirroredAcross(mirroredAcross(start, pt(7, 8), 90), pt(7, 8), 90)).toEqual(start);
  });

  it("mirrors across a vertical line from left to right, and across a horizontal line from top to bottom", () => {
    const leftRight = mirroredAcross(IDENTITY, pt(10, 0), 90);
    expect(applyTransform(leftRight, pt(12, 5))).toEqual(pt(8, 5));
    const topBottom = mirroredAcross(IDENTITY, pt(0, 10), 0);
    expect(applyTransform(topBottom, pt(12, 5))).toEqual(pt(12, 15));
  });

  it("keeps its precision relative to the object, 600 levels deep", () => {
    // an object 100 units of level 600 wide, near (1, 1): its pivot is at its center
    const unit = (k: number): Dyadic => shift(fromNumber(k), -600);
    const center = { x: add(fromNumber(1), unit(50)), y: fromNumber(1) };
    const end = { x: add(fromNumber(1), unit(100)), y: fromNumber(1) };
    const turned = turnedAround(createTransform({ origin: center }), center, 37);
    const moved = applyTransform(turned, end);
    // the end turns around the center by 37°: 50 units away, at 37° below the x axis
    const dx = toNumber(shift(sub(moved.x, center.x), 600));
    const dy = toNumber(shift(sub(moved.y, center.y), 600));
    expect(dx).toBeCloseTo(50 * Math.cos((37 * Math.PI) / 180), 10);
    expect(dy).toBeCloseTo(50 * Math.sin((37 * Math.PI) / 180), 10);
  });
});

describe("placed objects", () => {
  const camera = createCamera(); // world point (x, y) is at screen (640 + x, 360 + y)

  it("put each point of their strokes where their transform puts it", () => {
    const line = stroke([[0, 0], [10, 0], [20, 5]]);
    const t = createTransform({ origin: pt(0, 0), position: pt(100, 100), angle: 90, mirror: true });
    const [placed] = placedSections(withTransform(line, t));
    const section = line.sections[0];
    if (placed === undefined || section === undefined) throw new Error("one section expected");
    section.points.forEach((local, i) => {
      const offset = { x: local.y, y: local.x }; // R(90) · M · local = R(90) · (x, -y), in local units of 1 world unit
      expect(same({ x: add(placed.anchor.x, fromNumber(offset.x)), y: add(placed.anchor.y, fromNumber(offset.y)) }, applyTransform(t, pointWorld(section, i)))).toBe(true);
    });
  });

  it("compose the transforms of the groups around them", () => {
    const line = stroke([[0, 0], [10, 0]]);
    const pivot = pt(0, 0);
    const inner = withTransform(line, createTransform({ origin: pivot, angle: 90 }));
    const group: Item = withTransform({ items: [inner] }, createTransform({ origin: pivot, angle: 90 }));
    expect(placedSections(group)[0]).toMatchObject({ angle: 180, mirror: false });
    expect(itemBounds(group)).toEqual(boundsFromCorners(pt(-10.5, -0.5), pt(0.5, 0.5)));
  });

  it("take the transform of their own object before the one of its group", () => {
    const line = stroke([[0, 0], [10, 0]]);
    const turned = withTransform(line, createTransform({ origin: pt(0, 0), angle: 90 })); // from (0, 0) down to (0, 10)
    const moved: Item = withTransform({ items: [turned] }, createTransform({ origin: pt(0, 0), position: pt(100, 0) }));
    expect(itemBounds(moved)).toEqual(boundsFromCorners(pt(99.5, -0.5), pt(100.5, 10.5)));
  });

  it("are drawn, mirrored or scaled, where their transform puts them", () => {
    const down = stroke([[0, 0], [0, 50]]);
    const above = withTransform(down, createTransform({ origin: pt(0, 0), position: pt(0, -400), mirror: true })); // from y = -400 up to -450
    const below = withTransform(down, createTransform({ origin: pt(0, 0), position: pt(0, 400), mirror: true })); // from y = 400 up to 350
    expect(selectDrawableSections(placedSections(above), camera, viewport)).toEqual([]);
    expect(selectDrawableSections(placedSections(below), camera, viewport)).toHaveLength(1);
    expect(itemBounds(withTransform(stroke([[0, 0], [10, 20]], 0, 2), createTransform({ origin: pt(0, 0), mirror: true })))).toEqual(
      boundsFromCorners(pt(-1, -21), pt(11, 1)),
    );
    const longer = withTransform(stroke([[0, 0], [10, 0]], 0, 2), createTransform({ origin: pt(0, 0), factor: 1.5 })); // 15 long, 3 thick
    expect(itemsAt([longer], camera, viewport, { x: 654, y: 361.4 })).toEqual([0]);
    expect(itemsAt([longer], camera, viewport, { x: 654, y: 361.6 })).toEqual([]);
  });

  it("are taken by rectangles crossing them where their transform puts them, mirrored or scaled", () => {
    const rect = (x1: number, y1: number, x2: number, y2: number) => worldRectangle(boundsFromCorners(pt(x1, y1), pt(x2, y2)));
    const longer = withTransform(stroke([[0, 0], [100, 0]], 0, 2), createTransform({ origin: pt(0, 0), factor: 1.5 })); // 150 long, 3 thick
    expect(itemsInRectangle([longer], rect(120, 1.4, 130, 5), "touching")).toEqual([0]);
    expect(itemsInRectangle([longer], rect(120, 1.6, 130, 5), "touching")).toEqual([]);
    const up = withTransform(stroke([[0, 0], [50, 50]]), createTransform({ origin: pt(0, 0), mirror: true })); // from (0, 0) to (50, -50)
    expect(itemsInRectangle([up], rect(20, -30, 30, -20), "touching")).toEqual([0]);
    expect(itemsInRectangle([up], rect(20, -30, 30, -20), "inside")).toEqual([]);
    expect(itemsInRectangle([up], rect(-1, -51, 51, 1), "inside")).toEqual([0]);
  });

  it("are clicked, and taken by rectangles, where their transform puts them", () => {
    const line = stroke([[0, 0], [100, 0]], 0, 2);
    const turned = withTransform(line, createTransform({ origin: pt(0, 0), angle: 90 })); // now from (0, 0) down to (0, 100)
    expect(itemsAt([turned], camera, viewport, { x: 640, y: 410 })).toEqual([0]);
    expect(itemsAt([turned], camera, viewport, { x: 690, y: 360 }, 4)).toEqual([]);
    const rect = (x1: number, y1: number, x2: number, y2: number) => worldRectangle(boundsFromCorners(pt(x1, y1), pt(x2, y2)));
    expect(itemsInRectangle([turned], rect(-1, -1, 1, 101), "inside")).toEqual([0]);
    expect(itemsInRectangle([turned], rect(-1, -1, 1, 99), "inside")).toEqual([]);
    expect(itemsInRectangle([turned], rect(1, 40, 5, 60), "touching")).toEqual([0]);
    expect(itemsInRectangle([turned], rect(1.01, 40, 5, 60), "touching")).toEqual([]);
    // mirrored from top to bottom around (0, 0), a stroke going down goes up
    const down = stroke([[0, 0], [0, 50]], 0, 2);
    const up = withTransform(down, createTransform({ origin: pt(0, 0), mirror: true }));
    expect(itemsAt([up], camera, viewport, { x: 640, y: 335 })).toEqual([0]);
    expect(itemsAt([up], camera, viewport, { x: 640, y: 385 })).toEqual([]);
  });

  it("are scaled where their transform puts them, deeper or shallower", () => {
    const line = stroke([[0, 0], [10, 0]], 0, 2);
    const bigger = withTransform(line, createTransform({ origin: pt(0, 0), zLevel: 3 })); // 80 long, 16 thick
    expect(itemsAt([bigger], camera, viewport, { x: 700, y: 367 })).toEqual([0]);
    expect(itemsAt([bigger], camera, viewport, { x: 700, y: 369 })).toEqual([]);
    expect(placedSections(bigger)[0]?.zLevel).toBe(-3);
  });
});

describe("frames", () => {
  it("follow the axes of a turned object, around its content", () => {
    const line = stroke([[0, 0], [100, 0]], 0, 2); // its ink: from (-1, -1) to (101, 1)
    const t = createTransform({ origin: pt(50, 0), position: pt(500, 500), angle: 30 });
    const frame = itemFrame(withTransform(line, t));
    expect(frame?.angle).toBe(330);
    expect(frame?.bounds).toEqual(boundsFromCorners(pt(-51, -1), pt(51, 1)));
    expect(frame && same(rectangleCenter(frame), pt(500, 500))).toBe(true);
    // without a transform, or with several objects: along the world's axes
    expect(itemFrame(line)).toEqual(worldRectangle(boundsFromCorners(pt(-1, -1), pt(101, 1))));
    expect(selectionFrame([line, stroke([[0, 50], [10, 50]])])?.angle).toBe(0);
    expect(selectionFrame([withTransform(line, t)])).toEqual(frame);
  });

  it("follow a mirrored object too", () => {
    const line = stroke([[0, 0], [10, 20]], 0, 2);
    const t = createTransform({ origin: pt(0, 0), mirror: true });
    expect(itemFrame(withTransform(line, t))?.bounds).toEqual(boundsFromCorners(pt(-1, -21), pt(11, 1)));
  });

  it("have their center where the screen shows it", () => {
    const camera = createCamera({ angle: 45, center: pt(20, 0) });
    const frame = itemFrame(stroke([[0, 0], [40, 0]]));
    if (frame === null) throw new Error("a frame expected");
    const center = worldToScreen(camera, viewport, rectangleCenter(frame));
    expect(center.x).toBeCloseTo(640, 9);
    expect(center.y).toBeCloseTo(360, 9);
    // its coordinates are R(90) · (w - origin): the middle (2, 1) of the box is at origin + R(-90) · (2, 1) = (1 + 1, 1 - 2)
    expect(rectangleCenter({ origin: pt(1, 1), angle: 90, bounds: boundsFromCorners(pt(0, 0), pt(4, 2)) })).toEqual(pt(2, -1));
  });
});
