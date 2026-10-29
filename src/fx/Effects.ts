/**
 * Bounded, pooled effects. Every buffer is fixed at construction: no allocation during
 * combat, no unbounded particle growth, corpses and decals are capped.
 */
import * as THREE from 'three';
import { FX } from '../config/Balance';
import { mulberry32 } from '../core/MathX';
import { makeRadialSprite } from '../render/Textures';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number;
  r: number; g: number; b: number;
  gravity: number;
}

class ParticlePool {
  mesh: THREE.InstancedMesh;
  private items: Particle[] = [];
  private cursor = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private geo: THREE.BufferGeometry;

  constructor(count: number, material: THREE.Material, size: number) {
    this.geo = new THREE.PlaneGeometry(size, size);
    this.mesh = new THREE.InstancedMesh(this.geo, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < count; i++) {
      this.items.push({ x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1, gravity: -6 });
      this.dummy.position.set(0, -9999, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(p: Partial<Particle> & { x: number; y: number; z: number }, budgetScale: number): void {
    const cap = Math.max(4, Math.floor(this.items.length * budgetScale));
    // reuse the oldest slot in a bounded window so the pool never grows
    let idx = -1;
    for (let k = 0; k < 12; k++) {
      const cand = (this.cursor + k) % cap;
      if (this.items[cand].life <= 0) { idx = cand; break; }
    }
    if (idx < 0) { idx = this.cursor % cap; }
    this.cursor = (this.cursor + 1) % cap;
    const it = this.items[idx];
    it.x = p.x; it.y = p.y; it.z = p.z;
    it.vx = p.vx ?? 0; it.vy = p.vy ?? 0; it.vz = p.vz ?? 0;
    it.maxLife = it.life = p.life ?? 0.5;
    it.size = p.size ?? 0.08;
    it.r = p.r ?? 1; it.g = p.g ?? 1; it.b = p.b ?? 1;
    it.gravity = p.gravity ?? -6;
  }

  update(dt: number, camera: THREE.Camera): void {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        this.dummy.position.set(0, -9999, 0);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      it.vy += it.gravity * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      const t = it.life / it.maxLife;
      const s = it.size * (0.35 + t * 0.65);
      this.dummy.position.set(it.x, it.y, it.z);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setRGB(it.r * t, it.g * t, it.b * t));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const it of this.items) it.life = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mesh.dispose();
  }
}

export class Effects {
  private sparks: ParticlePool;
  private dust: ParticlePool;
  private ash: ParticlePool;
  private decalPool: Array<{ mesh: THREE.Mesh; life: number }> = [];
  private decalCursor = 0;
  private decalGeo: THREE.PlaneGeometry;
  private decalMat: THREE.MeshBasicMaterial;
  private telegraphRings: THREE.Mesh[] = [];
  private telegraphMat: THREE.MeshBasicMaterial;
  private corpseGroup: THREE.Group;
  private corpses: THREE.Object3D[] = [];
  private rng = mulberry32(4711);
  public budget = 1;
  private ashTimer = 0;
  private sprite: THREE.Texture;

