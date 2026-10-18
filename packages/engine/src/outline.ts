/**
 * The outline of a stroke whose thickness changes from point to point.
 *
 * Two consecutive points are joined by the convex hull of two discs (one centred on each point, with a
 * diameter equal to the width at that point): a tapered capsule. A single point is a disc. The stroke is the
 * union of these shapes, so its ends and joints are round and its thickness changes continuously.
 *
 * The outline is a list of path commands in the SVG sense (`M`, `L`, `A`, `Z`), which a canvas, an SVG path
 * or a fabric `Path` can all draw. Every contour runs in the same direction, so that filling with the
 * "non-zero" rule gives the union of the shapes where they overlap.
 */

export type PathCommand =
  | { readonly type: "M"; readonly x: number; readonly y: number }
  | { readonly type: "L"; readonly x: number; readonly y: number }
  /** A circular arc from the current point to `(x, y)`, as in the SVG `A` command with equal radii. */
  | {
      readonly type: "A";
      readonly radius: number;
      readonly largeArc: boolean;
      /** `true`: in the direction of increasing angle (clockwise on a screen whose y axis points down). */
      readonly sweep: boolean;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "Z" };

export interface OutlinePoint {
  readonly x: number;
  readonly y: number;
  /** Thickness at this point. */
  readonly width: number;
}

function pushDisc(out: PathCommand[], cx: number, cy: number, radius: number): void {
  out.push({ type: "M", x: cx + radius, y: cy });
  out.push({ type: "A", radius, largeArc: false, sweep: true, x: cx - radius, y: cy });
  out.push({ type: "A", radius, largeArc: false, sweep: true, x: cx + radius, y: cy });
  out.push({ type: "Z" });
}

/** The hull of the discs centred on `a` and `b`, as one closed contour. */
function pushCapsule(out: PathCommand[], a: OutlinePoint, b: OutlinePoint): void {
  const r1 = a.width / 2;
  const r2 = b.width / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= Math.abs(r1 - r2)) {
    // one disc contains the other: the hull is the bigger one
    if (r1 >= r2) pushDisc(out, a.x, a.y, r1);
    else pushDisc(out, b.x, b.y, r2);
    return;
  }

  // The outer tangent lines have their normals at angle `theta +- phi`, with cos(phi) = (r1 - r2) / distance.
  const theta = Math.atan2(dy, dx);
  const phi = Math.acos(Math.min(1, Math.max(-1, (r1 - r2) / distance)));
  const minus = theta - phi;
  const plus = theta + phi;
  const cosMinus = Math.cos(minus);
  const sinMinus = Math.sin(minus);
  const cosPlus = Math.cos(plus);
  const sinPlus = Math.sin(plus);

  out.push({ type: "M", x: a.x + r1 * cosMinus, y: a.y + r1 * sinMinus });
  out.push({ type: "L", x: b.x + r2 * cosMinus, y: b.y + r2 * sinMinus });
  // around the second disc, on the side the stroke is heading to: from `minus` to `plus`, an angle of 2 * phi
  out.push({ type: "A", radius: r2, largeArc: phi > Math.PI / 2, sweep: true, x: b.x + r2 * cosPlus, y: b.y + r2 * sinPlus });
  out.push({ type: "L", x: a.x + r1 * cosPlus, y: a.y + r1 * sinPlus });
  // around the first disc, on the opposite side: from `plus` back to `minus`, an angle of 2 * pi - 2 * phi
  out.push({ type: "A", radius: r1, largeArc: phi < Math.PI / 2, sweep: true, x: a.x + r1 * cosMinus, y: a.y + r1 * sinMinus });
  out.push({ type: "Z" });
}

/** The outline of a stroke through `points`, in the same units as the points. Empty for no points. */
export function strokeOutline(points: readonly OutlinePoint[]): PathCommand[] {
  const out: PathCommand[] = [];
  const first = points[0];
  if (first === undefined) return out;
  if (points.length === 1) {
    pushDisc(out, first.x, first.y, first.width / 2);
    return out;
  }
  for (let i = 0; i + 1 < points.length; i++) {
    pushCapsule(out, points[i] as OutlinePoint, points[i + 1] as OutlinePoint);
  }
  return out;
}
