import { describe, expect, it } from "vitest";
import {
  ONE,
  ZERO,
  add,
  compare,
  dyadic,
  dyadicFromString,
  dyadicToString,
  equals,
  fromNumber,
  mul,
  neg,
  shift,
  sign,
  significantBits,
  sub,
  toNumber,
} from "./dyadic";
import { createRandom } from "./test-utils";

describe("canonical form", () => {
  it("reduces the numerator to an odd number", () => {
    expect(dyadic(4n, 2)).toEqual({ n: 1n, e: 0 });
    expect(dyadic(12n, 3)).toEqual({ n: 3n, e: 1 });
    expect(dyadic(-12n, 3)).toEqual({ n: -3n, e: 1 });
    expect(dyadic(8n, 0)).toEqual({ n: 1n, e: -3 });
  });

  it("has a single zero", () => {
    expect(dyadic(0n, 5)).toEqual(ZERO);
    expect(dyadic(0n, -5)).toEqual(ZERO);
    expect(ZERO).toEqual({ n: 0n, e: 0 });
  });

  it("canonicalizes very large numerators", () => {
    const big = dyadic(1n << 3000n, 3000);
    expect(big).toEqual(ONE);
  });

  it("rejects an exponent that is not a safe integer", () => {
    expect(() => dyadic(1n, 0.5)).toThrow(RangeError);
    expect(() => dyadic(1n, Number.NaN)).toThrow(RangeError);
    expect(() => dyadic(1n, Infinity)).toThrow(RangeError);
  });
});

describe("fromNumber and toNumber", () => {
  it("converts known values exactly", () => {
    expect(fromNumber(1)).toEqual(ONE);
    expect(fromNumber(0.5)).toEqual({ n: 1n, e: 1 });
    expect(fromNumber(3)).toEqual({ n: 3n, e: 0 });
    expect(fromNumber(8)).toEqual({ n: 1n, e: -3 });
    expect(fromNumber(-0.75)).toEqual({ n: -3n, e: 2 });
    // 0.1 is not 1/10 in binary: this is the exact value of the double 0.1
    expect(fromNumber(0.1)).toEqual({ n: 3602879701896397n, e: 55 });
  });

  it("turns -0 into zero", () => {
    expect(fromNumber(-0)).toEqual(ZERO);
    expect(toNumber(fromNumber(-0))).toBe(0);
  });

  it("rejects NaN and the infinities", () => {
    expect(() => fromNumber(Number.NaN)).toThrow(RangeError);
    expect(() => fromNumber(Infinity)).toThrow(RangeError);
    expect(() => fromNumber(-Infinity)).toThrow(RangeError);
  });

  it("round-trips edge cases", () => {
    const edgeCases = [
      0.1,
      -0.1,
      1 / 3,
      -1 / 3,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MIN_VALUE, // 5e-324, the smallest subnormal
      2 ** -1022, // smallest normal
      2 ** -1022 - 2 ** -1074, // largest subnormal
      2 ** 53 + 2,
      Number.EPSILON,
    ];
    for (const x of edgeCases) {
      expect(toNumber(fromNumber(x))).toBe(x);
    }
  });

  it("round-trips 5000 random doubles over the whole exponent range", () => {
    const random = createRandom(1);
    for (let i = 0; i < 5000; i++) {
      const x = random.finiteDouble();
      const back = toNumber(fromNumber(x));
      if (!Object.is(back, x === 0 ? 0 : x)) {
        throw new Error(`round trip failed for ${x}, got ${back}`);
      }
    }
  });
});

describe("toNumber rounding and range", () => {
  it("rounds ties to even", () => {
    expect(toNumber(dyadic((1n << 53n) + 1n))).toBe(9007199254740992);
    expect(toNumber(dyadic((1n << 53n) + 3n))).toBe(9007199254740996);
  });

  it("sees the bits it drops when rounding (sticky bit)", () => {
    // 2^53 + 1 + 2^-20: just above the tie between 2^53 and 2^53 + 2, so it rounds up
    const justAboveTie = dyadic(((1n << 53n) + 1n) * (1n << 20n) + 1n, 20);
    expect(significantBits(justAboveTie)).toBeGreaterThan(64);
    expect(toNumber(justAboveTie)).toBe(9007199254740994);
  });

  it("converts a huge numerator with a huge exponent to a moderate value", () => {
    const x = dyadic((3n << 1998n) | 1n, 1999); // 1.5 + 2^-1999
    expect(toNumber(x)).toBe(1.5);
  });

  it("overflows to infinity and underflows to zero", () => {
    expect(toNumber(dyadic(1n, -2000))).toBe(Infinity);
    expect(toNumber(dyadic(-1n, -2000))).toBe(-Infinity);
    expect(toNumber(dyadic(1n, 2000))).toBe(0);
    expect(toNumber(dyadic(1n, -1023))).toBe(2 ** 1023);
    expect(toNumber(dyadic(1n, -1024))).toBe(Infinity);
  });
});