  constructor(scene: THREE.Scene) {
    this.sprite = makeRadialSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64, 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.14)');
    const sparkMat = new THREE.MeshBasicMaterial({ map: this.sprite, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const dustMat = new THREE.MeshBasicMaterial({ map: this.sprite, transparent: true, opacity: 0.5, depthWrite: false, color: 0x9aa4b2 });
    const ashMat = new THREE.MeshBasicMaterial({ map: this.sprite, transparent: true, opacity: 0.42, depthWrite: false, color: 0xc8ccd6 });
    this.sparks = new ParticlePool(FX.maxSparks, sparkMat, 1);
    this.dust = new ParticlePool(FX.maxDust, dustMat, 1);
    this.ash = new ParticlePool(FX.maxAsh, ashMat, 1);
    scene.add(this.sparks.mesh, this.dust.mesh, this.ash.mesh);

    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalMat = new THREE.MeshBasicMaterial({ map: makeRadialSprite('rgba(20,18,16,0.85)', 'rgba(20,18,16,0)', 64, 'rgba(20,18,16,0.5)', 'rgba(20,18,16,0.14)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let i = 0; i < FX.decalLimit; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.decalPool.push({ mesh: m, life: 0 });
    }

    this.telegraphMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), this.telegraphMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 4;
      scene.add(ring);
      this.telegraphRings.push(ring);
    }

    this.corpseGroup = new THREE.Group();
    scene.add(this.corpseGroup);
  }

  hitSpark(x: number, y: number, z: number, nx: number, ny: number, nz: number, strength = 1, color: [number, number, number] = [1, 0.75, 0.4]): void {
    const n = Math.round((5 + strength * 9) * this.budget);
    for (let i = 0; i < n; i++) {
      const r = this.rng;
      const sp = 1.6 + r() * 3.4 * strength;
      this.sparks.spawn({
        x, y, z,
        vx: (nx + (r() - 0.5)) * sp, vy: (ny + r() * 0.9) * sp, vz: (nz + (r() - 0.5)) * sp,
        life: 0.22 + r() * 0.3, size: 0.05 + r() * 0.07,
        r: color[0], g: color[1], b: color[2], gravity: -7,
      }, this.budget);
    }
  }

  blockSpark(x: number, y: number, z: number): void {
    const n = Math.round(7 * this.budget);
    for (let i = 0; i < n; i++) {
      const r = this.rng;
      const a = r() * Math.PI * 2;
      this.sparks.spawn({
        x, y, z,
        vx: Math.cos(a) * (1.4 + r() * 2.2), vy: 1.2 + r() * 2.4, vz: Math.sin(a) * (1.4 + r() * 2.2),
        life: 0.2 + r() * 0.22, size: 0.045 + r() * 0.05,
        r: 0.7, g: 0.85, b: 1.0, gravity: -8,
      }, this.budget);
    }
  }

  dustPuff(x: number, y: number, z: number, strength = 1): void {
    const n = Math.round((4 + strength * 6) * this.budget);
    for (let i = 0; i < n; i++) {
      const r = this.rng;
      const a = r() * Math.PI * 2;
      this.dust.spawn({
        x, y: y + 0.05, z,
        vx: Math.cos(a) * (0.6 + r() * 1.6), vy: 0.5 + r() * 1.1, vz: Math.sin(a) * (0.6 + r() * 1.6),
        life: 0.5 + r() * 0.5, size: 0.16 + r() * 0.22,
        r: 0.62, g: 0.66, b: 0.72, gravity: -1.4,
      }, this.budget);
    }
  }

  healBurst(x: number, y: number, z: number): void {
    const n = Math.round(14 * this.budget);
    for (let i = 0; i < n; i++) {
      const r = this.rng;
      const a = r() * Math.PI * 2;
      const rad = 0.25 + r() * 0.4;
      this.sparks.spawn({
        x: x + Math.cos(a) * rad, y: y + 0.2, z: z + Math.sin(a) * rad,
        vx: Math.cos(a) * 0.5, vy: 1.1 + r() * 1.2, vz: Math.sin(a) * 0.5,
        life: 0.6 + r() * 0.5, size: 0.07 + r() * 0.06,
        r: 1.0, g: 0.72, b: 0.36, gravity: 0.6,
      }, this.budget);
    }
  }

  pickupBurst(x: number, y: number, z: number, color: [number, number, number] = [1, 0.62, 0.28]): void {
    const n = Math.round(16 * this.budget);
    for (let i = 0; i < n; i++) {
      const r = this.rng;
      const a = r() * Math.PI * 2;
      this.sparks.spawn({
        x, y: y + 0.3, z,
        vx: Math.cos(a) * (0.6 + r() * 1.4), vy: 1.4 + r() * 1.8, vz: Math.sin(a) * (0.6 + r() * 1.4),
        life: 0.5 + r() * 0.6, size: 0.06 + r() * 0.06,
        r: color[0], g: color[1], b: color[2], gravity: -2.2,
      }, this.budget);
    }
  }

  deathBurst(x: number, y: number, z: number): void {
    const n = Math.round(22 * this.budget);
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const r = this.rng;
      const a = r() * Math.PI * 2;
      const sp = 0.8 + r() * 2.4;
      this.dust.spawn({
        x, y: y + 0.6 + r() * 0.8, z,
        vx: Math.cos(a) * sp, vy: 0.8 + r() * 1.6, vz: Math.sin(a) * sp,
        life: 0.7 + r() * 0.7, size: 0.18 + r() * 0.3,
        r: 0.55, g: 0.58, b: 0.66, gravity: -1.2,
      }, this.budget);
    }
    this.decal(x, z, 1.4 + r() * 0.8);
  }

