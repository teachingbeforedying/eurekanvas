import { beforeAll, describe, expect, it } from "vitest";
import {
  type Camera,
  type Point,
  type ScreenPoint,
  type Viewport,
  createCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from "./camera";
import { dyadic, equals, fromNumber, shift, sub, toNumber } from "./dyadic";
import {
  type Stroke,
  StrokeRecorder,
  localToScreen,
  pointWorld,
  projectBout,
  strokeFromJSON,
  strokeToJSON,
  strokeWorldPoints,
} from "./stroke";
import { at, createRandom } from "./test-utils";

const viewport: Viewport = { width: 1280, height: 720 };

function pt(x: number, y: number): Point {
  return { x: fromNumber(x), y: fromNumber(y) };
}

function samePoint(a: Point, b: Point): boolean {
  return equals(a.x, b.x) && equals(a.y, b.y);
}

/** A pointer going round a circle of 200 pixels, 10 pixels per event. */
function circlePath(events: number): ScreenPoint[] {
  return Array.from({ length: events }, (_, i) => ({
    x: 640 + 200 * Math.cos(i * 0.05),
    y: 360 + 200 * Math.sin(i * 0.05),
  }));
}

/**
 * A pointer wandering inside the screen, moving up to 60 pixels per event.
 * An event that leaves the pointer exactly where it was (it can stick to a corner) is dropped:
 * the recorder would ignore it anyway.
 */
function walkPath(events: number, seed: number): ScreenPoint[] {
  const random = createRandom(seed);
  const path: ScreenPoint[] = [];
  let x = 640;
  let y = 360;
  for (let i = 0; i < events; i++) {
    const nextX = Math.min(1279, Math.max(0, x + (random.next() - 0.5) * 120));
    const nextY = Math.min(719, Math.max(0, y + (random.next() - 0.5) * 120));
    if (nextX !== x || nextY !== y) path.push({ x: nextX, y: nextY });
    x = nextX;
    y = nextY;
  }
  return path;
}

interface Drawing {
  readonly stroke: Stroke;
  /** The exact world point under the pointer at each event. */
  readonly exact: readonly Point[];
  /** The camera level at each event. */
  readonly levels: readonly number[];
  readonly camera: Camera;
}

/** Draws along `path`, zooming around the pointer by `ratio` at every event. */
function draw(path: readonly ScreenPoint[], ratio: number | ((i: number) => number), start = createCamera()): Drawing {
  const recorder = new StrokeRecorder();
  const exact: Point[] = [];
  const levels: number[] = [];
  let camera = start;
  path.forEach((p, i) => {
    camera = zoomAt(camera, viewport, p, typeof ratio === "number" ? ratio : ratio(i));
    exact.push(screenToWorld(camera, viewport, p));
    levels.push(camera.zLevel);
    recorder.addScreenPoint(camera, viewport, p);
  });
  return { stroke: recorder.stroke, exact, levels, camera };
}

/** The largest gap between the point under the pointer and the recorded one, in local units. */
function worstReconstructionError(drawing: Drawing): number {
  const rebuilt = strokeWorldPoints(drawing.stroke);
  expect(rebuilt).toHaveLength(drawing.exact.length);
  let worst = 0;
  rebuilt.forEach((r, i) => {
    const w = at(drawing.exact, i);
    const level = at(drawing.levels, i);
    worst = Math.max(
      worst,
      Math.abs(toNumber(shift(sub(r.x, w.x), level))),
      Math.abs(toNumber(shift(sub(r.y, w.y), level))),
    );
  });
  return worst;
}

describe("StrokeRecorder", () => {
  it("anchors the first bout on the first point", () => {
    const recorder = new StrokeRecorder();
    expect(recorder.stroke.bouts).toEqual([]);
    recorder.addPoint(pt(5, 7), 0);
    const bout = at(recorder.stroke.bouts, 0);
    expect(samePoint(bout.anchor, pt(5, 7))).toBe(true);
    expect(bout.zLevel).toBe(0);
    expect(bout.points).toEqual([{ x: 0, y: 0 }]);
  });

  it("stores the next points as offsets from the anchor, in local units", () => {
    const atLevel0 = new StrokeRecorder();
    atLevel0.addPoint(pt(5, 7), 0);
    atLevel0.addPoint(pt(8, 5), 0);
    expect(at(atLevel0.stroke.bouts, 0).points).toEqual([{ x: 0, y: 0 }, { x: 3, y: -2 }]);

    const atLevel2 = new StrokeRecorder();
    atLevel2.addPoint(pt(5, 7), 2);
    atLevel2.addPoint(pt(8, 5), 2);
    expect(at(atLevel2.stroke.bouts, 0).points).toEqual([{ x: 0, y: 0 }, { x: 12, y: -8 }]); // 2^2 local units per world unit
  });

  it("ignores a point identical to the previous one", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(5, 7), 0);
    recorder.addPoint(pt(5, 7), 0);
    recorder.addPoint(pt(8, 5), 0);
    recorder.addPoint(pt(8, 5), 0);
    expect(at(recorder.stroke.bouts, 0).points).toHaveLength(2);
  });

  it("starts a new bout, anchored exactly on the last point, when the level changes", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(5, 7), 0);
    recorder.addPoint(pt(8, 5), 0);
    recorder.addPoint(pt(8.5, 5), 1);
    const [first, second] = recorder.stroke.bouts;
    expect(recorder.stroke.bouts).toHaveLength(2);
    expect(samePoint(at([first, second].flatMap((b) => (b ? [b.anchor] : [])), 1), pt(8, 5))).toBe(true);
    expect(second?.zLevel).toBe(1);
    expect(second?.points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]); // 0.5 world unit at level 1
  });

  it("does not open a bout for a point that is still on the junction", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(5, 7), 0);
    recorder.addPoint(pt(8, 5), 0);
    recorder.addPoint(pt(8, 5), 1);
    expect(recorder.stroke.bouts).toHaveLength(1);
    recorder.addPoint(pt(9, 5), 1);
    expect(recorder.stroke.bouts).toHaveLength(2);
  });

  it("gives a snapshot that does not move when more points are added", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(0, 0), 0);
    recorder.addPoint(pt(1, 0), 0);
    const snapshot = recorder.stroke;
    recorder.addPoint(pt(2, 0), 0);
    recorder.addPoint(pt(3, 0), 1);
    expect(snapshot.bouts).toHaveLength(1);
    expect(at(snapshot.bouts, 0).points).toHaveLength(2);
    expect(recorder.stroke.bouts).toHaveLength(2);
  });

  it("rejects an invalid level and a point too far to be a number", () => {
    const recorder = new StrokeRecorder();
    expect(() => recorder.addPoint(pt(0, 0), 1.5)).toThrow(RangeError);
    expect(() => recorder.addPoint(pt(0, 0), Number.NaN)).toThrow(RangeError);
    recorder.addPoint(pt(0, 0), 0);
    expect(() => recorder.addPoint({ x: dyadic(1n, -2000), y: fromNumber(0) }, 0)).toThrow(RangeError);
    expect(at(recorder.stroke.bouts, 0).points).toHaveLength(1); // nothing was recorded
  });
});

