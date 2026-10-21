// Seeded PRNG (mulberry32) for Mage Siege. The only randomness source in the
// simulation: Math.random would break replay verification.

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in 0..n-1. */
  int(n: number): number;
  pick<T>(a: readonly T[]): T;
  /** Current uint32 state; makeRng(state()) continues the same stream. */
  state(): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (a) => a[Math.floor(next() * a.length)],
    state: () => s,
  };
}
