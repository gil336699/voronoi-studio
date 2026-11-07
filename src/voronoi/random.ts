// A small seeded random number generator (mulberry32), so the same seed always gives the same pattern.
export type Rng = () => number

export function createRng(seed: number): Rng {
  let a = (Math.floor(seed) >>> 0) || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A fresh seed for "Generate", kept to six digits so people can read and type it.
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999)
}
