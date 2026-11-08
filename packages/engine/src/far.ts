/**
 * The ink of a section seen from so deep that it reaches millions of pixels, possibly from inside it.
 *
 * A canvas computes in single precision: it cannot be given such coordinates. But the screen never sees the whole
 * section. For each capsule of the section (see `outline.ts`), either the screen is entirely outside it, or entirely
 * inside it, or an edge crosses the screen; and at this scale an edge is a straight line or a very gentle arc.
 *
 * Inside or outside is decided with floats, in the local units of the section. For an edge, the only hard number is
 * how far it is from the middle of the screen, in pixels: a small difference of huge numbers. It is computed from the
 * exact positions, and then fits in a float. The screen is cut by the half-planes of the capsule, in floats, so that
 * everything given to the canvas is a small number, at any depth.
 */

import { type Camera, type ScreenPoint, type Turn, type Viewport, turnOf } from "./camera";
import { type Dyadic, ONE, ZERO, add, fromNumber, magnitude, mul, neg, quotient, shift, sign, squareRoot, sub, toNumber } from "./dyadic";
import type { PathCommand } from "./outline";
import { type PlacedSection, sectionExtent, sectionScale } from "./placement";
import type { LocalPoint } from "./stroke";

/** A point of the screen, in exact pixels from its middle. */
interface Exact {
  readonly x: Dyadic;
  readonly y: Dyadic;
}

/** The half-plane `nx · x + ny · y <= h`, in pixels from the middle of the screen. */
interface HalfPlane {
  readonly nx: number;
  readonly ny: number;
  readonly h: number;
}

/** How far beyond the screen the ink is drawn, in pixels. */
const SCREEN_MARGIN = 2;

/** From this radius, in pixels, an arc is straight on any screen, to within a few hundredths of a pixel. */
const FLAT_RADIUS = 1e7;

/** How far an arc may be from the polygon that replaces it, in pixels. */
const ARC_TOLERANCE = 0.1;

/** The largest angle between two tangents of an arc, in radians. */
const COARSE_STEP = Math.PI / 8;

/** The bits of a square root beyond the ones needed to cancel the size of the coordinates. */
const EXTRA_BITS = 96;

const FULL_TURN = 2 * Math.PI;

function turnedBy(turn: Turn, v: Exact): Exact {
  const cos = fromNumber(turn.cos);
  const sin = fromNumber(turn.sin);
  return { x: sub(mul(cos, v.x), mul(sin, v.y)), y: add(mul(sin, v.x), mul(cos, v.y)) };
}

function mirroredIf(mirror: boolean, v: Exact): Exact {
  return mirror ? { x: v.x, y: neg(v.y) } : v;
}

function scaledBy(k: Dyadic, v: Exact): Exact {
  return { x: mul(k, v.x), y: mul(k, v.y) };
}

/** Where the local points of a section are on the screen, exactly, in pixels from the middle; and how large a thickness is there. */
function exactMapping(placed: PlacedSection, camera: Camera) {
  const viewTurn = turnOf(camera.angle);
  const ownTurn = turnOf(placed.angle);
  const seen = (v: Exact): Exact => turnedBy(viewTurn, mirroredIf(camera.mirror, v));
  const placedOnScreen = (v: Exact): Exact => seen(turnedBy(ownTurn, mirroredIf(placed.mirror, v)));
  const k = shift(mul(fromNumber(camera.factor), fromNumber(placed.factor)), camera.zLevel - placed.zLevel);
  const origin = scaledBy(
    shift(fromNumber(camera.factor), camera.zLevel),
    seen({ x: sub(placed.anchor.x, camera.center.x), y: sub(placed.anchor.y, camera.center.y) }),
  );
  const xAxis = scaledBy(k, placedOnScreen({ x: ONE, y: ZERO }));
  const yAxis = scaledBy(k, placedOnScreen({ x: ZERO, y: ONE }));
  return {
    point(p: LocalPoint): Exact {
      const [x, y] = [fromNumber(p.x), fromNumber(p.y)];
      return { x: add(origin.x, add(mul(xAxis.x, x), mul(yAxis.x, y))), y: add(origin.y, add(mul(xAxis.y, x), mul(yAxis.y, y))) };
    },
    radius: (p: LocalPoint): Dyadic => mul(fromNumber(p.width / 2), k),
  };
}

