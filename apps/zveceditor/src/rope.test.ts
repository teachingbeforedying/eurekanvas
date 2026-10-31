import { describe, expect, it } from "vitest";
import type { ScreenPoint } from "@eurekanvas/engine";
import { MIN_SPEED_ROPE, Rope } from "./rope";

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A small seeded generator, so that the "random" tremor is always the same. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws the pointer positions with the rope, `dt` milliseconds apart, and returns the positions of the brush. */
function draw(rope: Rope, pointer: readonly ScreenPoint[], dt = 4): ScreenPoint[] {
  const brush = [rope.start(pointer[0] as ScreenPoint, 0)];
  pointer.forEach((p, i) => {
    if (i === 0) return;
    const moved = rope.move(p, i * dt);
    if (moved) brush.push(moved);
  });
  return brush;
}

/**
 * A hairpin, 4 ms between events: up an arm of 200 px, a half turn of radius `r`, down the other arm. The hand
 * goes at 800 px/s on the arms and slows down to 100 px/s in the last 60 px before the turn and in the turn.
 */
function hairpin(r: number): ScreenPoint[] {
  const arm = 200;
  const turn = Math.PI * r;
  const at = (s: number): ScreenPoint => {
    if (s < arm) return { x: 0, y: -s };
    if (s < arm + turn) {
      const angle = (s - arm) / r;
      return { x: r - r * Math.cos(angle), y: -arm - r * Math.sin(angle) };
    }
    return { x: 2 * r, y: -arm + (s - arm - turn) };
  };
  const speed = (s: number): number => {
    const toTurn = s < arm ? arm - s : s < arm + turn ? 0 : s - arm - turn;
    return 100 + 700 * Math.min(1, toTurn / 60);
  };
  const path: ScreenPoint[] = [];
  for (let s = 0; s <= 2 * arm + turn; s += (speed(s) * 4) / 1000) path.push(at(s));
  return path;
}

