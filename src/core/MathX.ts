/** Small math helpers. Frame-rate independent damping everywhere. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Exponential smoothing that behaves identically at 30, 60, 144 or 240 fps. */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  const t = 1 - Math.pow(2, -dt / halfLife);
  return current + (target - current) * t;
}

/** Rate-based exponential approach (higher rate = snappier). */
export function approachRate(current: number, target: number, rate: number, dt: number): number {
  return damp(current, target, Math.LN2 / Math.max(rate, 1e-3), dt);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function wrapAngle(a: number): number {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function rotateVec(x: number, z: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: x * c - z * s, z: x * s + z * c };
}

export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function norm2(x: number, z: number): { x: number; z: number; len: number } {
  const l = Math.sqrt(x * x + z * z);
  if (l < 1e-6) return { x: 0, z: 0, len: 0 };
  return { x: x / l, z: z / l, len: l };
}

/** Deterministic PRNG so procedural decoration is identical every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

export function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(randRange(rng, lo, hi + 1));
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}