describe("arithmetic", () => {
  it("adds simple fractions", () => {
    expect(add(dyadic(1n, 1), dyadic(1n, 2))).toEqual(dyadic(3n, 2)); // 1/2 + 1/4 = 3/4
    expect(add(dyadic(1n, 1), dyadic(1n, 1))).toEqual(ONE); // 1/2 + 1/2 = 1
  });

  it("keeps a deep position exact", () => {
    const deep = add(ONE, dyadic(1n, 1000)); // 1 + 2^-1000
    expect(significantBits(deep)).toBe(1001);
    expect(sub(deep, ONE)).toEqual(dyadic(1n, 1000));
    expect(compare(deep, ONE)).toBe(1);
  });

  it("agrees with IEEE arithmetic where IEEE is exact", () => {
    // multiples of 2^-20 below 2^6: sums and products are exactly representable as doubles
    const random = createRandom(2);
    const pick = (): number => (random.int(1 << 26) - (1 << 25)) * 2 ** -20;
    for (let i = 0; i < 2000; i++) {
      const x = pick();
      const y = pick();
      const a = fromNumber(x);
      const b = fromNumber(y);
      expect(toNumber(add(a, b))).toBe(x + y);
      expect(toNumber(sub(a, b))).toBe(x - y);
      expect(toNumber(mul(a, b))).toBe(x * y);
      expect(toNumber(neg(a))).toBe(x === 0 ? 0 : -x);
      expect(compare(a, b)).toBe(Math.sign(x - y) || 0);
      expect(sign(a)).toBe(Math.sign(x) || 0);
    }
  });

  it("has the usual identities", () => {
    const x = fromNumber(0.3);
    expect(add(x, ZERO)).toEqual(x);
    expect(add(ZERO, x)).toEqual(x);
    expect(mul(x, ONE)).toEqual(x);
    expect(mul(x, ZERO)).toEqual(ZERO);
    expect(sub(x, x)).toEqual(ZERO);
    expect(neg(neg(x))).toEqual(x);
    expect(equals(x, fromNumber(0.3))).toBe(true);
    expect(equals(x, fromNumber(0.4))).toBe(false);
  });

  it("shifts by powers of two without changing the numerator", () => {
    const x = fromNumber(5.25);
    expect(shift(x, 10).n).toBe(x.n);
    expect(toNumber(shift(x, 10))).toBe(5.25 * 2 ** 10);
    expect(toNumber(shift(x, -10))).toBe(5.25 * 2 ** -10);
    expect(shift(ZERO, 5)).toEqual(ZERO);
    expect(() => shift(x, 0.5)).toThrow(RangeError);
  });

  it("compares values of very different magnitudes", () => {
    expect(compare(dyadic(1n, -2000), dyadic(1n, 2000))).toBe(1);
    expect(compare(dyadic(-1n, -2000), dyadic(1n, 2000))).toBe(-1);
    expect(compare(ZERO, dyadic(1n, 2000))).toBe(-1);
  });
});

describe("text form", () => {
  it("round-trips through a string", () => {
    const random = createRandom(3);
    const samples = [
      ZERO,
      ONE,
      dyadic(-3n, 4),
      dyadic(5n, -7),
      dyadic(random.bits(1000) | 1n, 1000),
      dyadic(-(random.bits(700) | 1n), -300),
    ];
    for (const d of samples) {
      expect(dyadicFromString(dyadicToString(d))).toEqual(d);
    }
    expect(dyadicToString(dyadic(-3n, 4))).toBe("-3/2^4");
  });

  it("canonicalizes what it reads and rejects garbage", () => {
    expect(dyadicFromString("4/2^2")).toEqual(ONE);
    expect(() => dyadicFromString("1/3")).toThrow(SyntaxError);
    expect(() => dyadicFromString("")).toThrow(SyntaxError);
    expect(() => dyadicFromString("1.5/2^1")).toThrow(SyntaxError);
  });
});
