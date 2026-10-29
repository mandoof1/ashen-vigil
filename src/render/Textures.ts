/**
 * Procedural texture generation. Everything is created once at load and reused;
 * no texture is ever regenerated during ordinary combat.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/MathX';

export interface TextureSet {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

function makeCanvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData } {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  return { c, ctx, img };
}

/** Tileable value-noise fbm. Wraps at the edges so tiling has no seams. */
function fbm(size: number, octaves: number, baseFreq: number, seed: number, out: Float32Array): void {
  const rng = mulberry32(seed);
  const lattices: Float32Array[] = [];
  const freqs: number[] = [];
  for (let o = 0; o < octaves; o++) {
    const n = Math.max(2, Math.round(baseFreq * (2 ** o)));
    const l = new Float32Array(n * n);
    for (let i = 0; i < l.length; i++) l[i] = rng();
    lattices.push(l); freqs.push(n);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, amp = 1, norm = 0;
      for (let o = 0; o < octaves; o++) {
        const n = freqs[o], l = lattices[o];
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const i0 = ((y0 % n) + n) % n, i1 = (((y0 + 1) % n) + n) % n;
        const j0 = ((x0 % n) + n) % n, j1 = (((x0 + 1) % n) + n) % n;
        const a = l[i0 * n + j0], b = l[i0 * n + j1], c = l[i1 * n + j0], d = l[i1 * n + j1];
        const top = a + (b - a) * sx, bot = c + (d - c) * sx;
        sum += (top + (bot - top) * sy) * amp;
        norm += amp; amp *= 0.5;
      }
      out[y * size + x] = sum / norm;
    }
  }
}