describe("pointWorld and strokeWorldPoints", () => {
  it("rebuilds exact positions", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(5, 7), 3);
    recorder.addPoint(pt(5.125, 7.25), 3);
    const bout = at(recorder.stroke.bouts, 0);
    expect(samePoint(pointWorld(bout, 0), pt(5, 7))).toBe(true);
    expect(samePoint(pointWorld(bout, 1), pt(5.125, 7.25))).toBe(true);
    expect(() => pointWorld(bout, 2)).toThrow(RangeError);
    expect(() => pointWorld(bout, -1)).toThrow(RangeError);
  });

  it("lists each junction once", () => {
    const recorder = new StrokeRecorder();
    for (const [x, level] of [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2]] as const) recorder.addPoint(pt(x, 0), level);
    const stroke = recorder.stroke;
    expect(stroke.bouts).toHaveLength(3);
    expect(strokeWorldPoints(stroke)).toHaveLength(5);
    expect(strokeWorldPoints({ bouts: [] })).toEqual([]);
  });
});

describe("drawing while zooming", () => {
  it("keeps the shape of a stroke drawn through 211 levels of zoom (circle)", () => {
    const drawing = draw(circlePath(3000), 1.05);
    expect(drawing.camera.zLevel).toBeGreaterThan(200);
    expect(worstReconstructionError(drawing)).toBeLessThan(1e-9);
  });

  it("keeps the shape of a stroke drawn through 211 levels of zoom (wandering pointer)", () => {
    const drawing = draw(walkPath(3000, 7), 1.05);
    expect(drawing.camera.zLevel).toBeGreaterThan(200);
    expect(worstReconstructionError(drawing)).toBeLessThan(1e-9);
  });

  it("makes one bout per level when zooming in, each with at least two points", () => {
    const drawing = draw(circlePath(3000), 1.05);
    expect(drawing.stroke.bouts).toHaveLength(drawing.camera.zLevel + 1);
    expect(drawing.stroke.bouts.every((b) => b.points.length >= 2)).toBe(true);
    expect(drawing.stroke.bouts.map((b) => b.zLevel)).toEqual(Array.from({ length: drawing.camera.zLevel + 1 }, (_, i) => i));
  });

  it("makes one bout per level when zooming out too", () => {
    const drawing = draw(circlePath(3000), 1 / 1.05, createCamera({ zLevel: 300 }));
    expect(drawing.camera.zLevel).toBeLessThan(100);
    // the very first event already zooms out of level 300 (a factor of 1/1.05), so the stroke starts at 299
    expect(at(drawing.levels, 0)).toBe(299);
    expect(drawing.stroke.bouts).toHaveLength(299 - drawing.camera.zLevel + 1);
    expect(worstReconstructionError(drawing)).toBeLessThan(1e-9);
  });

  it("shares each junction exactly between consecutive bouts", () => {
    const { stroke } = draw(walkPath(2000, 8), 1.05);
    expect(stroke.bouts.length).toBeGreaterThan(100);
    stroke.bouts.forEach((bout, i) => {
      if (i === 0) return;
      const previous = at(stroke.bouts, i - 1);
      expect(samePoint(bout.anchor, pointWorld(previous, previous.points.length - 1))).toBe(true);
      expect(bout.points[0]).toEqual({ x: 0, y: 0 });
    });
  });

  it("keeps local numbers small however deep the stroke goes", () => {
    for (const drawing of [draw(circlePath(3000), 1.05), draw(walkPath(3000, 9), 1.05)]) {
      let largest = 0;
      for (const bout of drawing.stroke.bouts) {
        for (const p of bout.points) largest = Math.max(largest, Math.abs(p.x), Math.abs(p.y));
      }
      expect(drawing.camera.zLevel).toBeGreaterThan(200);
      expect(largest).toBeLessThan(5000);
    }
  });

  it("stays exact when the zoom goes back and forth across a level boundary", () => {
    // starting at a scale of 1.9 (level 0), zooming in by 1.1 crosses into level 1, and zooming out comes back
    const drawing = draw(walkPath(300, 10), (i) => (i % 2 === 0 ? 1.1 : 1 / 1.1), createCamera({ factor: 1.9 }));
    expect(drawing.levels.slice(0, 4)).toEqual([1, 0, 1, 0]);
    expect(drawing.stroke.bouts.length).toBeGreaterThan(100); // many tiny bouts: the cost of the simple rule
    expect(worstReconstructionError(drawing)).toBeLessThan(1e-9);
  });
});