/** The middle of the screen, in the local units of the section: a float, which only has to tell what is near. */
function middleInLocalUnits(placed: PlacedSection, camera: Camera): ScreenPoint {
  const turn = turnOf(placed.angle);
  const [cos, sin] = [fromNumber(turn.cos), fromNumber(turn.sin)];
  const dx = sub(camera.center.x, placed.anchor.x);
  const dy = sub(camera.center.y, placed.anchor.y);
  const x = add(mul(cos, dx), mul(sin, dy));
  const y = sub(mul(cos, dy), mul(sin, dx));
  return {
    x: toNumber(shift(x, placed.zLevel)) / placed.factor,
    y: toNumber(shift(placed.mirror ? neg(y) : y, placed.zLevel)) / placed.factor,
  };
}

/** The signed distance from `q` to the hull of the discs at `a` and `b`: negative inside. */
function distanceToCapsule(q: ScreenPoint, a: LocalPoint, b: LocalPoint): number {
  const [ra, rb] = [a.width / 2, b.width / 2];
  const [bax, bay] = [b.x - a.x, b.y - a.y];
  const [pax, pay] = [q.x - a.x, q.y - a.y];
  const l2 = bax * bax + bay * bay;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  if (a2 <= 0) {
    // one disc contains the other
    return ra >= rb ? Math.hypot(pax, pay) - ra : Math.hypot(q.x - b.x, q.y - b.y) - rb;
  }
  const y = pax * bax + pay * bay;
  const z = y - l2;
  const [cx, cy] = [pax * l2 - bax * y, pay * l2 - bay * y];
  const x2 = cx * cx + cy * cy;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) / l2 - rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) / l2 - ra;
  return (Math.sqrt(x2 * a2 / l2) + y * rr) / l2 - ra;
}

/** Whether the direction `angle` is on the arc that starts at `from` and turns by `span`, in radians. */
function onArc(angle: number, from: number, span: number): boolean {
  const offset = (angle - from) % FULL_TURN;
  return (offset < 0 ? offset + FULL_TURN : offset) <= span;
}

/** The half-planes of an arc of a disc of `center`: its normals go from `from`, turning by `span`. `reach` is how far the screen goes from its middle. */
function arcPlanes(center: Exact, radius: Dyadic, from: number, span: number, reach: number): HalfPlane[] {
  const r = toNumber(radius);
  if (r >= FLAT_RADIUS) {
    // straight on the screen: its tangent at the point closest to the middle of the screen is enough
    const distance2 = add(mul(center.x, center.x), mul(center.y, center.y));
    if (sign(distance2) === 0) return [];
    const distance = squareRoot(distance2, EXTRA_BITS);
    const [nx, ny] = [quotient(neg(center.x), distance), quotient(neg(center.y), distance)];
    return onArc(Math.atan2(ny, nx), from, span) ? [{ nx, ny, h: toNumber(sub(radius, distance)) }] : [];
  }
  const [cx, cy] = [toNumber(center.x), toNumber(center.y)];
  const d = Math.hypot(cx, cy);
  // tangents only where the disc can touch the screen: up to `half` on each side of the direction of its middle
  // (a zero `d` or `r` divides by zero: the bounds turn the infinity into "all of the circle" or "none of it")
  const step = Math.min(COARSE_STEP, 2 * Math.sqrt((2 * ARC_TOLERANCE) / r));
  const half = Math.acos(Math.min(1, Math.max(-1, (d * d + r * r - reach * reach) / (2 * d * r))));
  const toward = Math.atan2(-cy, -cx);
  const angles: number[] = [];
  for (let offset = 0; offset <= half; offset += step) {
    if (onArc(toward + offset, from, span)) angles.push(toward + offset);
    if (onArc(toward - offset, from, span)) angles.push(toward - offset);
  }
  return angles.map((angle) => {
    const [nx, ny] = [Math.cos(angle), Math.sin(angle)];
    return { nx, ny, h: nx * cx + ny * cy + r };
  });
}

