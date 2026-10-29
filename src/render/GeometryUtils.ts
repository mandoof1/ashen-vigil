/** Geometry helpers: world-space UV density, vertex-colour baking, chunked merging. */
import * as THREE from 'three';

export type RGB = [number, number, number];

const WHITE: RGB = [1, 1, 1];

/** Box with UVs scaled to world size so texel density is constant across the level. */
export function boxGeo(w: number, h: number, d: number, uvScale = 0.5, color: RGB = WHITE): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  scaleBoxUVs(g, w, h, d, uvScale);
  bakeColor(g, color);
  return g;
}

function scaleBoxUVs(g: THREE.BufferGeometry, w: number, h: number, d: number, uvScale: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z — four vertices each.
  const dims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * su * uvScale, uv.getY(i) * sv * uvScale);
    }
  }
  uv.needsUpdate = true;
}

/** Cylinder / tapered cylinder (used for pillars, columns, braziers) with world-space UVs. */
export function cylGeo(radiusTop: number, radiusBottom: number, height: number, segments = 12, uvScale = 0.5, color: RGB = WHITE, openEnded = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, openEnded);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circ = (radiusTop + radiusBottom) * Math.PI;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ * uvScale, uv.getY(i) * height * uvScale);
  uv.needsUpdate = true;
  bakeColor(g, color);
  return g;
}

export function sphereGeo(radius: number, segments = 12, color: RGB = WHITE): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, segments, Math.max(4, segments >> 1));
  bakeColor(g, color);
  return g;
}

export function coneGeo(radius: number, height: number, segments = 10, color: RGB = WHITE): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, segments);
  bakeColor(g, color);
  return g;
}

export function torusGeo(radius: number, tube: number, segments = 12, color: RGB = WHITE): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 6, segments);
  bakeColor(g, color);
  return g;
}

/** Plane with world-space UVs (banners, floors drawn as thin slabs use boxes instead). */
export function planeGeo(w: number, h: number, uvScale = 0.5, color: RGB = WHITE): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * uvScale, uv.getY(i) * h * uvScale);
  uv.needsUpdate = true;
  bakeColor(g, color);
  return g;
}

export function bakeColor(g: THREE.BufferGeometry, color: RGB, jitter = 0, rng?: () => number): void {
  const pos = g.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const j = jitter > 0 && rng ? (rng() - 0.5) * jitter : 0;
    arr[i * 3] = Math.min(1, Math.max(0, color[0] + j));
    arr[i * 3 + 1] = Math.min(1, Math.max(0, color[1] + j));
    arr[i * 3 + 2] = Math.min(1, Math.max(0, color[2] + j));
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** Vertical gradient bake: darker at the base (cheap baked contact darkening). */
export function bakeVerticalAO(g: THREE.BufferGeometry, base: number, top: number, height: number, center = 0): void {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - center + height / 2) / Math.max(1e-4, height)));
    const shade = base + (top - base) * t;
    col.setXYZ(i, col.getX(i) * shade, col.getY(i) * shade, col.getZ(i) * shade);
  }
  col.needsUpdate = true;
}

export function transform(g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const e = new THREE.Euler(pitch, yaw, roll, 'YXZ');
  m.makeRotationFromEuler(e);
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}
