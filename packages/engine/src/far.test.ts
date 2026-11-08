import { describe, expect, it } from "vitest";
import { type Camera, type Point, type ScreenPoint, type Viewport, createCamera, worldToScreen } from "./camera";
import { add, dyadic, fromNumber, shift } from "./dyadic";
import { farOutline } from "./far";
import type { PathCommand } from "./outline";
import { type PlacedSection, placeSection, placedAlone } from "./placement";
import { type LocalPoint, type Section, StrokeRecorder, pointWorld } from "./stroke";
import { type Transform, applyTransform, createTransform } from "./transform";
import { at, createRandom } from "./test-utils";

// The middle of the screen is at (640, 360).
const viewport: Viewport = { width: 1280, height: 720 };
const DEPTHS = [20, 60, 300, 1000];

function pt(x: number, y: number): Point {
  return { x: fromNumber(x), y: fromNumber(y) };
}

function section(points: readonly (readonly [number, number, number])[], zLevel = 0): Section {
  const recorder = new StrokeRecorder();
  for (const [x, y, width] of points) recorder.addPoint(pt(x, y), zLevel, width);
  return at(recorder.stroke.sections, 0);
}

/** The polygons of an outline. */
function polygons(commands: readonly PathCommand[]): ScreenPoint[][] {
  const all: ScreenPoint[][] = [];
  for (const command of commands) {
    if (command.type === "M") all.push([{ x: command.x, y: command.y }]);
    else if (command.type === "L") at(all, all.length - 1).push({ x: command.x, y: command.y });
    else if (command.type === "A") throw new Error("no arc expected");
  }
  return all;
}

