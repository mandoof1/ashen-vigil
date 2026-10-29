/**
 * Builds the whole level: visual geometry AND collision from the same descriptors,
 * so the two can never disagree. Static geometry is merged per chunk per material
 * (a handful of draw calls, free frustum culling, no per-object overhead).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../render/Materials';
import { makeTuftTexture } from '../render/Textures';
import { bakeColor, bakeVerticalAO, boxGeo, cylGeo, planeGeo, transform } from '../render/GeometryUtils';
import type { PhysicsWorld } from '../physics/Physics';
import { mulberry32, randRange, DEG } from '../core/MathX';
import {
  AREAS, FLOORS, PILLARS, STAIRS, WALLS,
  type FloorDef, type WallDef,
} from './LevelData';

export type ChunkName = 'approach' | 'courtyard' | 'cloister' | 'passage' | 'westcorridor' | 'stair' | 'chamber';
type MatKey = 'stoneWall' | 'stoneFloor' | 'stoneStep' | 'stoneCarved' | 'ground' | 'bronze' | 'iron' | 'wood' | 'moss' | 'clothBanner' | 'ash';

interface Collected { geos: THREE.BufferGeometry[] }

export interface BuiltLevel {
  group: THREE.Group;
  chunkMeshes: Map<string, THREE.Mesh[]>;
  lodPairs: Array<{ hi: THREE.Object3D; lo: THREE.Object3D; center: THREE.Vector3; radius: number }>;
  clusters: Array<{ object: THREE.Object3D; center: THREE.Vector3; radius: number; kind: 'vegetation' | 'decoration' }>;
  dispose(): void;
}

export class LevelBuilder {
  private collector = new Map<string, Collected>();
  private disposables: Array<{ dispose(): void }> = [];
  private rng = mulberry32(20240814);
  private group = new THREE.Group();
  private lodPairs: BuiltLevel['lodPairs'] = [];
  private clusters: BuiltLevel['clusters'] = [];

  constructor(private phys: PhysicsWorld, private mats: MaterialLibrary) {}

  private add(chunk: string, mat: MatKey, geo: THREE.BufferGeometry): void {
    const key = `${chunk}|${mat}`;
    let entry = this.collector.get(key);
    if (!entry) {
      entry = { geos: [] };
      this.collector.set(key, entry);
    }
    entry.geos.push(geo);
  }

  private box(chunk: string, mat: MatKey, x: number, y: number, z: number, w: number, h: number, d: number, opts: { yaw?: number; uvScale?: number; shade?: number; ao?: number; collider?: boolean; jitter?: boolean } = {}): void {
    const g = boxGeo(w, h, d, opts.uvScale ?? 0.42, [opts.shade ?? 1, opts.shade ?? 1, opts.shade ?? 1]);
    if (opts.ao !== undefined) bakeVerticalAO(g, opts.ao, 1, h);
    if (opts.jitter) bakeColor(g, [opts.shade ?? 1, opts.shade ?? 1, opts.shade ?? 1], 0.08, this.rng);
    transform(g, x, y, z, opts.yaw ?? 0);
    this.add(chunk, mat, g);
    if (opts.collider) {
      this.phys.box(x, y, z, w / 2, h / 2, d / 2, opts.yaw ?? 0);
    }
  }

  private cyl(chunk: string, mat: MatKey, x: number, y: number, z: number, rTop: number, rBottom: number, h: number, seg = 12, collider = false, yaw = 0): void {
    const g = cylGeo(rTop, rBottom, h, seg, 0.42);
    transform(g, x, y, z, yaw);
    this.add(chunk, mat, g);
    if (collider) this.phys.cylinder(x, y, z, h / 2, Math.max(rTop, rBottom));
  }

  // ------------------------------------------------------------ main build
  build(): BuiltLevel {
    this.buildFloors();
    this.buildWalls();
    this.buildStairs();
    this.buildPillars();
    this.buildApproachLandmarks();
    this.buildCourtyard();
    this.buildCloister();
    this.buildCorridors();
    this.buildStairArea();
    this.buildChamber();
    this.buildScatter();

    const chunkMeshes = new Map<string, THREE.Mesh[]>();
    for (const [key, entry] of this.collector) {
      const [chunk, matKey] = key.split('|') as [ChunkName, MatKey];
      if (entry.geos.length === 0) continue;
      const merged = mergeGeometries(entry.geos, false);
      if (!merged) continue;
      for (const g of entry.geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats[matKey]);
      mesh.castShadow = matKey !== 'ground';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = `level_${chunk}_${matKey}`;
      this.group.add(mesh);
      const list = chunkMeshes.get(chunk) ?? [];
      list.push(mesh);
      chunkMeshes.set(chunk, list);
      this.disposables.push(merged);
    }

    return {
      group: this.group,
      chunkMeshes,
      lodPairs: this.lodPairs,
      clusters: this.clusters,
      dispose: () => {
        for (const d of this.disposables) d.dispose();
        this.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
      },
    };
  }

  // ------------------------------------------------------------- structures
  private buildFloors(): void {
    for (const f of FLOORS) {
      const w = f.x2 - f.x1, d = f.z2 - f.z1;
      const cx = (f.x1 + f.x2) / 2, cz = (f.z1 + f.z2) / 2;
      const cy = f.topY - f.thickness / 2;
      const mat: MatKey = f.kind === 'ground' ? 'ground' : 'stoneFloor';
      this.add(f.chunk, mat, transform(boxGeo(w, f.thickness, d, 0.35, [1, 1, 1]), cx, cy, cz));
      this.phys.box(cx, cy, cz, w / 2, f.thickness / 2, d / 2);
      // worn edge trim for readability of ledges
      if (f.topY > 0.5) {
        this.edgeTrim(f);
      }
    }
  }

  private edgeTrim(f: FloorDef): void {
    const t = 0.35;
    const y = f.topY - t / 2;
    this.box(f.chunk, 'stoneCarved', (f.x1 + f.x2) / 2, y, f.z1 + t / 2, f.x2 - f.x1, t, t, { shade: 1.06 });
    this.box(f.chunk, 'stoneCarved', (f.x1 + f.x2) / 2, y, f.z2 - t / 2, f.x2 - f.x1, t, t, { shade: 1.06 });
    this.box(f.chunk, 'stoneCarved', f.x1 + t / 2, y, (f.z1 + f.z2) / 2, t, t, f.z2 - f.z1, { shade: 1.06 });
    this.box(f.chunk, 'stoneCarved', f.x2 - t / 2, y, (f.z1 + f.z2) / 2, t, t, f.z2 - f.z1, { shade: 1.06 });
  }

  private buildWalls(): void {
    for (const w of WALLS) {
      const alongX = Math.abs(w.x2 - w.x1) >= Math.abs(w.z2 - w.z1);
      const start = alongX ? w.x1 : w.z1;
      const end = alongX ? w.x2 : w.z2;
      const segments: Array<[number, number]> = [];
      let cursor = start;
      const gaps = [...w.gaps].sort((a, b) => a[0] - b[0]);
      for (const [g0, g1] of gaps) {
        if (g0 > cursor) segments.push([cursor, g0]);
        cursor = Math.max(cursor, g1);
      }
      if (cursor < end) segments.push([cursor, end]);

      for (const [s0, s1] of segments) {
        const len = s1 - s0;
        if (len <= 0.01) continue;
        const mid = (s0 + s1) / 2;
        const cx = alongX ? mid : w.x1;
        const cz = alongX ? w.z1 : mid;
        const y = w.baseY + w.height / 2;
        const geoW = alongX ? len : w.thickness;
        const geoD = alongX ? w.thickness : len;
        this.add(w.chunk, 'stoneWall', transform(boxGeo(geoW, w.height, geoD, 0.4, [1, 1, 1]), cx, y, cz));
        bakeVerticalAOLast(this.collector, w.chunk, 'stoneWall', w.height, y);
        this.phys.box(cx, y, cz, geoW / 2, w.height / 2, geoD / 2);
        this.wallDressings(w, cx, cz, len, alongX);
      }
      // gate posts / arches at every gap
      for (const [g0, g1] of gaps) {
        const mid = (g0 + g1) / 2;
        const cx = alongX ? mid : w.x1;
        const cz = alongX ? w.z1 : mid;
        this.arch(w, cx, cz, g1 - g0, alongX);
      }
    }
  }

  /** Crenellations, buttresses and a plinth band: silhouette detail without collision noise. */
  private wallDressings(w: WallDef, cx: number, cz: number, len: number, alongX: boolean): void {
    const chunk = w.chunk;
    const baseY = w.baseY;
    // plinth
    const plinthH = 0.6;
    this.add(chunk, 'stoneCarved', transform(boxGeo(alongX ? len : w.thickness + 0.5, plinthH, alongX ? w.thickness + 0.5 : len, 0.4, [1.12, 1.1, 1.06]), cx, baseY + plinthH / 2, cz));
    if (w.kind === 'parapet') return;
    // crenellations
    const step = 2.2;
    const count = Math.max(1, Math.floor(len / step));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const off = -len / 2 + t * len;
      const px = alongX ? cx + off : cx;
      const pz = alongX ? cz : cz + off;
      if (i % 2 === 0) {
        this.add(chunk, 'stoneWall', transform(boxGeo(alongX ? step * 0.7 : w.thickness, 0.85, alongX ? w.thickness : step * 0.7, 0.4, [0.92, 0.95, 1.0]), px, baseY + w.height + 0.42, pz));
      }
    }
    // buttresses every ~9m
    const butt = Math.max(1, Math.floor(len / 9));
    for (let i = 0; i < butt; i++) {
      const t = (i + 0.5) / butt;
      const off = -len / 2 + t * len;
      const px = alongX ? cx + off : cx + (w.x2 > w.x1 ? 0 : 0);
      const pz = alongX ? cz : cz + off;
      const outward = alongX ? (w.x1 >= 0 ? 1 : -1) : (w.z1 >= 0 ? 1 : -1);
      const bx = alongX ? px + outward * (w.thickness / 2 + 0.5) : px;
      const bz = alongX ? pz : pz + outward * (w.thickness / 2 + 0.5);
      const h = w.height * 0.72;
      this.add(chunk, 'stoneWall', transform(boxGeo(alongX ? 1.1 : w.thickness + 1.1, h, alongX ? w.thickness + 1.1 : 1.1, 0.4, [0.9, 0.93, 0.98]), bx, baseY + h / 2, bz));
    }
  }

  private arch(w: WallDef, cx: number, cz: number, opening: number, alongX: boolean): void {
    const chunk = w.chunk;
    const baseY = w.baseY;
    const postW = 0.9;
    const px = alongX ? cx - opening / 2 - postW / 2 : cx;
    const pz = alongX ? cz : cz - opening / 2 - postW / 2;
    const qx = alongX ? cx + opening / 2 + postW / 2 : cx;
    const qz = alongX ? cz : cz + opening / 2 + postW / 2;
    const ph = w.height + 0.9;
    for (const [x, z] of [[px, pz], [qx, qz]] as const) {
      this.add(chunk, 'stoneCarved', transform(boxGeo(alongX ? postW : w.thickness + 0.8, ph, alongX ? w.thickness + 0.8 : postW, 0.5, [1.14, 1.12, 1.08]), x, baseY + ph / 2, z));
      this.phys.box(x, baseY + ph / 2, z, (alongX ? postW : w.thickness + 0.8) / 2, ph / 2, (alongX ? w.thickness + 0.8 : postW) / 2);
    }
    // lintel + broken arch spandrel
    const lintelY = baseY + w.height + 0.35;
    this.add(chunk, 'stoneCarved', transform(boxGeo(alongX ? opening + postW * 2 : w.thickness + 1.2, 1.0, alongX ? w.thickness + 1.2 : opening + postW * 2, 0.5, [1.1, 1.08, 1.04]), cx, lintelY, cz));
    this.add(chunk, 'stoneCarved', transform(boxGeo(alongX ? opening * 0.55 : w.thickness + 0.6, 0.7, alongX ? w.thickness + 0.6 : opening * 0.55, 0.5, [1.02, 1.0, 0.98]), cx, lintelY + 0.85, cz));
  }

  private buildStairs(): void {
    for (const s of STAIRS) {
      const run = s.z2 - s.z1;
      const rise = s.y1 - s.y0;
      const steps = Math.max(4, Math.round(Math.abs(run) / 0.55));
      const dir = Math.sign(run);
      const stepRun = run / steps;
      const stepRise = rise / steps;
      const width = s.x2 - s.x1;
      const cx = (s.x1 + s.x2) / 2;
      // Collision is a single ramp through the tread noses; the treads themselves are visual.
      // Per-tread colliders make a character controller snag on every riser, and a ramp the
      // player walks up at full speed (see Actor.slopeFollow) is both cheaper and more stable.
      const slope = Math.atan2(Math.abs(rise), Math.abs(run));
      const rampLen = Math.hypot(run, rise);
      const rampThick = 0.5;
      const midZ = (s.z1 + s.z2) / 2;
      const midY = (s.y0 + s.y1) / 2 - rampThick / 2 * Math.cos(slope);
      const pitch = -Math.sign(rise) * slope * (dir > 0 ? 1 : -1);
      this.phys.ramp(cx, midY, midZ, width / 2, rampThick / 2, rampLen / 2, pitch);
      for (let i = 0; i < steps; i++) {
        const z = s.z1 + stepRun * (i + 0.5);
        const y = s.y0 + stepRise * (i + 1);
        const h = Math.abs(stepRise) + 0.16;
        const d = Math.abs(stepRun) + 0.06;
        this.add(s.chunk, 'stoneStep', transform(boxGeo(width, h, d, 0.5, [1.04, 1.04, 1.02]), cx, y - h / 2 + 0.02, z));
      }
      // stringer walls
      for (const sx of [s.x1, s.x2]) {
        this.add(s.chunk, 'stoneWall', transform(boxGeo(0.6, Math.abs(rise) + 1.4, Math.abs(run) + 0.6, 0.4, [0.95, 0.98, 1.0]), sx, Math.min(s.y0, s.y1) + (Math.abs(rise) + 1.4) / 2 - 0.4, midZ));
      }
      void dir;
    }
  }

  private buildPillars(): void {
    for (const p of PILLARS) {
      const h = p.height;
      this.cyl(p.chunk, 'stoneCarved', p.x, p.y + h / 2, p.z, p.radius * (p.broken ? 0.82 : 0.92), p.radius * 1.12, h, 14, true);
      // base + capital
      this.cyl(p.chunk, 'stoneCarved', p.x, p.y + 0.3, p.z, p.radius * 1.3, p.radius * 1.45, 0.6, 12);
      if (!p.broken) this.cyl(p.chunk, 'stoneCarved', p.x, p.y + h - 0.3, p.z, p.radius * 1.35, p.radius * 1.05, 0.6, 12);
      if (p.broken) {
        // fallen drum at the foot
        const a = this.rng() * Math.PI * 2;
        const fx = p.x + Math.cos(a) * (p.radius + 1.4), fz = p.z + Math.sin(a) * (p.radius + 1.4);
        this.add(p.chunk, 'stoneWall', transform(cylGeo(p.radius, p.radius * 1.05, 1.6, 10, 0.4), fx, p.y + p.radius, fz, 0, Math.PI / 2, Math.PI / 2));
        this.phys.cylinder(fx, p.y + p.radius, fz, 0.8, p.radius);
      }
    }
  }

  // ---------------------------------------------------------- area dressing
  private buildApproachLandmarks(): void {
    const c: ChunkName = 'approach';
    // ruined path slabs (visual only)
    for (let z = 44; z > 10; z -= 3.1) {
      const w = randRange(this.rng, 2.4, 4.6);
      this.add(c, 'stoneFloor', transform(boxGeo(w, 0.16, 2.2, 0.5, [1.1, 1.08, 1.05]), randRange(this.rng, -2.5, 2.5), 3.08, z, randRange(this.rng, -0.1, 0.1)));
    }
    // the first broken bell, half-buried
    this.bellFragment(c, 8, 3, 38, 2.2, 0.4);
    this.bellFragment(c, -6, 3, 33, 1.2, -0.7);
    // shrine plinth with inscription
    this.box(c, 'stoneCarved', 8, 3.5, 38, 2.6, 1.0, 2.0, { shade: 1.15, uvScale: 0.6 });
    this.box(c, 'stoneCarved', 8, 4.6, 38.9, 2.2, 1.4, 0.4, { shade: 1.2, uvScale: 0.7 });
    // burned banners on the canyon walls
    for (const z of [40, 30, 20]) {
      this.banner(c, 10.9, 8.2, z, 2.2, 4.4, Math.PI / 2);
      this.banner(c, -10.9, 8.2, z + 5, 2.2, 4.4, -Math.PI / 2);
    }
    // arch at the entrance to the courtyard
    this.box(c, 'stoneCarved', -5.2, 4.6, 9, 1.6, 3.2, 1.6, { shade: 1.16 });
    this.box(c, 'stoneCarved', 5.2, 4.6, 9, 1.6, 3.2, 1.6, { shade: 1.16 });
    // offering nook
    this.box(c, 'stoneCarved', -16, 3.2, 21, 2.4, 0.4, 1.6, { shade: 1.1 });
    this.box(c, 'wood', -16, 3.9, 24.6, 0.4, 1.4, 0.4, { shade: 0.9 });
  }

  private bellFragment(chunk: ChunkName, x: number, y: number, z: number, r: number, yaw: number): void {
    const g = cylGeo(r * 0.55, r, r * 1.5, 14, 0.5, [0.95, 0.92, 0.9]);
    this.add(chunk, 'bronze', transform(g, x, y + r * 0.55, z, yaw, Math.PI / 2, 0));
  }

  private banner(chunk: ChunkName, x: number, y: number, z: number, w: number, h: number, yaw: number): void {
    const g = planeGeo(w, h, 0.45, [1, 1, 1]);
    // tattered bottom edge: displace a few vertices
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < -h * 0.45) pos.setY(i, pos.getY(i) + randRange(this.rng, 0, 0.7));
    }
    g.computeVertexNormals();
    this.add(chunk, 'clothBanner', transform(g, x, y - h / 2, z, yaw));
    this.add(chunk, 'iron', transform(boxGeo(w + 0.3, 0.16, 0.16, 0.4), x, y + 0.1, z, yaw));
  }

  private buildCourtyard(): void {
    const c: ChunkName = 'courtyard';
    // flagstones with worn inlay rings
    for (let x = -18; x <= 18; x += 6) {
      for (let z = -13; z <= 7; z += 6) {
        this.add(c, 'stoneFloor', transform(boxGeo(5.6, 0.1, 5.6, 0.4, [1.06, 1.05, 1.03]), x, 0.05, z));
      }
    }
    // sunken brazier plinth in the middle
    this.box(c, 'stoneCarved', -4, 0.35, -6, 5.2, 0.7, 5.2, { shade: 1.12 });
    this.brazier(c, -4, 0.7, -6, 1.0);
    // fallen column blocking movement
    this.add(c, 'stoneCarved', transform(cylGeo(0.75, 0.8, 6.4, 14, 0.4), -10, 0.8, 2, 0.35, Math.PI / 2, 0));
    this.phys.cylinder(-10, 0.8, 2, 3.2, 0.8);
    this.add(c, 'stoneCarved', transform(cylGeo(0.8, 0.85, 5.2, 14, 0.4), 12, 0.8, -8, -0.6, Math.PI / 2, 0));
    this.phys.cylinder(12, 0.8, -8, 2.6, 0.8);
    // broken cart + crates (cover)
    this.box(c, 'wood', -14, 0.7, -1, 2.6, 1.4, 1.6, { yaw: 0.6, shade: 0.95 });
    this.box(c, 'wood', -12.4, 0.5, -2.6, 1.2, 1.0, 1.2, { yaw: -0.3, shade: 1.05 });
    this.box(c, 'wood', 13, 0.6, 4, 1.6, 1.2, 1.4, { yaw: 1.1, shade: 0.98 });
    // offering stones near the south arch
    this.box(c, 'stoneCarved', 22, 0.4, 8, 2.2, 0.8, 1.6, { shade: 1.1 });
    this.banner(c, 19.6, 5.2, -6, 2.4, 4.6, -Math.PI / 2);
    this.banner(c, 19.6, 5.2, 6, 2.4, 4.6, -Math.PI / 2);
    // relief plinth
    this.box(c, 'stoneCarved', 34, 0.5, 9, 3.0, 1.0, 1.6, { shade: 1.15 });
    this.box(c, 'stoneCarved', 34, 1.6, 9.7, 2.6, 1.6, 0.4, { shade: 1.2, uvScale: 0.7 });
    // vista: distant bell tower silhouette (background landmark, no collision)
    this.landmarkTower();
  }

  /** Big background silhouette: the sanctuary tower + valley walls, cheap geometry. */
  private landmarkTower(): void {
    const c = 'deco';
    const add = (g: THREE.BufferGeometry, mat: MatKey) => this.add(c, mat, g);
    // tower behind the chamber
    add(transform(cylGeo(6.5, 8.5, 34, 10, 0.12, [0.5, 0.55, 0.62]), 0, 12, -74), 'stoneWall');
    add(transform(cylGeo(9.5, 7.0, 6, 10, 0.12, [0.42, 0.46, 0.52]), 0, 32, -74), 'stoneWall');
    add(transform(cylGeo(0.4, 3.2, 8, 6, 0.12, [0.35, 0.38, 0.42]), 0, 38, -74), 'iron');
    // valley walls
    for (const [x, z, r, h] of [[-70, -30, 26, 30], [-52, 20, 22, 24], [64, -10, 30, 34], [58, 40, 20, 22], [0, 78, 34, 26]] as const) {
      add(transform(cylGeo(r * 0.55, r, h, 8, 0.08, [0.34, 0.38, 0.44]), x, h / 2 - 2, z), 'ash');
    }
    // ruined outer wall ring around the sanctuary
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 34 + Math.sin(i * 2.3) * 3;
      const h = 6 + Math.abs(Math.sin(i * 1.7)) * 7;
      add(transform(boxGeo(4.2, h, 2.2, 0.2, [0.6, 0.64, 0.7]), Math.cos(a) * r, h / 2 - 1, -34 + Math.sin(a) * r, a), 'stoneWall');
    }
  }

  public emitters: Array<{ x: number; y: number; z: number; color: number; intensity: number; range: number }> = [];

  private brazier(chunk: ChunkName, x: number, y: number, z: number, r: number): void {
    this.emitters.push({ x, y: y + 1.7, z, color: 0xff9a4a, intensity: 11, range: 11 });
    this.cyl(chunk, 'iron', x, y + 0.9, z, r, r * 0.55, 1.8, 10, false);
    this.cyl(chunk, 'iron', x, y + 1.85, z, r * 1.15, r * 1.0, 0.3, 12);
    this.cyl(chunk, 'iron', x, y + 0.35, z, r * 0.35, r * 0.7, 0.7, 8);
    this.phys.cylinder(x, y + 0.9, z, 0.9, r * 0.9);
  }

  private buildCloister(): void {
    const c: ChunkName = 'cloister';
    // arcade along the south: broken wall segments (the ambush telegraph)
    this.box(c, 'stoneWall', 33, 1.6, -6.2, 7.0, 3.2, 1.2, { collider: true, shade: 0.98, ao: 0.72 });
    this.box(c, 'stoneWall', 37.5, 0.9, -8.5, 2.4, 1.8, 1.2, { collider: true, yaw: 0.25, shade: 0.94 });
    this.brazier(c, 30.5, 0, -6.2, 0.8);
    // collapsed rubble wall silhouette (visible from the arch)
    this.box(c, 'stoneWall', 28, 1.1, -14, 5.0, 2.2, 1.2, { collider: true, shade: 0.96, ao: 0.7 });
    // benches + coffins
    for (const [x, z, yaw] of [[24, 2, 0], [38, 2, 0], [24, -6, 0.1], [38, -6, -0.1]] as const) {
      this.box(c, 'wood', x, 0.45, z, 2.6, 0.9, 1.1, { yaw, shade: 0.92 });
    }
    for (const [x, z] of [[30, 9], [36, 9]] as const) {
      this.box(c, 'wood', x, 0.6, z, 2.2, 1.2, 1.2, { yaw: 0.2, shade: 0.88 });
    }
    // balcony railings
    for (let z = -22; z <= 4; z += 2) {
      this.box(c, 'stoneCarved', 40, 3.9, z, 0.35, 1.1, 0.35, { shade: 1.08 });
    }
    for (let x = 27; x <= 39; x += 2) {
      this.box(c, 'stoneCarved', x, 3.9, -19, 0.35, 1.1, 0.35, { shade: 1.08 });
    }
    // banners
    this.banner(c, 46.6, 6.4, -4, 2.6, 5.2, -Math.PI / 2);
    this.banner(c, 46.6, 6.4, 6, 2.6, 5.2, -Math.PI / 2);
    // shrine corner
    this.box(c, 'stoneCarved', 44, 0.4, 8, 2.4, 0.8, 2.4, { shade: 1.12 });
  }

  private buildCorridors(): void {
    const w: ChunkName = 'westcorridor';
    const p: ChunkName = 'passage';
    for (const chunk of [w, p]) {
      for (let i = 0; i < 6; i++) {
        const x = chunk === w ? -29 + i * 3.4 : 12.5 + i * 1.6;
        const z = chunk === w ? -20 : -19;
        this.box(chunk, 'stoneWall', x, 2.4, z + (i % 2 ? 1.6 : -1.6), 1.6, 4.8, 0.9, { shade: 0.94, ao: 0.75 });
      }
    }
    this.box(w, 'stoneCarved', -27, 0.5, -19, 2.0, 1.0, 1.6, { shade: 1.14 });
    this.box(p, 'stoneCarved', 14, 0.4, -19, 1.8, 0.8, 1.4, { shade: 1.1 });
    // hanging chains (decoration)
    for (const [x, z] of [[-24, -19], [16, -19]] as const) {
      for (let i = 0; i < 5; i++) {
        this.box('deco', 'iron', x, 4.2 - i * 0.55, z, 0.22, 0.5, 0.22, { yaw: i * 0.6, shade: 0.9 });
      }
    }
  }

  private buildStairArea(): void {
    const c: ChunkName = 'stair';
    // stair side walls are in WALLS; add carved relief panels + braziers
    this.brazier(c, -8.5, 0, -16.5, 0.8);
    this.brazier(c, 8.5, 0, -16.5, 0.8);
    this.brazier(c, -8.5, 5, -29, 0.8);
    this.brazier(c, 8.5, 5, -29, 0.8);
    for (let z = -21; z >= -27; z -= 1.5) {
      const t = (-21 - z) / 6;
      const y = t * 5;
      this.box(c, 'stoneCarved', -6.8, y + 1.2, z, 0.5, 2.4, 1.4, { shade: 1.05 });
      this.box(c, 'stoneCarved', 6.8, y + 1.2, z, 0.5, 2.4, 1.4, { shade: 1.05 });
    }
    // votive niches on the landing
    for (const x of [-9, 9]) {
      this.box(c, 'stoneCarved', x, 5.9, -29, 1.6, 1.8, 1.2, { shade: 1.16 });
    }
    this.box(c, 'stoneCarved', 5, 0.4, -20, 2.2, 0.8, 1.4, { shade: 1.12 });
  }

  private buildChamber(): void {
    const c: ChunkName = 'chamber';
    // circular inlay plate
    this.add(c, 'stoneCarved', transform(cylGeo(13.4, 13.4, 0.22, 48, 0.28, [1.12, 1.1, 1.06]), 0, 5.11, -46));
    this.add(c, 'stoneCarved', transform(cylGeo(6.2, 6.2, 0.3, 36, 0.3, [1.2, 1.16, 1.08]), 0, 5.15, -46));
    // corner buttresses
    for (const [x, z] of [[-14, -60], [14, -60], [-14, -32], [14, -32]] as const) {
      this.box(c, 'stoneWall', x, 10, z, 3.4, 10, 3.4, { collider: true, shade: 0.96, ao: 0.6 });
      this.box(c, 'stoneCarved', x, 15.4, z, 2.4, 1.2, 2.4, { shade: 1.1 });
    }
    // wall pilasters
    for (let i = 0; i < 8; i++) {
      const x = -13 + i * (26 / 7);
      this.box(c, 'stoneCarved', x, 10.5, -61.2, 1.2, 11, 1.2, { shade: 1.06, ao: 0.7 });
      this.box(c, 'stoneCarved', x, 10.5, -30.8, 1.2, 11, 1.2, { shade: 1.06, ao: 0.7 });
    }
    // the great bell hanging from a bronze frame at the north end
    this.bellStructure(c, 0, 5, -56);
    // braziers around the arena
    for (const [x, z] of [[-11, -56], [11, -56], [-13, -40], [13, -40]] as const) {
      this.brazier(c, x, 5, z, 0.9);
    }
    // cracked floor fissure (dark inlay, no collision)
    this.add(c, 'ash', transform(boxGeo(1.4, 0.1, 18, 0.4, [0.4, 0.4, 0.42]), 3, 5.2, -44, 0.3));
  }

  private bellStructure(chunk: ChunkName, x: number, y: number, z: number): void {
    // frame
    for (const dx of [-3.4, 3.4]) {
      this.cyl(chunk, 'bronze', x + dx, y + 5, z, 0.55, 0.75, 10, 12, true);
      this.box(chunk, 'stoneCarved', x + dx, y + 0.5, z, 2.2, 1.0, 2.2, { collider: true, shade: 1.1 });
    }
    this.add(chunk, 'bronze', transform(cylGeo(0.5, 0.5, 7.6, 10, 0.4), x, y + 9.9, z, 0, 0, Math.PI / 2));
    // the bell itself
    const bell = cylGeo(1.1, 2.6, 4.6, 20, 0.5, [1.05, 1.0, 0.95]);
    this.add(chunk, 'bronze', transform(bell, x, y + 6.4, z));
    this.add(chunk, 'bronze', transform(cylGeo(2.75, 2.65, 0.5, 20, 0.5), x, y + 4.15, z));
    this.add(chunk, 'bronze', transform(cylGeo(0.35, 0.35, 1.2, 8, 0.4), x, y + 8.9, z));
    // clapper
    this.add(chunk, 'iron', transform(sphereGeoLike(0.55), x, y + 4.6, z));
    this.phys.cylinder(x, y + 6.4, z, 2.3, 2.6);
    // offerings at the base
    this.box(chunk, 'stoneCarved', x - 1.6, y + 0.35, z + 2.6, 1.4, 0.7, 1.4, { shade: 1.14 });
    this.box(chunk, 'stoneCarved', x + 1.8, y + 0.3, z + 2.4, 1.1, 0.6, 1.1, { shade: 1.1 });
  }

  // --------------------------------------------------------------- scatter
  private buildScatter(): void {
    const rng = mulberry32(31337);
    // rocks / rubble: instanced, hi + lo LOD pair
    const hiGeo = new THREE.IcosahedronGeometry(1, 1);
    const loGeo = new THREE.IcosahedronGeometry(1, 0);
    bakeColor(hiGeo, [0.85, 0.88, 0.94]);
    bakeColor(loGeo, [0.85, 0.88, 0.94]);
    const rockMat = this.mats.ash;
    const spots: Array<{ x: number; y: number; z: number; s: number; rx: number; ry: number }> = [];
    // [x1, x2, z1, z2, count, surfaceY]
    const zones: Array<[number, number, number, number, number, number]> = [
      [-11, 11, 11, 46, 24, 3], [-20, 20, -14, 8, 22, 0], [22, 46, -22, 10, 24, 0],
      [-30, -12, -22, -18, 10, 0], [-10, 10, -21, -16, 10, 0], [-15, 15, -60, -32, 14, 5],
    ];
    for (const [x1, x2, z1, z2, count, y] of zones) {
      for (let i = 0; i < count; i++) {
        const x = randRange(rng, x1, x2);
        const z = randRange(rng, z1, z2);
        spots.push({ x, y, z, s: randRange(rng, 0.35, 1.5), rx: rng() * Math.PI, ry: rng() * Math.PI * 2 });
      }
    }
    const n = spots.length;
    const hi = new THREE.InstancedMesh(hiGeo, rockMat, n);
    const lo = new THREE.InstancedMesh(loGeo, rockMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sv = new THREE.Vector3();
    spots.forEach((s, i) => {
      e.set(s.rx, s.ry, 0);
      q.setFromEuler(e);
      v.set(s.x, s.y + s.s * 0.35, s.z);
      sv.set(s.s * randRange(rng, 0.8, 1.5), s.s * randRange(rng, 0.5, 0.9), s.s * randRange(rng, 0.8, 1.4));
      m.compose(v, q, sv);
      hi.setMatrixAt(i, m);
      lo.setMatrixAt(i, m);
    });
    hi.instanceMatrix.needsUpdate = true;
    lo.instanceMatrix.needsUpdate = true;
    hi.castShadow = true; hi.receiveShadow = true;
    lo.receiveShadow = true;
    const deco = new THREE.Group();
    deco.add(hi, lo);
    this.group.add(deco);
    const center = new THREE.Vector3(4, 2, -8);
    this.lodPairs.push({ hi, lo, center, radius: 78 });
    this.clusters.push({ object: deco, center, radius: 200, kind: 'decoration' });
    this.disposables.push(hiGeo, loGeo, hi, lo);

    // dead grass + moss tufts (vegetation cluster, culled by range)
    const tuftGeo = new THREE.PlaneGeometry(0.7, 0.55);
    bakeColor(tuftGeo, [0.86, 0.92, 0.74]);
    const tuftTex = makeTuftTexture(64);
    const tuftMat = new THREE.MeshStandardMaterial({ map: tuftTex, color: 0x69705e, roughness: 0.95, side: THREE.DoubleSide, transparent: false, alphaTest: 0.35, vertexColors: true });
    const tufts = 260;
    const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, tufts);
    let ti = 0;
    const vegZones: Array<[number, number, number, number]> = [[-11, 12, 11, 46], [22, 46, -22, 10], [-30, -12, -22, -18]];
    for (const [ax, bx, az, bz] of vegZones) {
      for (let i = 0; i < 90 && ti < tufts; i++) {
        const x = randRange(rng, ax, bx), z = randRange(rng, az, bz);
        const y = az > 40 ? 3 : 0;
        e.set(0, rng() * Math.PI * 2, 0);
        q.setFromEuler(e);
        v.set(x, y + 0.26, z);
        const s = randRange(rng, 0.45, 0.95);
        sv.set(s, s, s);
        m.compose(v, q, sv);
        tuftMesh.setMatrixAt(ti++, m);
      }
    }
    tuftMesh.count = ti;
    tuftMesh.instanceMatrix.needsUpdate = true;
    tuftMesh.receiveShadow = true;
    const veg = new THREE.Group();
    veg.add(tuftMesh);
    this.group.add(veg);
    this.clusters.push({ object: veg, center: new THREE.Vector3(10, 0, 0), radius: 60, kind: 'vegetation' });
    this.disposables.push(tuftGeo, tuftMat, tuftTex, tuftMesh);
  }
}

function sphereGeoLike(r: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 10, 8);
  bakeColor(g, [0.8, 0.8, 0.85]);
  return g;
}

/** Apply vertical AO to the most recently added wall geometry (base darkening). */
function bakeVerticalAOLast(collector: Map<string, { geos: THREE.BufferGeometry[] }>, chunk: string, mat: string, height: number, centerY: number): void {
  const entry = collector.get(`${chunk}|${mat}`);
  if (!entry || entry.geos.length === 0) return;
  bakeVerticalAO(entry.geos[entry.geos.length - 1], 0.62, 1.06, height, centerY);
}

export const AREA_LIST = AREAS;
export const DEG_HELPER = DEG;