/** The half-planes of the hull of the discs of centers `a` and `b`, whose intersection is that hull. */
function capsulePlanes(a: Exact, ra: Dyadic, b: Exact, rb: Dyadic, reach: number): HalfPlane[] {
  const dx = sub(b.x, a.x);
  const dy = sub(b.y, a.y);
  const d2 = add(mul(dx, dx), mul(dy, dy));
  const delta = sub(ra, rb);
  const rest = sub(d2, mul(delta, delta));
  if (sign(rest) <= 0) return sign(delta) >= 0 ? arcPlanes(a, ra, 0, FULL_TURN, reach) : arcPlanes(b, rb, 0, FULL_TURN, reach);
  // the outer tangents have the unit normals n = (delta · D ± s · D⊥) / d², with D⊥ = (-dy, dx) and s = √(d² - delta²);
  // the distance of a tangent from the middle of the screen is n · a + ra
  const p = add(mul(dx, a.x), mul(dy, a.y));
  const q = sub(mul(dx, a.y), mul(dy, a.x));
  const s = squareRoot(rest, EXTRA_BITS + Math.max(0, magnitude(q) - 2 * Math.max(magnitude(dx), magnitude(dy))));
  const tangent = (side: Dyadic): HalfPlane => ({
    nx: quotient(sub(mul(delta, dx), mul(side, dy)), d2),
    ny: quotient(add(mul(delta, dy), mul(side, dx)), d2),
    h: quotient(add(mul(ra, d2), add(mul(delta, p), mul(side, q))), d2),
  });
  const plus = tangent(s);
  const minus = tangent(neg(s));
  const [plusAngle, minusAngle] = [Math.atan2(plus.ny, plus.nx), Math.atan2(minus.ny, minus.nx)];
  const raw = plusAngle - minusAngle;
  const opening = raw < 0 ? raw + FULL_TURN : raw;
  return [plus, minus, ...arcPlanes(b, rb, minusAngle, opening, reach), ...arcPlanes(a, ra, plusAngle, FULL_TURN - opening, reach)];
}

/** The part of a convex polygon inside a half-plane. */
function clipped(polygon: readonly ScreenPoint[], { nx, ny, h }: HalfPlane): ScreenPoint[] {
  const kept: ScreenPoint[] = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length] as ScreenPoint;
    const dp = nx * p.x + ny * p.y - h;
    const dq = nx * q.x + ny * q.y - h;
    if (dp <= 0) kept.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      kept.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  });
  return kept;
}

function pushPolygon(out: PathCommand[], polygon: readonly ScreenPoint[], viewport: Viewport): void {
  polygon.forEach((p, i) => out.push({ type: i === 0 ? "M" : "L", x: p.x + viewport.width / 2, y: p.y + viewport.height / 2 }));
  out.push({ type: "Z" });
}

/**
 * The ink of a section, cut to the screen, as path commands in the coordinates of the screen: every number is small,
 * at any depth, and every contour runs in the same direction, so that filling with the "non-zero" rule gives the
 * union of the shapes. Empty when none of its ink is on the screen.
 */
export function farOutline(placed: PlacedSection, camera: Camera, viewport: Viewport): PathCommand[] {
  const halfWidth = viewport.width / 2 + SCREEN_MARGIN;
  const halfHeight = viewport.height / 2 + SCREEN_MARGIN;
  const screen: readonly ScreenPoint[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];
  const reach = Math.hypot(halfWidth, halfHeight);
  const extent = sectionExtent(placed.section);
  const size = Math.max(Math.abs(extent.minX), Math.abs(extent.maxX), Math.abs(extent.minY), Math.abs(extent.maxY), extent.maxWidth);
  // what floats cannot tell apart, in local units, and how far the screen goes
  const band = reach / sectionScale(placed, camera) + 1e-12 * (size + 1);
  const q = middleInLocalUnits(placed, camera);
  const half = extent.maxWidth / 2 + band;
  if (!(q.x >= extent.minX - half && q.x <= extent.maxX + half && q.y >= extent.minY - half && q.y <= extent.maxY + half)) return [];

  const out: PathCommand[] = [];
  const points = placed.section.points;
  const mapping = exactMapping(placed, camera);
  const count = Math.max(1, points.length - 1);
  for (let i = 0; i < count; i++) {
    const a = points[i] as LocalPoint;
    const b = points[i + 1] ?? a;
    const distance = distanceToCapsule(q, a, b);
    if (distance > band) continue;
    if (distance < -band) {
      // the whole screen is inside this capsule: nothing else can add to it
      const whole: PathCommand[] = [];
      pushPolygon(whole, screen, viewport);
      return whole;
    }
    let polygon: readonly ScreenPoint[] = screen;
    for (const plane of capsulePlanes(mapping.point(a), mapping.radius(a), mapping.point(b), mapping.radius(b), reach)) {
      polygon = clipped(polygon, plane);
      if (polygon.length === 0) break;
    }
    if (polygon.length >= 3) pushPolygon(out, polygon, viewport);
  }
  return out;
}
