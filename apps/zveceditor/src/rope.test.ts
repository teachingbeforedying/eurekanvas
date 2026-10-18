import { describe, expect, it } from "vitest";
import type { ScreenPoint } from "@eurekanvas/engine";
import { Rope } from "./rope";

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

  it("rejects a negative or non-finite length", () => {
    expect(() => new Rope(-1)).toThrow(RangeError);
    expect(() => new Rope(Number.NaN)).toThrow(RangeError);
    expect(() => new Rope(Infinity)).toThrow(RangeError);
  });

  it("brings the brush to the pointer when the stroke ends", () => {
    const rope = new Rope(16);
    rope.start({ x: 0, y: 0 });
    rope.move({ x: 100, y: 0 }); // brush at x = 84
    expect(rope.finish({ x: 100, y: 0 })).toEqual({ x: 100, y: 0 });
    expect(rope.position).toEqual({ x: 100, y: 0 });
    expect(rope.finish({ x: 100, y: 0 })).toBeNull(); // already there
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