describe("Rope", () => {
  it("starts with the brush on the pointer", () => {
    const rope = new Rope(16);
    expect(rope.start({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(rope.position).toEqual({ x: 10, y: 20 });
  });

  it("does not move the brush while the pointer stays within one rope length of it", () => {
    const rope = new Rope(16);
    rope.start({ x: 100, y: 100 });
    for (const p of [{ x: 103, y: 98 }, { x: 95, y: 104 }, { x: 110, y: 110 }, { x: 100, y: 116 }, { x: 84, y: 100 }]) {
      expect(rope.move(p)).toBeNull();
    }
    expect(rope.position).toEqual({ x: 100, y: 100 });
  });

  it("pulls the brush along the line to the pointer, to exactly one rope length from it", () => {
    const rope = new Rope(10);
    rope.start({ x: 0, y: 0 });
    const pulled = rope.move({ x: 30, y: 40 }); // 50 away: the brush ends up 10 away, on the line
    expect(pulled).not.toBeNull();
    expect(pulled?.x).toBeCloseTo(24, 12);
    expect(pulled?.y).toBeCloseTo(32, 12);
    expect(distance(pulled as ScreenPoint, { x: 30, y: 40 })).toBeCloseTo(10, 12);
  });

  it("never lets the brush get farther than the rope from the pointer", () => {
    const random = seeded(1);
    const rope = new Rope(24);
    let pointer = { x: 500, y: 500 };
    rope.start(pointer);
    for (let i = 0; i < 2000; i++) {
      pointer = { x: pointer.x + (random() - 0.5) * 80, y: pointer.y + (random() - 0.5) * 80 };
      rope.move(pointer);
      expect(distance(rope.position, pointer)).toBeLessThanOrEqual(24 + 1e-9);
    }
  });

  it("is no rope at all when its length is 0: the brush follows the pointer", () => {
    const rope = new Rope(0);
    rope.start({ x: 5, y: 5 });
    expect(rope.move({ x: 6, y: 7 })).toEqual({ x: 6, y: 7 });
    expect(rope.move({ x: 6, y: 7 })).toBeNull(); // the pointer did not move
    expect(rope.position).toEqual({ x: 6, y: 7 });
  });

  it("rejects a negative or non-finite length or lag", () => {
    expect(() => new Rope(-1)).toThrow(RangeError);
    expect(() => new Rope(Number.NaN)).toThrow(RangeError);
    expect(() => new Rope(Infinity)).toThrow(RangeError);
    expect(() => new Rope(16, -1)).toThrow(RangeError);
    expect(() => new Rope(16, Number.NaN)).toThrow(RangeError);
    expect(() => new Rope(16, Infinity)).toThrow(RangeError);
  });

  it("keeps the brush on the same place of the drawing when the view zooms around a point", () => {
    const rope = new Rope(16);
    rope.start({ x: 300, y: 200 });
    rope.zoomed({ x: 400, y: 200 }, 2); // 100 px left of the pivot becomes 200 px left of it
    expect(rope.position).toEqual({ x: 200, y: 200 });
    rope.zoomed({ x: 400, y: 200 }, 0.5);
    expect(rope.position).toEqual({ x: 300, y: 200 });
  });

  it("keeps the brush on the same place of the drawing when the view moves", () => {
    const rope = new Rope(16);
    rope.start({ x: 300, y: 200 });
    rope.shifted(40, -10);
    expect(rope.position).toEqual({ x: 340, y: 190 });
  });

  it("removes most of the tremor of a hand drawing a straight line", () => {
    const random = seeded(2);
    const rms = (ys: readonly number[]): number => Math.sqrt(ys.reduce((sum, y) => sum + (y - 200) ** 2, 0) / ys.length);
    const tremor: ScreenPoint[] = [];
    for (let x = 0; x <= 600; x += 4) tremor.push({ x, y: 200 + (random() - 0.5) * 6 }); // +-3 px of tremor

    const rope = new Rope(32);
    rope.start(tremor[0] as ScreenPoint);
    const smoothed: number[] = [];
    for (const p of tremor) {
      const moved = rope.move(p);
      if (moved) smoothed.push(moved.y);
    }
    expect(smoothed.length).toBeGreaterThan(20);
    expect(rms(smoothed)).toBeLessThan(rms(tremor.map((p) => p.y)) / 3);
  });
});

describe("the rope that follows the speed of the hand", () => {
  it("is as long as the distance the pointer moved in the last lag milliseconds", () => {
    const rope = new Rope(128, 50);
    rope.start({ x: 0, y: 0 }, 0);
    for (let t = 4; t <= 400; t += 4) {
      rope.move({ x: t, y: 0 }, t); // 1 px per millisecond
      if (t >= 60) expect(rope.currentLength).toBeCloseTo(50, 9);
    }
    expect(rope.position.x).toBeCloseTo(350, 9); // where the pointer was 50 ms before
  });

  it("is short for a slow hand and long for a fast one, within its bounds", () => {
    const slow = new Rope(128, 50);
    slow.start({ x: 0, y: 0 }, 0);
    for (let t = 4; t <= 400; t += 4) slow.move({ x: t * 0.1, y: 0 }, t); // 100 px/s: 5 px in 50 ms
    expect(slow.currentLength).toBeCloseTo(5, 9);

    const slower = new Rope(128, 50);
    slower.start({ x: 0, y: 0 }, 0);
    for (let t = 4; t <= 400; t += 4) slower.move({ x: t * 0.02, y: 0 }, t); // 20 px/s: 1 px in 50 ms
    expect(slower.currentLength).toBe(MIN_SPEED_ROPE);

    const fast = new Rope(128, 50);
    fast.start({ x: 0, y: 0 }, 0);
    for (let t = 4; t <= 400; t += 4) fast.move({ x: t * 10, y: 0 }, t); // 10 000 px/s: 500 px in 50 ms
    expect(fast.currentLength).toBe(128);
  });

  it("keeps its starting length until it has followed the hand for lag milliseconds", () => {
    const rope = new Rope(128, 50);
    rope.start({ x: 0, y: 0 }, 0);
    for (let t = 4; t <= 48; t += 4) {
      rope.move({ x: t, y: 0 }, t);
      expect(rope.currentLength).toBe(MIN_SPEED_ROPE);
    }
    rope.move({ x: 52, y: 0 }, 52);
    expect(rope.currentLength).toBeCloseTo(50, 9);
  });

  it("treats a time that goes back as the last time", () => {
    const rope = new Rope(128, 50);
    rope.start({ x: 0, y: 0 }, 0);
    for (let t = 4; t <= 100; t += 4) rope.move({ x: t, y: 0 }, t);
    rope.move({ x: 104, y: 0 }, 90); // counts as 100: the pointer was at 50 at 50 ms
    expect(rope.currentLength).toBeCloseTo(54, 9);
  });

  it("keeps its length when the view moves, until it has followed the hand again for lag milliseconds", () => {
    const rope = new Rope(128, 50);
    rope.start({ x: 0, y: 0 }, 0);
    for (let t = 4; t <= 200; t += 4) rope.move({ x: t, y: 0 }, t);
    expect(rope.currentLength).toBeCloseTo(50, 9);
    // the view moves with the hand for half a second: the stroke is paused, the brush follows the drawing
    rope.shifted(300, 40);
    const brush = rope.position;
    // drawing goes on, slowly: the length does not drop at once, so the brush is not pulled straight to the pointer
    const pointer = { x: 500, y: 40 };
    expect(rope.move(pointer, 700)).toBeNull(); // still 50 px away from the brush
    expect(rope.currentLength).toBeCloseTo(50, 9);
    expect(rope.position).toEqual(brush);
    for (let t = 704; t <= 760; t += 4) rope.move({ x: 500 + (t - 700) * 0.1, y: 40 }, t);
    expect(rope.currentLength).toBeCloseTo(5, 9); // 100 px/s: 5 px in 50 ms
  });

  it("still absorbs a tremor smaller than its shortest length", () => {
    const random = seeded(3);
    const rope = new Rope(128, 50);
    rope.start({ x: 100, y: 100 }, 0);
    for (let t = 4; t <= 1000; t += 4) {
      expect(rope.move({ x: 100 + (random() - 0.5) * 3, y: 100 + (random() - 0.5) * 3 }, t)).toBeNull();
    }
  });

  it("keeps a slow hairpin tight, where a fixed rope cuts it", () => {
    // how far the top of the stroke stays below the top of the pointer's path
    const shortfall = (rope: Rope, path: readonly ScreenPoint[]): number =>
      Math.min(...draw(rope, path).map((p) => p.y)) - Math.min(...path.map((p) => p.y));
    for (const r of [5, 10, 20]) {
      const path = hairpin(r);
      expect(shortfall(new Rope(128, 50), path)).toBeLessThan(3); // measured: 2.4, 1.3, 0.7 px
      expect(shortfall(new Rope(16), path)).toBeGreaterThan(6); // measured: 15.1, 11.6, 6.5 px
      expect(shortfall(new Rope(64), path)).toBeGreaterThan(50); // measured: about 60 px
    }
  });
});

describe("Rope.rotated", () => {
  it("keeps the brush on the drawing when the view turns", () => {
    const rope = new Rope(10);
    rope.start({ x: 100, y: 0 });
    rope.rotated({ x: 0, y: 0 }, 90);
    expect(rope.position).toEqual({ x: 0, y: 100 });
    rope.rotated({ x: 0, y: 100 }, 45); // around the brush itself: it does not move
    expect(rope.position).toEqual({ x: 0, y: 100 });
  });
});