  decal(x: number, z: number, size: number): void {
    const slot = this.decalPool[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decalPool.length;
    slot.mesh.position.set(x, 0.02, z);
    slot.mesh.scale.setScalar(size);
    slot.mesh.rotation.z = this.rng() * Math.PI;
    slot.mesh.visible = true;
    slot.life = 26;
  }

  setTelegraph(index: number, x: number, z: number, y: number, radius: number, t: number, duration: number): void {
    const ring = this.telegraphRings[index];
    if (!ring) return;
    if (radius <= 0) { ring.visible = false; return; }
    const k = Math.min(1, t / Math.max(0.001, duration));
    ring.visible = true;
    ring.position.set(x, y + 0.04, z);
    ring.scale.setScalar(radius * (0.35 + 0.65 * k));
    const mat = ring.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.18 + 0.42 * k;
    mat.color.setRGB(1, 0.52 - 0.2 * k, 0.22);
  }

  hideTelegraphs(): void {
    for (const r of this.telegraphRings) r.visible = false;
  }

  addCorpse(obj: THREE.Object3D): void {
    this.corpseGroup.add(obj);
    this.corpses.push(obj);
    while (this.corpses.length > FX.corpseLimit) {
      const old = this.corpses.shift();
      if (old) this.corpseGroup.remove(old);
    }
  }

  clearCorpses(): void {
    for (const c of this.corpses) this.corpseGroup.remove(c);
    this.corpses.length = 0;
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    this.sparks.update(dt, camera);
    this.dust.update(dt, camera);
    this.ash.update(dt, camera);
    for (const d of this.decalPool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) d.mesh.visible = false;
    }
    // sparse drifting ash around the viewer
    this.ashTimer -= dt;
    if (this.ashTimer <= 0) {
      this.ashTimer = 0.05;
      const n = Math.round(3 * this.budget);
      for (let i = 0; i < n; i++) {
        const r = this.rng;
        this.ash.spawn({
          x: focus.x + (r() - 0.5) * 26, y: focus.y + 2 + r() * 7, z: focus.z + (r() - 0.5) * 26,
          vx: 0.5 + r() * 0.9, vy: -0.35 - r() * 0.4, vz: (r() - 0.5) * 0.8,
          life: 4 + r() * 4, size: 0.035 + r() * 0.05,
          r: 0.75, g: 0.78, b: 0.85, gravity: -0.05,
        }, this.budget);
      }
    }
  }

  setBudget(scale: number): void { this.budget = Math.max(0.05, Math.min(1, scale)); }

  reset(): void {
    this.sparks.clear(); this.dust.clear(); this.ash.clear();
    for (const d of this.decalPool) { d.life = 0; d.mesh.visible = false; }
    this.hideTelegraphs();
  }

  dispose(): void {
    this.sparks.dispose(); this.dust.dispose(); this.ash.dispose();
    this.decalGeo.dispose(); this.decalMat.dispose();
    for (const r of this.telegraphRings) { (r.geometry as THREE.BufferGeometry).dispose(); (r.material as THREE.Material).dispose(); }
    this.sprite.dispose();
  }
}
