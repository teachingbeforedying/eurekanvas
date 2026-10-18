import { describe, expect, it } from "vitest";
import { type OutlinePoint, type PathCommand, strokeOutline } from "./outline";
import { at, createRandom } from "./test-utils";

type XY = readonly [number, number];

/** Points along an SVG arc with equal radii and no rotation, from `(x0, y0)` to `(x1, y1)`. */
function arcPoints(
  x0: number,
  y0: number,
  command: Extract<PathCommand, { type: "A" }>,
  steps: number,
): XY[] {
  const { x: x1, y: y1, largeArc, sweep } = command;
  const halfDx = (x0 - x1) / 2;
  const halfDy = (y0 - y1) / 2;
  let radius = command.radius;
  const lambda = (halfDx * halfDx + halfDy * halfDy) / (radius * radius);
  if (lambda > 1) radius *= Math.sqrt(lambda);
  const sign = largeArc === sweep ? -1 : 1;
  const squared = halfDx * halfDx + halfDy * halfDy;
  const coefficient = sign * Math.sqrt(Math.max(0, (radius * radius - squared) / squared));
  const centerDx = coefficient * halfDy;
  const centerDy = -coefficient * halfDx;
  const cx = centerDx + (x0 + x1) / 2;
  const cy = centerDy + (y0 + y1) / 2;
  const start = Math.atan2((halfDy - centerDy) / radius, (halfDx - centerDx) / radius);
  const end = Math.atan2((-halfDy - centerDy) / radius, (-halfDx - centerDx) / radius);
  let delta = end - start;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const points: XY[] = [];
  for (let k = 1; k <= steps; k++) {
    const angle = start + (delta * k) / steps;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

/** The contours of an outline, with arcs replaced by many short lines. */
function contours(commands: readonly PathCommand[], stepsPerArc = 256): XY[][] {
  const result: XY[][] = [];
  let current: XY[] = [];
  let x = 0;
  let y = 0;
  for (const command of commands) {
    if (command.type === "M") {
      current = [[command.x, command.y]];
      result.push(current);
      x = command.x;
      y = command.y;
    } else if (command.type === "L") {
      current.push([command.x, command.y]);
      x = command.x;
      y = command.y;
    } else if (command.type === "A") {
      current.push(...arcPoints(x, y, command, stepsPerArc));
      x = command.x;
      y = command.y;
    }
  }
  return result;
}

/** Signed area by the shoelace formula: positive when the contour goes in the direction of increasing angle. */
function signedArea(polygon: readonly XY[]): number {
  let sum = 0;
  polygon.forEach((p, i) => {
    const q = at(polygon, (i + 1) % polygon.length);
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return sum / 2;
}

/** The winding number of a polygon around a point. */
function winding(px: number, py: number, polygon: readonly XY[]): number {
  let count = 0;
  polygon.forEach((a, i) => {
    const b = at(polygon, (i + 1) % polygon.length);
    const cross = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
    if (a[1] <= py) {
      if (b[1] > py && cross > 0) count++;
    } else if (b[1] <= py && cross < 0) {
      count--;
    }
  });
  return count;
}

/**
 * By definition, the hull of two discs is the union of the discs whose centre and radius are interpolated
 * between theirs. Returns the smallest value of `distance to the interpolated centre - interpolated radius`:
 * negative inside, positive outside. The function is convex in the interpolation parameter.
 */
function signedDistanceToHull(px: number, py: number, a: OutlinePoint, b: OutlinePoint): number {
  const f = (t: number): number =>
    Math.hypot(px - (a.x + t * (b.x - a.x)), py - (a.y + t * (b.y - a.y))) - (a.width / 2 + (t * (b.width - a.width)) / 2);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 100; i++) {
    const m1 = low + (high - low) / 3;
    const m2 = high - (high - low) / 3;
    if (f(m1) < f(m2)) high = m2;
    else low = m1;
  }
  return f((low + high) / 2);
}

const BOUNDARY_BAND = 2e-3; // arcs are drawn with short lines: stay away from the edge when comparing

function randomPoint(random: ReturnType<typeof createRandom>, wide = 8): OutlinePoint {
  return { x: (random.next() - 0.5) * 20, y: (random.next() - 0.5) * 20, width: 0.2 + random.next() * wide };
}

describe("strokeOutline", () => {
  it("is empty for no points", () => {
    expect(strokeOutline([])).toEqual([]);
  });

  it("draws a single point as a disc", () => {
    const outline = strokeOutline([{ x: 3, y: -2, width: 4 }]);
    const [contour, ...others] = contours(outline);
    expect(others).toHaveLength(0);
    expect(signedArea(contour ?? [])).toBeCloseTo(Math.PI * 4, 2); // radius 2
    expect(winding(3, -2, contour ?? [])).toBe(1);
    expect(winding(3, 0.5, contour ?? [])).toBe(0);
  });

  it("joins two discs of equal width into a stadium", () => {
    const outline = strokeOutline([{ x: 0, y: 0, width: 2 }, { x: 10, y: 0, width: 2 }]);
    const [contour] = contours(outline);
    expect(signedArea(contour ?? [])).toBeCloseTo(Math.PI * 1 + 2 * 1 * 10, 2); // pi r^2 + 2 r d
  });

  it("is the convex hull of two discs, for random pairs", () => {
    const random = createRandom(21);
    let compared = 0;
    for (let pair = 0; pair < 300; pair++) {
      const a = randomPoint(random);
      const b = randomPoint(random);
      const polygons = contours(strokeOutline([a, b]));
      expect(polygons).toHaveLength(1);
      const polygon = at(polygons, 0);
      for (let k = 0; k < 100; k++) {
        const px = (random.next() - 0.5) * 30;
        const py = (random.next() - 0.5) * 30;
        const distance = signedDistanceToHull(px, py, a, b);
        if (Math.abs(distance) < BOUNDARY_BAND) continue;
        expect(winding(px, py, polygon) !== 0, `pair ${pair}, point ${k}`).toBe(distance < 0);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20000);
  });

  it("covers the case where one disc contains the other", () => {
    const outline = strokeOutline([{ x: 0, y: 0, width: 10 }, { x: 1, y: 1, width: 2 }]);
    const [contour] = contours(outline);
    expect(signedArea(contour ?? [])).toBeCloseTo(Math.PI * 25, 1);
    expect(winding(4, 0, contour ?? [])).toBe(1);
    expect(winding(6, 0, contour ?? [])).toBe(0);
  });

  it("runs every contour in the same direction, for every kind of pair", () => {
    const random = createRandom(22);
    for (let pair = 0; pair < 600; pair++) {
      const a = randomPoint(random, pair % 3 === 0 ? 30 : 4);
      const b = pair % 5 === 0 ? { x: a.x + (random.next() - 0.5), y: a.y + (random.next() - 0.5), width: random.next() * 30 + 0.1 } : randomPoint(random);
      for (const polygon of contours(strokeOutline([a, b]))) {
        expect(signedArea(polygon), `pair ${pair}`).toBeGreaterThan(0);
      }
    }
  });

  it("makes the union of the shapes of a longer stroke, with no hole where they overlap", () => {
    const random = createRandom(23);
    let compared = 0;
    for (let stroke = 0; stroke < 60; stroke++) {
      const points = Array.from({ length: 6 }, () => randomPoint(random, 5));
      const polygons = contours(strokeOutline(points));
      expect(polygons).toHaveLength(5);
      for (let k = 0; k < 150; k++) {
        const px = (random.next() - 0.5) * 30;
        const py = (random.next() - 0.5) * 30;
        let nearest = Infinity;
        for (let i = 0; i + 1 < points.length; i++) {
          nearest = Math.min(nearest, signedDistanceToHull(px, py, at(points, i), at(points, i + 1)));
        }
        if (Math.abs(nearest) < BOUNDARY_BAND) continue;
        const total = polygons.reduce((sum, polygon) => sum + winding(px, py, polygon), 0);
        expect(total !== 0, `stroke ${stroke}, point ${k}`).toBe(nearest < 0);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(5000);
  });

  it("only produces finite numbers and closed contours", () => {
    const random = createRandom(24);
    const points = Array.from({ length: 40 }, () => randomPoint(random));
    const outline = strokeOutline(points);
    for (const command of outline) {
      if (command.type === "Z") continue;
      expect(Number.isFinite(command.x) && Number.isFinite(command.y)).toBe(true);
    }
    expect(outline.filter((c) => c.type === "M")).toHaveLength(39);
    expect(outline.filter((c) => c.type === "Z")).toHaveLength(39);
  });
});