describe("projectBout and localToScreen", () => {
  // drawn before the tests, not while collecting them: a failure here must not hide the other tests
  let drawing: Drawing;
  beforeAll(() => {
    drawing = draw(circlePath(3000), 1.05);
  });

  it("places a bout like the exact route does, up to 20 levels away", () => {
    for (const boutIndex of [0, 40, 120, 200]) {
      const bout = at(drawing.stroke.bouts, boutIndex);
      for (const gap of [0, 5, 10, 20]) {
        const center = pointWorld(bout, Math.floor(bout.points.length / 2));
        const camera = createCamera({ center, zLevel: bout.zLevel + gap, factor: 1.3 });
        const projection = projectBout(bout, camera, viewport);
        if (projection === null) throw new Error(`bout ${boutIndex} should be projectable at a gap of ${gap}`);
        bout.points.forEach((local, i) => {
          const approximate = localToScreen(projection, local);
          const exact = worldToScreen(camera, viewport, pointWorld(bout, i));
          expect(Math.abs(approximate.x - exact.x)).toBeLessThan(1e-6);
          expect(Math.abs(approximate.y - exact.y)).toBeLessThan(1e-6);
        });
      }
    }
  });

  it("returns null instead of NaN or Infinity when the bout is far from the camera in levels", () => {
    const bout = at(drawing.stroke.bouts, 0);
    expect(projectBout(bout, createCamera({ zLevel: 1100 }), viewport)).toBeNull();
    expect(projectBout(bout, createCamera({ zLevel: -1100 }), viewport)).toBeNull();
  });

  it("gives the screen scale of the local unit", () => {
    const bout = at(drawing.stroke.bouts, 3);
    const projection = projectBout(bout, createCamera({ zLevel: bout.zLevel + 4, factor: 1.5 }), viewport);
    expect(projection?.scale).toBe(2 ** 4 * 1.5);
  });
});

