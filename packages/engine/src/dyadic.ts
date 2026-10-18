/**
 * Exact dyadic rationals: a value is `n / 2^e`, with `n` a BigInt and `e` an integer.
 *
 * Why dyadic: zooming by a factor of 2 is just a change of exponent, so positions stay exact
 * at any depth, and every finite `number` is itself a dyadic (see `fromNumber`).
 *
 * Values are immutable and always in canonical form (`n` odd, or zero with `e = 0`), so two equal
 * values are structurally equal and can be used as keys.
 */

export interface Dyadic {
  /** Numerator: odd, or `0n` for zero. */
  readonly n: bigint;
  /** The value is `n / 2^e`. Zero has `e = 0`. Can be negative (the value is then a multiple of 2^-e). */
  readonly e: number;
}

export const ZERO: Dyadic = Object.freeze({ n: 0n, e: 0 });
export const ONE: Dyadic = Object.freeze({ n: 1n, e: 0 });

/** Number of bits needed to write a positive BigInt (`bitLength(1n) === 1`). */
function bitLength(m: bigint): number {
  let high = 1;
  while (m >> BigInt(high) > 0n) high *= 2;
  let low = high >> 1; // invariant: m >> low > 0n
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (m >> BigInt(middle) > 0n) low = middle;
    else high = middle;
  }
  return high;
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${value}`);
  }
}

/** Builds a dyadic in canonical form from any numerator and exponent. */
export function dyadic(n: bigint, e = 0): Dyadic {
  assertSafeInteger(e, "exponent");
  if (n === 0n) return ZERO;
  const lowestBit = n & -n; // works for negative numbers too
  const zeros = bitLength(lowestBit) - 1;
  if (zeros === 0) return { n, e };
  return { n: n >> BigInt(zeros), e: e - zeros };
}

const float64 = new DataView(new ArrayBuffer(8));

/**
 * Exact conversion: every finite double is a dyadic.
 * `-0` becomes `ZERO` (the sign of zero is lost). Throws on `NaN` and `Infinity`.
 */
export function fromNumber(x: number): Dyadic {
  if (!Number.isFinite(x)) throw new RangeError(`cannot convert ${x} to a dyadic`);
  if (x === 0) return ZERO;
  float64.setFloat64(0, x);
  const high = float64.getUint32(0);
  const low = float64.getUint32(4);
  const negative = high >>> 31 === 1;
  const exponentBits = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  let exponent: number; // value = mantissa * 2^exponent
  if (exponentBits === 0) {
    exponent = -1074; // subnormal
  } else {
    mantissa |= 1n << 52n;
    exponent = exponentBits - 1075;
  }
  return dyadic(negative ? -mantissa : mantissa, -exponent);
}

/** `x * 2^k` without losing the result to an intermediate overflow or underflow. */
function ldexp(x: number, k: number): number {
  while (k > 1000) {
    x *= 2 ** 1000;
    k -= 1000;
    if (!Number.isFinite(x)) return x;
  }
  while (k < -1000) {
    x *= 2 ** -1000;
    k += 1000;
    if (x === 0) return x;
  }
  return x * 2 ** k;
}

/**
 * Conversion to the nearest double (ties to even). Gives `Infinity` or `0` outside the range of a `number`.
 * Known limit: in the subnormal range the result can be rounded twice.
 */
export function toNumber(d: Dyadic): number {
  if (d.n === 0n) return 0;
  const negative = d.n < 0n;
  let m = negative ? -d.n : d.n;
  let e = d.e;
  const bits = bitLength(m);
  if (bits > 64) {
    // Keep 64 bits, plus a "sticky" bit so that `Number()` rounds as if it had seen everything.
    const dropped = bits - 64;
    const lostBits = m & ((1n << BigInt(dropped)) - 1n);
    m >>= BigInt(dropped);
    if (lostBits !== 0n) m |= 1n;
    e -= dropped;
  }
  const magnitude = ldexp(Number(m), -e);
  return negative ? -magnitude : magnitude;
}

export function neg(d: Dyadic): Dyadic {
  return d.n === 0n ? ZERO : { n: -d.n, e: d.e };
}

export function add(a: Dyadic, b: Dyadic): Dyadic {
  if (a.n === 0n) return b;
  if (b.n === 0n) return a;
  const e = Math.max(a.e, b.e);
  return dyadic((a.n << BigInt(e - a.e)) + (b.n << BigInt(e - b.e)), e);
}

export function sub(a: Dyadic, b: Dyadic): Dyadic {
  return add(a, neg(b));
}

export function mul(a: Dyadic, b: Dyadic): Dyadic {
  if (a.n === 0n || b.n === 0n) return ZERO;
  return { n: a.n * b.n, e: a.e + b.e }; // the product of two odd numbers is odd
}

/** Multiplies by `2^k` (`k` integer, possibly negative). Exact, and just a change of exponent. */
export function shift(d: Dyadic, k: number): Dyadic {
  assertSafeInteger(k, "shift");
  return d.n === 0n ? d : { n: d.n, e: d.e - k };
}

export function sign(d: Dyadic): -1 | 0 | 1 {
  return d.n < 0n ? -1 : d.n > 0n ? 1 : 0;
}

export function compare(a: Dyadic, b: Dyadic): -1 | 0 | 1 {
  const e = Math.max(a.e, b.e);
  const x = a.n << BigInt(e - a.e);
  const y = b.n << BigInt(e - b.e);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function equals(a: Dyadic, b: Dyadic): boolean {
  return a.n === b.n && a.e === b.e;
}

/** Number of bits of the numerator: a measure of how precise (and how big in memory) a value is. */
export function significantBits(d: Dyadic): number {
  return d.n === 0n ? 0 : bitLength(d.n < 0n ? -d.n : d.n);
}

/** Text form, safe to put in JSON (a BigInt is not): `"3/2^-4"`. */
export function dyadicToString(d: Dyadic): string {
  return `${d.n}/2^${d.e}`;
}

/** Reads the text form. Accepts non-canonical input (`"4/2^2"`) and returns the canonical value. */
export function dyadicFromString(text: string): Dyadic {
  const match = /^(-?\d+)\/2\^(-?\d+)$/.exec(text);
  if (!match) throw new SyntaxError(`not a dyadic: "${text}"`);
  return dyadic(BigInt(match[1] as string), Number(match[2]));
}
