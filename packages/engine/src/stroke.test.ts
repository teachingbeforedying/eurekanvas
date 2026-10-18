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
  convertWidth,
  localToScreen,
  pointWorld,
  projectSection,
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
  /** The camera factor at each event. */
  readonly factors: readonly number[];
  readonly camera: Camera;
}

/** Draws along `path`, zooming around the pointer by `ratio` at every event, with a stroke `widthPixels` thick. */
function draw(
  path: readonly ScreenPoint[],
  ratio: number | ((i: number) => number),
  start = createCamera(),
  widthPixels = 3,
): Drawing {
  const recorder = new StrokeRecorder();
  const exact: Point[] = [];
  const levels: number[] = [];
  const factors: number[] = [];
  let camera = start;
  path.forEach((p, i) => {
    camera = zoomAt(camera, viewport, p, typeof ratio === "number" ? ratio : ratio(i));
    exact.push(screenToWorld(camera, viewport, p));
    levels.push(camera.zLevel);
    factors.push(camera.factor);
    recorder.addScreenPoint(camera, viewport, p, widthPixels);
  });
  return { stroke: recorder.stroke, exact, levels, factors, camera };
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

/** The width of each point, in the same order as `strokeWorldPoints` (each junction counted once). */
function strokeWidths(stroke: Stroke): number[] {
  const widths: number[] = [];
  stroke.sections.forEach((section, sectionIndex) => {
    for (let i = sectionIndex === 0 ? 0 : 1; i < section.points.length; i++) widths.push(at(section.points, i).width);
  });
  return widths;
}

describe("convertWidth", () => {
  it("multiplies by a power of two, exactly", () => {
    expect(convertWidth(0.75, 0, 3)).toBe(6);
    expect(convertWidth(1, 5, 2)).toBe(0.125);
    expect(convertWidth(3, 4, 4)).toBe(3);
    expect(convertWidth(1, 0, 1000)).toBe(2 ** 1000);
  });

  it("refuses a width that would overflow or vanish", () => {
    expect(() => convertWidth(1, 0, 2000)).toThrow(RangeError);
    expect(() => convertWidth(1, 0, -2000)).toThrow(RangeError);
  });
});

describe("StrokeRecorder", () => {
  it("anchors the first section on the first point", () => {
    const recorder = new StrokeRecorder();
    expect(recorder.stroke.sections).toEqual([]);
    recorder.addPoint(pt(5, 7), 0);
    const section = at(recorder.stroke.sections, 0);
    expect(samePoint(section.anchor, pt(5, 7))).toBe(true);
    expect(section.zLevel).toBe(0);
    expect(section.points).toEqual([{ x: 0, y: 0, width: 1 }]);
  });

  it("stores the next points as offsets from the anchor, in local units", () => {
    const atLevel0 = new StrokeRecorder();
    atLevel0.addPoint(pt(5, 7), 0);
    atLevel0.addPoint(pt(8, 5), 0);
    expect(at(atLevel0.stroke.sections, 0).points).toEqual([
      { x: 0, y: 0, width: 1 },
      { x: 3, y: -2, width: 1 },
    ]);

    const atLevel2 = new StrokeRecorder();
    atLevel2.addPoint(pt(5, 7), 2);
    atLevel2.addPoint(pt(8, 5), 2);
    expect(at(atLevel2.stroke.sections, 0).points).toEqual([
      { x: 0, y: 0, width: 1 },
      { x: 12, y: -8, width: 1 }, // 2^2 local units per world unit
    ]);
  });

  it("stores the width of each point", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(0, 0), 0, 2.5);
    recorder.addPoint(pt(1, 0), 0, 4);
    expect(at(recorder.stroke.sections, 0).points.map((p) => p.width)).toEqual([2.5, 4]);
  });

  it("ignores a point at the same position as the previous one, whatever its width", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(5, 7), 0);
    recorder.addPoint(pt(5, 7), 0);
    recorder.addPoint(pt(8, 5), 0, 2);
    recorder.addPoint(pt(8, 5), 0, 5);
    const points = at(recorder.stroke.sections, 0).points;
    expect(points).toHaveLength(2);
    expect(at(points, 1).width).toBe(2); // the repeated point did not change it
  });

  it("starts a new section, anchored exactly on the last point, when the level changes", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(5, 7), 0);
    recorder.addPoint(pt(8, 5), 0);
    recorder.addPoint(pt(8.5, 5), 1);
    expect(recorder.stroke.sections).toHaveLength(2);
    const second = at(recorder.stroke.sections, 1);
    expect(samePoint(second.anchor, pt(8, 5))).toBe(true);
    expect(second.zLevel).toBe(1);
    // 0.5 world unit is 1 local unit at level 1; the junction keeps its width, doubled because the unit is half as big
    expect(second.points).toEqual([
      { x: 0, y: 0, width: 2 },
      { x: 1, y: 0, width: 1 },
    ]);
  });

  it("expresses the width of the junction in the units of the new section, exactly", () => {
    const down = new StrokeRecorder();
    down.addPoint(pt(0, 0), 0, 0.75);
    down.addPoint(pt(1, 0), 0, 0.75);
    down.addPoint(pt(1.25, 0), 3, 0.1);
    expect(at(at(down.stroke.sections, 1).points, 0).width).toBe(0.75 * 8);

    const up = new StrokeRecorder();
    up.addPoint(pt(0, 0), 5, 0.75);
    up.addPoint(pt(1, 0), 5, 0.75);
    up.addPoint(pt(1.25, 0), 2, 0.1);
    expect(at(at(up.stroke.sections, 1).points, 0).width).toBe(0.75 / 8);
  });

  it("does not open a section for a point that is still on the junction", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(5, 7), 0);
    recorder.addPoint(pt(8, 5), 0);
    recorder.addPoint(pt(8, 5), 1);
    expect(recorder.stroke.sections).toHaveLength(1);
    recorder.addPoint(pt(9, 5), 1);
    expect(recorder.stroke.sections).toHaveLength(2);
  });

  it("gives a snapshot that does not move when more points are added", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(0, 0), 0);
    recorder.addPoint(pt(1, 0), 0);
    const snapshot = recorder.stroke;
    recorder.addPoint(pt(2, 0), 0);
    recorder.addPoint(pt(3, 0), 1);
    expect(snapshot.sections).toHaveLength(1);
    expect(at(snapshot.sections, 0).points).toHaveLength(2);
    expect(recorder.stroke.sections).toHaveLength(2);
  });

  it("rejects an invalid level, an invalid width and a point too far to be a number", () => {
    const recorder = new StrokeRecorder();
    expect(() => recorder.addPoint(pt(0, 0), 1.5)).toThrow(RangeError);
    expect(() => recorder.addPoint(pt(0, 0), Number.NaN)).toThrow(RangeError);
    for (const width of [0, -1, Number.NaN, Infinity]) {
      expect(() => recorder.addPoint(pt(0, 0), 0, width)).toThrow(RangeError);
    }
    expect(recorder.stroke.sections).toEqual([]);
    recorder.addPoint(pt(0, 0), 0);
    expect(() => recorder.addPoint({ x: dyadic(1n, -2000), y: fromNumber(0) }, 0)).toThrow(RangeError);
    expect(at(recorder.stroke.sections, 0).points).toHaveLength(1); // nothing was recorded
  });

  it("records nothing when a level jump would make a width overflow", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(0, 0), 0);
    recorder.addPoint(pt(1, 0), 0);
    expect(() => recorder.addPoint(pt(2, 0), 3000)).toThrow(RangeError);
    expect(recorder.stroke.sections).toHaveLength(1);
    expect(at(recorder.stroke.sections, 0).points).toHaveLength(2);
  });

  it("turns a width in screen pixels into local units with the camera factor", () => {
    const recorder = new StrokeRecorder();
    const camera = createCamera({ factor: 1.6 });
    recorder.addScreenPoint(camera, viewport, { x: 100, y: 100 }, 3);
    expect(at(at(recorder.stroke.sections, 0).points, 0).width).toBe(3 / 1.6);
    expect(() => recorder.addScreenPoint(camera, viewport, { x: 101, y: 100 }, 0)).toThrow(RangeError);
  });
});