function area(polygon: readonly ScreenPoint[]): number {
  return polygon.reduce((sum, p, i) => {
    const q = at(polygon, (i + 1) % polygon.length);
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;
}

/** Whether a point is inside one of the polygons, which are convex and all turn the same way. */
function inked(commands: readonly PathCommand[], p: ScreenPoint): boolean {
  return polygons(commands).some((polygon) => {
    const direction = Math.sign(area(polygon));
    return polygon.every((a, i) => {
      const b = at(polygon, (i + 1) % polygon.length);
      return direction * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0;
    });
  });
}

/** Tells that the edge goes through `p`: ink on the side opposite to the unit normal `n`, none on its side. */
function expectEdge(commands: readonly PathCommand[], p: ScreenPoint, n: ScreenPoint): void {
  const along = (d: number): ScreenPoint => ({ x: p.x + n.x * d, y: p.y + n.y * d });
  expect(inked(commands, along(-0.001))).toBe(true);
  expect(inked(commands, along(0.001))).toBe(false);
  expect(inked(commands, along(-150))).toBe(true);
  expect(inked(commands, along(150))).toBe(false);
}

/** A camera at `center` plus `(dx, dy)` pixels at this depth, so that the point `center` is at `(-dx, -dy)` from the middle. */
function deep(center: Point, zLevel: number, dx = 0, dy = 0, options: { angle?: number; mirror?: boolean } = {}): Camera {
  return createCamera({
    center: { x: add(center.x, shift(fromNumber(dx), -zLevel)), y: add(center.y, shift(fromNumber(dy), -zLevel)) },
    zLevel,
    ...options,
  });
}

/** The whole part of the square root of `n`, bit by bit. */
function integerRoot(n: bigint): bigint {
  let root = 0n;
  for (let bit = 1n << BigInt(n.toString(2).length >> 1); bit > 0n; bit >>= 1n) {
    if ((root + bit) * (root + bit) <= n) root += bit;
  }
  return root;
}

describe("farOutline", () => {
  const horizontal = placedAlone(section([[-1000, 0, 2], [1000, 0, 2]])); // its ink: 1 unit on each side of y = 0

  it("puts the edge of a stroke exactly where it is, at any depth", () => {
    for (const level of DEPTHS) {
      // the bottom edge, y = 1, is 100 pixels above the middle
      const outline = farOutline(horizontal, deep(pt(0, 1), level, 0, 100), viewport);
      expectEdge(outline, { x: 640, y: 260 }, { x: 0, y: 1 });
    }
  });

  it("puts a slanted edge exactly where it is, at any depth", () => {
    // a line of direction (3, 4) and half-thickness 5: its edge goes through (-4, 3), with the normal (-0.8, 0.6)
    const diagonal = placedAlone(section([[-3000, -4000, 10], [3000, 4000, 10]]));
    for (const level of DEPTHS) expectEdge(farOutline(diagonal, deep(pt(-4, 3), level), viewport), { x: 640, y: 360 }, { x: -0.8, y: 0.6 });
  });

  it("finds the tangents of a tapered capsule, at any depth", () => {
    // d = 5000, r1 - r2 = 3000: the normals are (0.6, ±0.8), from (2400, ±3200) on the large disc to (5600, ±800) on the small one
    const tapered = placedAlone(section([[0, 0, 8000], [5000, 0, 2000]]));
    for (const level of DEPTHS) {
      for (const side of [1, -1]) {
        expectEdge(farOutline(tapered, deep(pt(2400, side * 3200), level), viewport), { x: 640, y: 360 }, { x: 0.6, y: side * 0.8 });
        // halfway, where only the tangent can tell
        expectEdge(farOutline(tapered, deep(pt(4000, side * 2000), level), viewport), { x: 640, y: 360 }, { x: 0.6, y: side * 0.8 });
      }
    }
  });

  it("finds a tangent of irrational length, between two large discs close together", () => {
    // d = 2, r1 - r2 = 1: the normal is (1/2, √3/2), and between the discs the tangent is at y = (2000 - x) / √3
    const close = placedAlone(section([[0, 0, 2000], [2, 0, 1998]]));
    for (const level of DEPTHS) {
      const bits = level + 64;
      const root = integerRoot(3n << BigInt(2 * bits));
      for (const quarters of [2001, 2002, 2003, 2004, 2005]) {
        // x = quarters / 4, so 2000 - x = (8000 - quarters) / 4
        const y = dyadic((BigInt(8000 - quarters) << BigInt(2 * bits - 2)) / root, bits);
        expectEdge(farOutline(close, deep({ x: fromNumber(quarters / 4), y }, level), viewport), { x: 640, y: 360 }, { x: 0.5, y: Math.sqrt(3) / 2 });
      }
    }
  });

  it("tells the round ends of a tapered capsule apart, in both directions", () => {
    // a radius of 50 at x = 0, and of 10 at x = 1000
    const strokes = [placedAlone(section([[0, 0, 100], [1000, 0, 20]])), placedAlone(section([[1000, 0, 20], [0, 0, 100]]))];
    for (const level of DEPTHS) {
      for (const tapered of strokes) {
        expect(polygons(farOutline(tapered, deep(pt(-30, 0), level), viewport))).toHaveLength(1);
        expect(polygons(farOutline(tapered, deep(pt(1005, 0), level), viewport))).toHaveLength(1);
        expect(farOutline(tapered, deep(pt(1015, 0), level), viewport)).toEqual([]);
        expect(farOutline(tapered, deep(pt(-49.5, 8), level), viewport)).toEqual([]);
      }
    }
  });

  it("keeps the larger disc when one contains the other", () => {
    // a disc of radius 500 around (1, 0), and one of radius 1 around the origin, inside it
    const strokes = [placedAlone(section([[0, 0, 2], [1, 0, 1000]])), placedAlone(section([[1, 0, 1000], [0, 0, 2]]))];
    for (const level of DEPTHS) {
      for (const pair of strokes) {
        expectEdge(farOutline(pair, deep(pt(501, 0), level), viewport), { x: 640, y: 360 }, { x: 1, y: 0 });
        expect(polygons(farOutline(pair, deep(pt(300, 0), level), viewport))).toHaveLength(1);
        expect(farOutline(pair, deep(pt(450, 300), level), viewport)).toEqual([]); // inside the box of the section
      }
    }
  });

  it("draws a gently curved edge as it is, not as its tangent", () => {
    // a radius of 5000 × 2^4 = 80000 pixels: 300 pixels along the tangent, the disc is 0.5625 pixels behind it
    const outline = farOutline(placedAlone(section([[0, 0, 10000]])), deep(pt(3000, 4000), 4), viewport);
    for (const side of [1, -1]) {
      const inward = (d: number): ScreenPoint => ({ x: 640 - side * 240 - 0.6 * d, y: 360 + side * 180 - 0.8 * d });
      expect(inked(outline, inward(0.2))).toBe(false);
      expect(inked(outline, inward(1))).toBe(true);
    }
  });

  it("does not take the prolongation of a capsule for its ink", () => {
    // (250, 0) is on the line of the first capsule, far beyond its end, and inside the box of the section
    const zigzag = placedAlone(section([[0, 0, 2], [100, 0, 2], [200, 100, 2], [300, 0, 2]]));
    for (const level of DEPTHS) expect(farOutline(zigzag, deep(pt(250, 0), level), viewport)).toEqual([]);
  });

  it("is a single polygon when the whole screen is inside several capsules", () => {
    const joined = placedAlone(section([[-1000, 0, 2], [0, 0, 2], [1000, 0, 2]]));
    for (const level of DEPTHS) expect(polygons(farOutline(joined, deep(pt(0, 0.5), level), viewport))).toHaveLength(1);
  });

  it("keeps a corner of the screen cut by an edge", () => {
    // the slanted edge, 700 pixels from the middle towards the top right corner, which is 730.8 pixels away that way
    const diagonal = placedAlone(section([[-3000, -4000, 10], [3000, 4000, 10]]));
    for (const level of DEPTHS) {
      const outline = farOutline(diagonal, deep(pt(-4, 3), level, -560, 420), viewport);
      expect(polygons(outline).map((polygon) => polygon.length)).toEqual([3]);
      expect(inked(outline, { x: 1275, y: 5 })).toBe(true);
      expect(inked(outline, { x: 640, y: 360 })).toBe(false);
    }
  });

  it("finds the edge of a round end, from gently curved to straight, at any depth", () => {
    // a disc of radius 5000 goes through (3000, 4000), with the normal (0.6, 0.8)
    const disc = placedAlone(section([[0, 0, 10000]]));
    for (const level of [10, ...DEPTHS]) expectEdge(farOutline(disc, deep(pt(3000, 4000), level), viewport), { x: 640, y: 360 }, { x: 0.6, y: 0.8 });
    // 100 pixels from the middle of the screen, a distance that floats lose next to the radius
    for (const level of DEPTHS) expectEdge(farOutline(disc, deep(pt(3000, 4000), level, 60, 80), viewport), { x: 580, y: 280 }, { x: 0.6, y: 0.8 });
    // and the round end of a stroke: beyond the end (1000, 0) of a stroke of radius 1, seen head on
    for (const level of DEPTHS) expectEdge(farOutline(horizontal, deep(pt(1001, 0), level), viewport), { x: 640, y: 360 }, { x: 1, y: 0 });
  });

  it("keeps the side of the round end it is on", () => {
    // beyond the first end of a capsule, in the direction it does not face, nothing is drawn by the arc of the other end
    const capsule = placedAlone(section([[0, 0, 2], [10, 0, 2]]));
    const outline = farOutline(capsule, deep(pt(-1, 0), 40), viewport);
    expectEdge(outline, { x: 640, y: 360 }, { x: -1, y: 0 });
  });

  it("is the whole screen from inside the ink, and nothing from outside it", () => {
    for (const level of DEPTHS) {
      const inside = polygons(farOutline(horizontal, deep(pt(0, 0.5), level), viewport));
      expect(inside).toHaveLength(1);
      expect(at(inside, 0)).toEqual([{ x: -2, y: -2 }, { x: 1282, y: -2 }, { x: 1282, y: 722 }, { x: -2, y: 722 }]);
      expect(farOutline(horizontal, deep(pt(0, 1.5), level), viewport)).toEqual([]);
      expect(farOutline(horizontal, deep(pt(2000, 0), level), viewport)).toEqual([]);
    }
  });

  it("tells apart an edge just off the screen, on either side", () => {
    const level = 200;
    // the bottom edge, 5 pixels below the screen: all of the screen is ink
    const under = farOutline(horizontal, deep(pt(0, 1), level, 0, -365), viewport);
    expect(inked(under, { x: 640, y: 715 })).toBe(true);
    expect(inked(under, { x: 10, y: 10 })).toBe(true);
    // the same edge, 5 pixels above the screen: none of it is
    expect(farOutline(horizontal, deep(pt(0, 1), level, 0, 365), viewport)).toEqual([]);
  });

  it("gives only small numbers, all the contours turning the same way", () => {
    for (const level of DEPTHS) {
      for (const offset of [0, 200, -300]) {
        const shape = placedAlone(section([[0, 0, 20], [300, 400, 40], [700, 100, 10]]));
        const outline = farOutline(shape, deep(pt(150, 200), level, offset, 2 * offset, { angle: 37 }), viewport);
        for (const command of outline) {
          if (command.type === "Z") continue;
          expect(command.type === "A").toBe(false);
          if (command.type === "A") continue;
          expect(command.x).toBeGreaterThanOrEqual(-2);
          expect(command.x).toBeLessThanOrEqual(1282);
          expect(command.y).toBeGreaterThanOrEqual(-2);
          expect(command.y).toBeLessThanOrEqual(722);
        }
        const areas = polygons(outline).map(area);
        expect(new Set(areas.map(Math.sign)).size).toBeLessThanOrEqual(1);
      }
    }
  });

  it("follows a turned and a mirrored view", () => {
    for (const level of DEPTHS) {
      // the bottom edge is 100 world pixels above the center of the view
      const camera = (options: { angle?: number; mirror?: boolean }) => deep(pt(0, 1), level, 0, 100, options);
      // turned by 90°: a world offset (x, y) appears at (-y, x): the edge is at x = 640 + 100, the ink beyond it
      expectEdge(farOutline(horizontal, camera({ angle: 90 }), viewport), { x: 740, y: 360 }, { x: -1, y: 0 });
      // mirrored: the edge is 100 pixels below the middle, the ink below it
      expectEdge(farOutline(horizontal, camera({ mirror: true }), viewport), { x: 640, y: 460 }, { x: 0, y: -1 });
      // both: the turn comes after the mirror
      expectEdge(farOutline(horizontal, camera({ angle: 90, mirror: true }), viewport), { x: 540, y: 360 }, { x: 1, y: 0 });
    }
  });

  it("follows the transform of the object", () => {
    const line = section([[-1000, 0, 2], [1000, 0, 2]]);
    for (const level of DEPTHS) {
      // turned by 90° around the origin: the line goes along y, its side x = -1 is the bottom edge turned
      const turned = placeSection(line, createTransform({ origin: pt(0, 0), angle: 90 }));
      expectEdge(farOutline(turned, deep(pt(-1, 0), level), viewport), { x: 640, y: 360 }, { x: -1, y: 0 });
      // moved, and scaled by 1.5: half a thickness of 1.5 world units
      const scaled = placeSection(line, createTransform({ origin: pt(0, 0), position: pt(10, 20), factor: 1.5 }));
      expectEdge(farOutline(scaled, deep(pt(10, 21.5), level), viewport), { x: 640, y: 360 }, { x: 0, y: 1 });
      // mirrored: y = 1 of the object is at y = -1 in the world, and the ink is above it (y > -1)
      const mirrored = placeSection(line, createTransform({ origin: pt(0, 0), mirror: true }));
      expectEdge(farOutline(mirrored, deep(pt(0, -1), level), viewport), { x: 640, y: 360 }, { x: 0, y: -1 });
    }
  });

  it("finds the middle of the screen in a transformed object, away from its origin", () => {
    // a corner: its right edge goes through (2001, 550), with the normal (1, 0). The section is anchored at its first point.
    const away = section([[1000, 50, 2], [2000, 50, 2], [2000, 1050, 2]]);
    for (const level of DEPTHS) {
      // turned by 90°: (x, y) is at (-y, x) in the world
      const turned = placeSection(away, createTransform({ origin: pt(0, 0), angle: 90 }));
      expectEdge(farOutline(turned, deep(pt(-550, 2001), level), viewport), { x: 640, y: 360 }, { x: 0, y: 1 });
      // mirrored: (x, y) is at (x, -y) in the world
      const mirrored = placeSection(away, createTransform({ origin: pt(0, 0), mirror: true }));
      expectEdge(farOutline(mirrored, deep(pt(2001, -550), level), viewport), { x: 640, y: 360 }, { x: 1, y: 0 });
      // scaled by 1.5 (a power of 2 would only change its level)
      const scaled = placeSection(away, createTransform({ origin: pt(0, 0), factor: 1.5 }));
      expectEdge(farOutline(scaled, deep(pt(3001.5, 825), level), viewport), { x: 640, y: 360 }, { x: 1, y: 0 });
    }
  });

  it("agrees with the shape computed directly, for any view and transform, at a depth where floats still can", () => {
    const random = createRandom(51);
    const inHull = (p: ScreenPoint, a: LocalPoint, b: LocalPoint): number => {
      // the signed distance to the union of the discs swept along the segment, searched along it
      let best = Infinity;
      for (let t = 0; t <= 1; t += 1 / 20000) {
        const d = Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t)) - (a.width + (b.width - a.width) * t) / 2;
        if (d < best) best = d;
      }
      return best;
    };
    for (let round = 0; round < 12; round++) {
      const source = section([[0, 0, 30 + random.next() * 40], [200 + random.next() * 100, 100 * random.next(), 30 + random.next() * 40]]);
      const t: Transform = createTransform({
        origin: pt(0, 0),
        position: pt(random.next() * 50, random.next() * 50),
        angle: random.next() * 360,
        mirror: random.next() < 0.5,
        factor: 1 + random.next(),
        zLevel: random.int(4) - 2,
      });
      const placed: PlacedSection = placeSection(source, t);
      const worldA = applyTransform(t, pointWorld(source, 0));
      const camera = createCamera({
        center: { x: add(worldA.x, shift(fromNumber(random.next() * 400), -14)), y: add(worldA.y, shift(fromNumber(random.next() * 400), -14)) },
        zLevel: 14,
        factor: 1 + random.next(),
        angle: random.next() * 360,
        mirror: random.next() < 0.5,
      });
      const outline = farOutline(placed, camera, viewport);
      const scale = 2 ** camera.zLevel * camera.factor * t.factor * 2 ** t.zLevel;
      const onScreen = (i: number): LocalPoint => {
        const p = worldToScreen(camera, viewport, applyTransform(t, pointWorld(source, i)));
        return { x: p.x, y: p.y, width: at(source.points, i).width * scale };
      };
      const [a, b] = [onScreen(0), onScreen(1)];
      for (let i = 0; i < 40; i++) {
        const p = { x: random.next() * 1280, y: random.next() * 720 };
        const distance = inHull(p, a, b);
        if (Math.abs(distance) < 2) continue; // the search along the segment is not precise enough so close to the edge
        expect(inked(outline, p)).toBe(distance < 0);
      }
    }
  });
});