describe("JSON form", () => {
  function small(): Stroke {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(0, 0), 0);
    recorder.addPoint(pt(1, 0), 0);
    recorder.addPoint(pt(1.5, 0), 1);
    recorder.addPoint(pt(1.75, 0), 1);
    return recorder.stroke;
  }

  /** A fresh, mutable copy of the valid JSON form of `small()`. */
  function valid() {
    return JSON.parse(JSON.stringify(strokeToJSON(small()))) as {
      format: unknown;
      version: unknown;
      bouts: { anchor: { x: unknown; y: unknown }; zLevel: unknown; points: unknown[] }[];
      [extra: string]: unknown;
    };
  }

  it("has the documented shape", () => {
    expect(strokeToJSON(small())).toEqual({
      format: "eurekanvas/stroke",
      version: 1,
      bouts: [
        { anchor: { x: "0/2^0", y: "0/2^0" }, zLevel: 0, points: [[0, 0], [1, 0]] },
        { anchor: { x: "1/2^0", y: "0/2^0" }, zLevel: 1, points: [[0, 0], [1, 0], [1.5, 0]] },
      ],
    });
  });

  it("round-trips a stroke drawn through 687 levels, through real JSON text", () => {
    const drawing = draw(circlePath(5000), 1.1);
    expect(drawing.camera.zLevel).toBeGreaterThan(680);
    const text = JSON.stringify(strokeToJSON(drawing.stroke)); // would throw if a BigInt slipped in
    expect(strokeFromJSON(JSON.parse(text))).toEqual(drawing.stroke);
  });

  it("round-trips an empty stroke", () => {
    expect(strokeFromJSON(JSON.parse(JSON.stringify(strokeToJSON({ bouts: [] }))))).toEqual({ bouts: [] });
  });

  it("accepts the valid form, and ignores unknown extra fields", () => {
    expect(strokeFromJSON(valid())).toEqual(small());
    const withExtra = valid();
    withExtra["author"] = "someone";
    withExtra.bouts.forEach((b) => Object.assign(b, { color: "red" }));
    expect(strokeFromJSON(withExtra)).toEqual(small());
  });

  it("rejects anything that does not match the format", () => {
    const rejected: Record<string, (json: ReturnType<typeof valid>) => void> = {
      "wrong format": (j) => void (j.format = "something/else"),
      "unknown version": (j) => void (j.version = 2),
      "bouts is not an array": (j) => void (j.bouts = {} as never),
      "non-integer zLevel": (j) => void (at(j.bouts, 0).zLevel = 1.5),
      "missing zLevel": (j) => void delete (at(j.bouts, 0) as { zLevel?: unknown }).zLevel,
      "no points": (j) => void (at(j.bouts, 0).points = []),
      "first point is not the origin": (j) => void (at(j.bouts, 0).points[0] = [1, 0]),
      "point with three numbers": (j) => void (at(j.bouts, 0).points[1] = [1, 0, 0]),
      "point that is not finite": (j) => void (at(j.bouts, 0).points[1] = [Number.NaN, 0]),
      "anchor that is not text": (j) => void (at(j.bouts, 0).anchor.x = 0),
      "anchor that is not a dyadic": (j) => void (at(j.bouts, 0).anchor.x = "abc"),
      "broken junction": (j) => void (at(j.bouts, 1).anchor.x = "7/2^0"),
    };
    for (const [name, corrupt] of Object.entries(rejected)) {
      const json = valid();
      corrupt(json);
      expect(() => strokeFromJSON(json), name).toThrow(SyntaxError);
    }
    for (const notAnObject of [null, 5, "text", [], undefined]) {
      expect(() => strokeFromJSON(notAnObject)).toThrow(SyntaxError);
    }
  });
});