function heightToNormal(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function textureFromPixels(pixels: Uint8ClampedArray, size: number, srgb: boolean, repeat: number): THREE.Texture {
  const { c, ctx, img } = makeCanvas(size);
  img.data.set(pixels);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; // data maps must stay linear
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function greyFromHeight(height: Float32Array, lo: number, hi: number, gamma: number): Uint8ClampedArray {
  const n = height.length;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.pow(Math.min(1, Math.max(0, height[i])), gamma);
    const g = (lo + (hi - lo) * v) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function tintFromHeight(height: Float32Array, size: number, base: [number, number, number], warm: [number, number, number], contrast: number, seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(height.length * 4);
  const rng = mulberry32(seed);
  const blotch = new Float32Array(height.length);
  fbm(size, 3, 4, seed, blotch);
  for (let i = 0; i < height.length; i++) {
    const v = 0.5 + (height[i] - 0.5) * contrast;
    const m = 0.72 + 0.5 * blotch[i] + 0.06 * rng();
    out[i * 4] = Math.min(255, (base[0] + (warm[0] - base[0]) * (v - 0.5) * 0.6) * m * (0.75 + 0.5 * v));
    out[i * 4 + 1] = Math.min(255, (base[1] + (warm[1] - base[1]) * (v - 0.5) * 0.6) * m * (0.75 + 0.5 * v));
    out[i * 4 + 2] = Math.min(255, (base[2] + (warm[2] - base[2]) * (v - 0.5) * 0.6) * m * (0.75 + 0.5 * v));
    out[i * 4 + 3] = 255;
  }
  return out;
}

export interface StoneOptions {
  size?: number;
  seed?: number;
  base?: [number, number, number];
  warm?: [number, number, number];
  cracks?: number;
  roughBase?: number;
}

/** Cold blue-grey stone: albedo + roughness + normal, all from one height field. */
export function makeStoneSet(opts: StoneOptions, repeat = 1): TextureSet {
  const size = opts.size ?? 512;
  const seed = opts.seed ?? 1337;
  const h = new Float32Array(size * size);
  fbm(size, 5, 3, seed, h);
  const grit = new Float32Array(size * size);
  fbm(size, 2, 32, seed + 7, grit);
  const cracks = new Float32Array(size * size);
  fbm(size, 3, 6, seed + 91, cracks);
  const crackAmount = opts.cracks ?? 0.55;
  for (let i = 0; i < h.length; i++) {
    const c = Math.abs(cracks[i] - 0.5);
    const groove = c < 0.045 ? (1 - c / 0.045) * crackAmount : 0;
    h[i] = h[i] * 0.78 + grit[i] * 0.22 - groove * 0.8;
  }
  const base = opts.base ?? [0.34, 0.38, 0.44];
  const warm = opts.warm ?? [0.46, 0.42, 0.36];
  const map = textureFromPixels(tintFromHeight(h, size, base, warm, 1.35, seed + 3), size, true, repeat);
  const rough = textureFromPixels(greyFromHeight(h, 0.62, 0.95, 0.9), size, false, repeat);
  const normal = textureFromPixels(heightToNormal(h, size, 2.6), size, false, repeat);
  const rb = opts.roughBase ?? 0.82;
  rough.colorSpace = THREE.NoColorSpace;
  // roughness map is multiplied by material.roughness; keep the material value near the authored base
  void rb;
  return { map, roughnessMap: rough, normalMap: normal };
}

/** Tarnished bronze / dark iron: low-frequency mottling, low roughness variance. */
export function makeMetalSet(seed: number, repeat = 1, size = 256): TextureSet {
  const h = new Float32Array(size * size);
  fbm(size, 4, 5, seed, h);
  const dents = new Float32Array(size * size);
  fbm(size, 3, 14, seed + 31, dents);
  for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.6 + dents[i] * 0.4;
  const map = textureFromPixels(tintFromHeight(h, size, [0.42, 0.34, 0.22], [0.55, 0.44, 0.26], 1.1, seed), size, true, repeat);
  const roughnessMap = textureFromPixels(greyFromHeight(h, 0.34, 0.78, 1), size, false, repeat);
  const normalMap = textureFromPixels(heightToNormal(h, size, 1.1), size, false, repeat);
  return { map, roughnessMap, normalMap };
}

export function makeClothSet(seed: number, base: [number, number, number], repeat = 1, size = 256): TextureSet {
  const h = new Float32Array(size * size);
  fbm(size, 3, 24, seed, h);
  const weave = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      weave[y * size + x] = (Math.sin(x * 1.6) * 0.5 + 0.5) * (Math.cos(y * 1.6) * 0.5 + 0.5) * 0.35;
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.6 + weave[i];
  const map = textureFromPixels(tintFromHeight(h, size, base, [base[0] * 1.3, base[1] * 1.2, base[2] * 1.1], 1.2, seed), size, true, repeat);
  const roughnessMap = textureFromPixels(greyFromHeight(h, 0.78, 0.98, 1), size, false, repeat);
  const normalMap = textureFromPixels(heightToNormal(h, size, 1.4), size, false, repeat);
  return { map, roughnessMap, normalMap };
}

export function makeWoodSet(seed: number, repeat = 1, size = 256): TextureSet {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - size * 0.3, y - size * 0.5);
      h[y * size + x] = (Math.sin(r * 0.22) * 0.5 + 0.5) * 0.7;
    }
  }
  const n = new Float32Array(size * size);
  fbm(size, 4, 8, seed, n);
  for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.7 + n[i] * 0.3;
  const map = textureFromPixels(tintFromHeight(h, size, [0.24, 0.19, 0.14], [0.34, 0.26, 0.17], 1.2, seed), size, true, repeat);
  const roughnessMap = textureFromPixels(greyFromHeight(h, 0.6, 0.9, 1), size, false, repeat);
  const normalMap = textureFromPixels(heightToNormal(h, size, 1.2), size, false, repeat);
  return { map, roughnessMap, normalMap };
}

/** Ash-covered ground: broad tonal drift plus fine grain. */
export function makeGroundSet(size = 512, repeat = 1): TextureSet {
  const h = new Float32Array(size * size);
  fbm(size, 6, 2, 4242, h);
  const fine = new Float32Array(size * size);
  fbm(size, 2, 48, 99, fine);
  for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.72 + fine[i] * 0.28;
  const map = textureFromPixels(tintFromHeight(h, size, [0.30, 0.31, 0.33], [0.40, 0.36, 0.31], 1.25, 77), size, true, repeat);
  const roughnessMap = textureFromPixels(greyFromHeight(h, 0.72, 0.98, 1), size, false, repeat);
  const normalMap = textureFromPixels(heightToNormal(h, size, 1.9), size, false, repeat);
  return { map, roughnessMap, normalMap };
}

