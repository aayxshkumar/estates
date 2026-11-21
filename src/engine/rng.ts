// xoshiro128** with splitmix32 seeding. The whole generator state is four
// uint32 values stored inside GameState, so a game is a pure function of its
// seed and its action list, and a saved state resumes the same random stream.

export type RngState = [number, number, number, number];

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const next = splitmix32(seed);
  const s: RngState = [next(), next(), next(), next()];
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1;
  return s;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Advances `s` in place and returns a uint32. */
export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** Uniform integer in [0, n) without modulo bias. */
export function nextInt(s: RngState, n: number): number {
  if (n <= 0 || n > 0x100000000) throw new RangeError(`nextInt: bad bound ${n}`);
  const limit = 0x100000000 - (0x100000000 % n);
  for (;;) {
    const x = nextU32(s);
    if (x < limit) return x % n;
  }
}

/** Fisher–Yates shuffle in place. */
export function shuffle<T>(s: RngState, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = nextInt(s, i + 1);
    const tmp = xs[i]!;
    xs[i] = xs[j]!;
    xs[j] = tmp;
  }
  return xs;
}