describe("pointWorld and strokeWorldPoints", () => {
  it("rebuilds exact positions", () => {
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(5, 7), 3);
    recorder.addPoint(pt(5.125, 7.25), 3);
    const section = at(recorder.stroke.sections, 0);
    expect(samePoint(pointWorld(section, 0), pt(5, 7))).toBe(true);
    expect(samePoint(pointWorld(section, 1), pt(5.125, 7.25))).toBe(true);
    expect(() => pointWorld(section, 2)).toThrow(RangeError);
    expect(() => pointWorld(section, -1)).toThrow(RangeError);
  });

  it("lists each junction once", () => {
    const recorder = new StrokeRecorder();
    for (const [x, level] of [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2]] as const) recorder.addPoint(pt(x, 0), level);
    const stroke = recorder.stroke;
    expect(stroke.sections).toHaveLength(3);
    expect(strokeWorldPoints(stroke)).toHaveLength(5);
    expect(strokeWorldPoints({ sections: [] })).toEqual([]);
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

  it("makes one section per level when zooming in, each with at least two points", () => {
    const drawing = draw(circlePath(3000), 1.05);
    expect(drawing.stroke.sections).toHaveLength(drawing.camera.zLevel + 1);
    expect(drawing.stroke.sections.every((s) => s.points.length >= 2)).toBe(true);
    expect(drawing.stroke.sections.map((s) => s.zLevel)).toEqual(Array.from({ length: drawing.camera.zLevel + 1 }, (_, i) => i));
  });

  it("makes one section per level when zooming out too", () => {
    const drawing = draw(circlePath(3000), 1 / 1.05, createCamera({ zLevel: 300 }));
    expect(drawing.camera.zLevel).toBeLessThan(100);
    // the very first event already zooms out of level 300 (a factor of 1/1.05), so the stroke starts at 299
    expect(at(drawing.levels, 0)).toBe(299);
    expect(drawing.stroke.sections).toHaveLength(299 - drawing.camera.zLevel + 1);
    expect(worstReconstructionError(drawing)).toBeLessThan(1e-9);
  });

  it("does not cut the stroke at every zoom step: only the level matters", () => {
    // ratios of 1.05 change the camera factor at every event, but a level lasts about 14 events
    const drawing = draw(circlePath(3000), 1.05);
    expect(drawing.stroke.sections.length).toBeLessThan(drawing.exact.length / 10);
  });

  it("shares each junction exactly between consecutive sections", () => {
    const { stroke } = draw(walkPath(2000, 8), 1.05);
    expect(stroke.sections.length).toBeGreaterThan(100);
    stroke.sections.forEach((section, i) => {
      if (i === 0) return;
      const previous = at(stroke.sections, i - 1);
      const last = at(previous.points, previous.points.length - 1);
      expect(samePoint(section.anchor, pointWorld(previous, previous.points.length - 1))).toBe(true);
      expect(at(section.points, 0)).toMatchObject({ x: 0, y: 0 });
      expect(at(section.points, 0).width).toBe(convertWidth(last.width, previous.zLevel, section.zLevel));
    });
  });

  it("keeps local numbers small however deep the stroke goes", () => {
    for (const drawing of [draw(circlePath(3000), 1.05), draw(walkPath(3000, 9), 1.05)]) {
      let largest = 0;
      for (const section of drawing.stroke.sections) {
        for (const p of section.points) largest = Math.max(largest, Math.abs(p.x), Math.abs(p.y));
      }
      expect(drawing.camera.zLevel).toBeGreaterThan(200);
      expect(largest).toBeLessThan(5000);
    }
  });

  it("keeps the thickness on the screen constant at the moment each point is drawn", () => {
    const drawing = draw(circlePath(3000), 1.05, createCamera(), 3);
    const widths = strokeWidths(drawing.stroke);
    expect(widths).toHaveLength(drawing.exact.length);
    widths.forEach((width, i) => {
      // a local unit is `factor` pixels on the screen when the camera is at the level of the section
      expect(Math.abs(width * at(drawing.factors, i) - 3)).toBeLessThan(1e-12);
    });
  });

  it("makes the thickness vary continuously, with no step when the zoom changes", () => {
    const drawing = draw(circlePath(3000), 1.05, createCamera(), 3);
    const widths = strokeWidths(drawing.stroke);
    // thickness in world units, as a base 2 logarithm: it must shrink by exactly the zoom ratio at every event
    const logWorldWidth = (i: number): number => Math.log2(at(widths, i)) - at(drawing.levels, i);
    for (let i = 1; i < widths.length; i++) {
      expect(logWorldWidth(i) - logWorldWidth(i - 1)).toBeCloseTo(-Math.log2(1.05), 9);
    }
  });

  it("stays exact when the zoom goes back and forth across a level boundary", () => {
    // starting at a scale of 1.9 (level 0), zooming in by 1.1 crosses into level 1, and zooming out comes back
    const drawing = draw(walkPath(300, 10), (i) => (i % 2 === 0 ? 1.1 : 1 / 1.1), createCamera({ factor: 1.9 }));
    expect(drawing.levels.slice(0, 4)).toEqual([1, 0, 1, 0]);
    expect(drawing.stroke.sections.length).toBeGreaterThan(100); // many tiny sections: the cost of the simple rule
    expect(worstReconstructionError(drawing)).toBeLessThan(1e-9);
  });
});

