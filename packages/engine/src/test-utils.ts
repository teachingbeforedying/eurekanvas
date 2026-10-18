// Helpers shared by the tests. Not part of the engine's public API.

/** `items[index]`, failing loudly instead of returning `undefined`. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${index}`);
  return item;
}

export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, max). */
  int(max: number): number;
  /** A non-negative BigInt of up to `bits` bits. */
  bits(bits: number): bigint;
  /** Any finite double, drawn over the whole range of exponents (subnormals included). */
  finiteDouble(): number;
}

/** A small seeded generator (mulberry32), so that "random" tests always give the same result. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uint32 = (): number => Math.floor(next() * 4294967296);
  const view = new DataView(new ArrayBuffer(8));
  return {
    next,
    int: (max) => Math.floor(next() * max),
    bits: (bits) => {
      let value = 0n;
      for (let done = 0; done < bits; done += 32) {
        value = (value << 32n) | BigInt(uint32());
      }
      return value >> BigInt(Math.ceil(bits / 32) * 32 - bits);
    },
    finiteDouble: () => {
      for (;;) {
        view.setUint32(0, uint32());
        view.setUint32(4, uint32());
        const x = view.getFloat64(0);
        if (Number.isFinite(x)) return x;
      }
    },
  };
}