/** Soft radial sprite used for sparks, ember glows and contact shadows. */
export function makeRadialSprite(inner: string, outer: string, size = 128, mid = inner, outerMid = outer): THREE.Texture {
  const { c, ctx } = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // a soft, fully-faded rim: a glow sprite must never show a square edge
  g.addColorStop(0, inner);
  g.addColorStop(0.18, inner);
  g.addColorStop(0.42, mid);
  g.addColorStop(0.72, outerMid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Grass / moss tuft alpha map: blades, not flat quads. */
export function makeTuftTexture(size = 64): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(4242);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = size * (0.06 + rng() * 0.88);
    const h = size * (0.4 + rng() * 0.58);
    const lean = (rng() - 0.5) * size * 0.4;
    const w = size * (0.025 + rng() * 0.05);
    ctx.beginPath();
    ctx.moveTo(x - w, size);
    ctx.quadraticCurveTo(x + lean * 0.4, size - h * 0.6, x + lean, size - h);
    ctx.quadraticCurveTo(x + lean * 0.4 + w, size - h * 0.6, x + w, size);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, size, 0, size - h);
    g.addColorStop(0, 'rgba(140,150,120,0.95)');
    g.addColorStop(1, 'rgba(196,204,176,0.5)');
    ctx.fillStyle = g;
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Procedural equirect sky used for the one-off PMREM environment map. */
export function makeSkyCanvas(size = 512): HTMLCanvasElement {
  const { c, ctx } = makeCanvas(size);
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#101a2c');
  g.addColorStop(0.42, '#243244');
  g.addColorStop(0.55, '#43536a');
  g.addColorStop(0.62, '#6d6a5f');
  g.addColorStop(0.75, '#2a2f36');
  g.addColorStop(1, '#12161c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // the moon sits over the sanctuary, i.e. in the direction the vigil faces when it looks north
  const mx = size * 0.336, my = size * 0.345;
  const rg = ctx.createRadialGradient(mx, my, 0, mx, my, size * 0.14);
  rg.addColorStop(0, 'rgba(190,210,235,0.55)');
  rg.addColorStop(0.35, 'rgba(160,186,216,0.22)');
  rg.addColorStop(1, 'rgba(120,140,170,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, size, size);
  // moon disc with a soft limb, so the sky has one bright anchor instead of a flat wash
  const dg = ctx.createRadialGradient(mx, my, 0, mx, my, size * 0.030);
  dg.addColorStop(0, 'rgba(240,246,255,1)');
  dg.addColorStop(0.62, 'rgba(224,234,250,0.95)');
  dg.addColorStop(0.85, 'rgba(190,206,230,0.35)');
  dg.addColorStop(1, 'rgba(180,196,220,0)');
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.arc(mx, my, size * 0.030, 0, Math.PI * 2);
  ctx.fill();
  // faint craters so the disc is not a perfect coin
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#8f9cb2';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, r = size * 0.013 * (0.3 + (i % 3) * 0.28);
    ctx.beginPath();
    ctx.arc(mx + Math.cos(a) * size * 0.011, my + Math.sin(a) * size * 0.009, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // ember horizon glow (the valley fires)
  const eg = ctx.createLinearGradient(0, size * 0.55, 0, size * 0.68);
  eg.addColorStop(0, 'rgba(240,140,60,0.0)');
  eg.addColorStop(0.6, 'rgba(240,140,60,0.16)');
  eg.addColorStop(1, 'rgba(240,140,60,0.0)');
  ctx.fillStyle = eg;
  ctx.fillRect(0, size * 0.5, size, size * 0.2);
  const rng = mulberry32(9001);
  ctx.fillStyle = 'rgba(220,230,245,0.75)';
  for (let i = 0; i < 220; i++) {
    const x = rng() * size, y = rng() * size * 0.45;
    const s = rng() * 1.4 + 0.3;
    ctx.globalAlpha = 0.15 + rng() * 0.5;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
  return c;
}

export function disposeTextureSet(set: TextureSet): void {
  set.map.dispose();
  set.roughnessMap.dispose();
  set.normalMap.dispose();
}