describe("projectSection and localToScreen", () => {
  // drawn before the tests, not while collecting them: a failure here must not hide the other tests
  let drawing: Drawing;
  beforeAll(() => {
    drawing = draw(circlePath(3000), 1.05);
  });

  it("places a section like the exact route does, up to 20 levels away", () => {
    for (const sectionIndex of [0, 40, 120, 200]) {
      const section = at(drawing.stroke.sections, sectionIndex);
      for (const gap of [0, 5, 10, 20]) {
        const center = pointWorld(section, Math.floor(section.points.length / 2));
        const camera = createCamera({ center, zLevel: section.zLevel + gap, factor: 1.3 });
        const projection = projectSection(section, camera, viewport);
        if (projection === null) throw new Error(`section ${sectionIndex} should be projectable at a gap of ${gap}`);
        section.points.forEach((local, i) => {
          const approximate = localToScreen(projection, local);
          const exact = worldToScreen(camera, viewport, pointWorld(section, i));
          expect(Math.abs(approximate.x - exact.x)).toBeLessThan(1e-6);
          expect(Math.abs(approximate.y - exact.y)).toBeLessThan(1e-6);
        });
      }
    }
  });

  it("returns null instead of NaN or Infinity when the section is far from the camera in levels", () => {
    const section = at(drawing.stroke.sections, 0);
    expect(projectSection(section, createCamera({ zLevel: 1100 }), viewport)).toBeNull();
    expect(projectSection(section, createCamera({ zLevel: -1100 }), viewport)).toBeNull();
  });

  it("gives the screen scale of the local unit", () => {
    const section = at(drawing.stroke.sections, 3);
    const projection = projectSection(section, createCamera({ zLevel: section.zLevel + 4, factor: 1.5 }), viewport);
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
      sections: { anchor: { x: unknown; y: unknown }; zLevel: unknown; points: unknown[] }[];
      [extra: string]: unknown;
    };
  }

  it("has the documented shape", () => {
    expect(strokeToJSON(small())).toEqual({
      format: "eurekanvas/stroke",
      version: 1,
      sections: [
        { anchor: { x: "0/2^0", y: "0/2^0" }, zLevel: 0, points: [[0, 0, 1], [1, 0, 1]] },
        { anchor: { x: "1/2^0", y: "0/2^0" }, zLevel: 1, points: [[0, 0, 2], [1, 0, 1], [1.5, 0, 1]] },
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
    expect(strokeFromJSON(JSON.parse(JSON.stringify(strokeToJSON({ sections: [] }))))).toEqual({ sections: [] });
  });

  it("accepts the valid form, and ignores unknown extra fields", () => {
    expect(strokeFromJSON(valid())).toEqual(small());
    const withExtra = valid();
    withExtra["author"] = "someone";
    withExtra.sections.forEach((s) => Object.assign(s, { color: "red" }));
    expect(strokeFromJSON(withExtra)).toEqual(small());
  });

  it("rejects anything that does not match the format", () => {
    const rejected: Record<string, (json: ReturnType<typeof valid>) => void> = {
      "wrong format": (j) => void (j.format = "something/else"),
      "unknown version": (j) => void (j.version = 2),
      "sections is not an array": (j) => void (j.sections = {} as never),
      "non-integer zLevel": (j) => void (at(j.sections, 0).zLevel = 1.5),
      "missing zLevel": (j) => void delete (at(j.sections, 0) as { zLevel?: unknown }).zLevel,
      "no points": (j) => void (at(j.sections, 0).points = []),
      "first point is not at the origin": (j) => void (at(j.sections, 0).points[0] = [1, 0, 1]),
      "point without a width": (j) => void (at(j.sections, 0).points[1] = [1, 0]),
      "point with four numbers": (j) => void (at(j.sections, 0).points[1] = [1, 0, 1, 1]),
      "width of zero": (j) => void (at(j.sections, 0).points[1] = [1, 0, 0]),
      "negative width": (j) => void (at(j.sections, 0).points[1] = [1, 0, -1]),
      "width that is not finite": (j) => void (at(j.sections, 0).points[1] = [1, 0, Number.NaN]),
      "width that is not a number": (j) => void (at(j.sections, 0).points[1] = [1, 0, "1"]),
      "position that is not finite": (j) => void (at(j.sections, 0).points[1] = [Number.NaN, 0, 1]),
      "anchor that is not text": (j) => void (at(j.sections, 0).anchor.x = 0),
      "anchor that is not a dyadic": (j) => void (at(j.sections, 0).anchor.x = "abc"),
      "broken junction": (j) => void (at(j.sections, 1).anchor.x = "7/2^0"),
      "broken junction width": (j) => void (at(j.sections, 1).points[0] = [0, 0, 3]),
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
