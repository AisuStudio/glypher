// Deterministic per-key randomness: the same seed string always produces the
// same sequence of numbers. Animate-mode presets use this so randomized
// values (e.g. dash/gap lengths) come out byte-identical between the live
// preview and the downloaded export for the same input, instead of
// re-rolling on every render/export.

function hashString(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRandom(seedKey: string): () => number {
  return mulberry32(hashString(seedKey));
}

export function randomRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
