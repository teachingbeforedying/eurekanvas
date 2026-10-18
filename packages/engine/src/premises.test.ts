import { describe, expect, it } from "vitest";

// These tests pin down the facts that motivate the engine's design (see docs/noyau.md).
// They test the JavaScript language, not the engine: if one fails, the design needs a rethink.
describe("premises of the infinite zoom design", () => {
  it("a number cannot hold a zoom factor of 2^1024 or more", () => {
    expect(2 ** 1023).toBeLessThan(Infinity);
    expect(2 ** 1024).toBe(Infinity);
  });

  it("a number has only 53 bits of precision, so deep positions need more", () => {
    const origin = 1;
    const tinyOffset = 2 ** -60;
    expect(origin + tinyOffset).toBe(origin);
  });

  it("a BigInt mantissa with an integer exponent keeps a deep position exact", () => {
    // value = mantissa / 2^exponent
    const exponent = 1000n;
    const mantissa = (1n << exponent) + 1n; // 1 + 2^-1000
    expect(mantissa - (1n << exponent)).toBe(1n);
  });
});
