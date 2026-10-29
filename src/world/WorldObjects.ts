/**
 * Interactive world objects: Vigil Flames, pickups, the shortcut portcullis and its
 * lever, the ember drop, and the last bell. Each has a visual and an interaction volume;
 * collision for solid pieces comes from the level builder so the two always agree.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../render/Materials';
import { boxGeo, cylGeo, sphereGeo, transform } from '../render/GeometryUtils';
import type { PhysicsWorld } from '../physics/Physics';
import type { CheckpointDef, PickupDef } from '../world/LevelData';
import { mulberry32 } from '../core/MathX';

export interface FlameEmitter { x: number; y: number; z: number; color: number; intensity: number; range: number }

export class CheckpointFlame {
  group: THREE.Group;
  private flame: THREE.Mesh;
  private glow: THREE.Sprite;
  private mat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;
  private core: THREE.Mesh;
  private spriteMat: THREE.SpriteMaterial;
  public activated = false;
  private t = Math.random() * 10;

  constructor(def: CheckpointDef, mats: MaterialLibrary) {
    this.group = new THREE.Group();
    this.group.position.set(def.x, def.y, def.z);
    const stone = new THREE.Mesh(transform(boxGeo(1.6, 0.5, 1.6, 0.6), 0, 0.25, 0), mats.stoneCarved);
    stone.castShadow = true; stone.receiveShadow = true;
    const bowl = new THREE.Mesh(cylGeo(0.62, 0.42, 0.7, 12, 0.7), mats.iron);
    bowl.position.y = 0.85; bowl.castShadow = true;
    const legs = new THREE.Mesh(cylGeo(0.2, 0.34, 0.5, 8, 0.7), mats.iron);
    legs.position.y = 0.5;
    this.group.add(stone, bowl, legs);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x2a1b10, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.6 });
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x120b06, emissive: 0xffd9a0, emissiveIntensity: 0.4, roughness: 0.5 });
    // two nested tongues: a wide amber outer plume and a hot core, so the flame has depth
    // instead of reading as one flat blown-out spike
    this.flame = new THREE.Mesh(cylGeo(0.34, 0.02, 1.35, 7, 0.55, [1, 1.35, 1], true), this.mat);
    this.flame.position.y = 1.75;
    this.flame.renderOrder = 3;
    this.core = new THREE.Mesh(cylGeo(0.16, 0.01, 0.85, 6, 0.4, [1, 1.5, 1], true), this.coreMat);
    this.core.position.y = 1.5;
    this.core.renderOrder = 4;
    this.group.add(this.flame, this.core);
    this.spriteMat = new THREE.SpriteMaterial({ map: mats.glow, color: 0xffa055, opacity: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glow = new THREE.Sprite(this.spriteMat);
    this.glow.scale.setScalar(2.2);
    this.glow.position.y = 1.7;
    this.group.add(this.glow);
  }

  setActivated(v: boolean): void {
    this.activated = v;
    this.mat.emissive = new THREE.Color(v ? 0xff8f33 : 0x120b06);
    this.mat.emissiveIntensity = v ? 1.15 : 0.3;
    this.mat.color.setHex(v ? 0x6a3a14 : 0x2a1b10);
    this.coreMat.emissiveIntensity = v ? 1.5 : 0.25;
  }

  update(dt: number): FlameEmitter {
    this.t += dt;
    const flicker = this.activated ? 0.82 + Math.sin(this.t * 11.3) * 0.08 + Math.sin(this.t * 27.7) * 0.05 : 0.12;
    this.flame.scale.set(0.9 + Math.sin(this.t * 7.1) * 0.09, 1 + Math.sin(this.t * 9.4) * 0.16, 0.9 + Math.cos(this.t * 8.2) * 0.09);
    this.flame.rotation.y = this.t * 1.4;
    this.core.scale.set(0.95 + Math.cos(this.t * 12.7) * 0.1, 1 + Math.sin(this.t * 15.1) * 0.22, 0.95 + Math.sin(this.t * 11.3) * 0.1);
    this.core.rotation.y = -this.t * 2.1;
    this.spriteMat.opacity = this.activated ? 0.3 * flicker : 0.05;
    this.glow.scale.setScalar(1.9 + flicker * 0.9);
    return {
      x: this.group.position.x, y: this.group.position.y + 1.6, z: this.group.position.z,
      color: 0xffa86a, intensity: this.activated ? 26 * flicker : 2, range: 14,
    };
  }

  dispose(): void {
    this.mat.dispose();
    this.coreMat.dispose();
    this.spriteMat.dispose();
  }
}

export class PickupObject {
  group: THREE.Group;
  def: PickupDef;
  collected = false;
  private spin = 0;
  private mats: THREE.Material[] = [];
  private bob: number;

  constructor(def: PickupDef, mats: MaterialLibrary) {
    this.def = def;
    this.group = new THREE.Group();
    this.group.position.set(def.x, def.y, def.z);
    this.bob = Math.random() * 6;
    const rng = mulberry32(def.id.length * 977 + 13);
    if (def.kind === 'embers') {
      const m = new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0xff6a20, emissiveIntensity: 1.8, roughness: 0.4 });
      this.mats.push(m);
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(sphereGeo(0.09 + rng() * 0.07, 6), m);
        s.position.set((rng() - 0.5) * 0.7, 0.35 + rng() * 0.5, (rng() - 0.5) * 0.7);
        this.group.add(s);
      }
      const base = new THREE.Mesh(cylGeo(0.5, 0.6, 0.2, 10, 0.7), mats.stoneCarved);
      base.position.y = 0.1;
      this.group.add(base);
    } else if (def.kind === 'flask') {
      const m = new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: 0xff9a3c, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 });
      this.mats.push(m);
      const vial = new THREE.Mesh(cylGeo(0.16, 0.24, 0.5, 10, 0.8), m);
      vial.position.y = 0.7;
      const neck = new THREE.Mesh(cylGeo(0.08, 0.12, 0.2, 8, 0.8), m);
      neck.position.y = 1.02;
      const plinth = new THREE.Mesh(transform(boxGeo(1.0, 0.5, 1.0, 0.7), 0, 0.25, 0), mats.stoneCarved);
      plinth.castShadow = true; plinth.receiveShadow = true;
      this.group.add(vial, neck, plinth);
    } else {
      const stele = new THREE.Mesh(transform(boxGeo(1.1, 2.1, 0.3, 0.7, [1.15, 1.12, 1.08]), 0, 1.05, 0), mats.stoneCarved);
      stele.castShadow = true; stele.receiveShadow = true;
      const glyph = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 6, 14), new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.5, metalness: 0.7 }));
      glyph.position.set(0, 1.45, -0.18);
      this.mats.push(glyph.material as THREE.Material);
      this.group.add(stele, glyph);
    }
    this.setCollected(false);
  }

  setCollected(v: boolean): void {
    this.collected = v;
    this.group.visible = !v;
  }

  update(dt: number): void {
    if (this.collected) return;
    this.spin += dt * (this.def.kind === 'embers' ? 1.1 : 0.5);
    this.group.rotation.y = this.spin;
    if (this.def.kind !== 'lore') {
      this.group.position.y = this.def.y + Math.sin((this.bob += dt * 1.6)) * 0.06;
    }
  }

  dispose(): void { for (const m of this.mats) m.dispose(); }
}

export class EmberDrop {
  group: THREE.Group;
  private mats: THREE.MeshStandardMaterial;
  private t = 0;
  visible = false;

  constructor(mats: MaterialLibrary) {
    this.group = new THREE.Group();
    this.mats = new THREE.MeshStandardMaterial({ color: 0xff9a4a, emissive: 0xff6a20, emissiveIntensity: 1.6, roughness: 0.35 });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(sphereGeo(0.11, 6), this.mats);
      s.position.set((i - 2.5) * 0.16, 0.35 + (i % 3) * 0.16, Math.sin(i) * 0.16);
      this.group.add(s);
    }
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 24), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.05;
    this.group.add(halo);
    this.group.visible = false;
    void mats;
  }

  show(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z);
    this.group.visible = true;
    this.visible = true;
  }

  hide(): void {
    this.group.visible = false;
    this.visible = false;
  }

  update(dt: number): FlameEmitter {
    this.t += dt;
    this.group.rotation.y = this.t * 0.9;
    this.group.children.forEach((c, i) => {
      if (i < 6) c.position.y = 0.35 + Math.sin(this.t * 2 + i) * 0.09 + (i % 3) * 0.14;
    });
    return { x: this.group.position.x, y: this.group.position.y + 0.5, z: this.group.position.z, color: 0xff8a3d, intensity: this.visible ? 14 : 0, range: 9 };
  }

  dispose(): void { this.mats.dispose(); }
}

export class Portcullis {
  group: THREE.Group;
  lever: THREE.Group;
  opened = false;
  private geo: THREE.BufferGeometry[] = [];
  private mat: THREE.MeshStandardMaterial;
  private leverT = 0;

  constructor(
    x: number, y: number, z: number, width: number, height: number, thickness: number,
    mats: MaterialLibrary, phys: PhysicsWorld, leverX: number, leverY: number, leverZ: number,
    yaw = 0,
  ) {
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw; // the opening runs along the wall, so the curtain must be turned to match
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x6a6f78, roughness: 0.5, metalness: 0.85,
      map: mats.iron.map, roughnessMap: mats.iron.roughnessMap, normalMap: mats.iron.normalMap,
    });
    const barCount = Math.max(2, Math.floor(width / 0.6));
    for (let i = 0; i < barCount; i++) {
      const g = cylGeo(0.09, 0.09, height, 6, 0.8);
      this.geo.push(g);
      const bar = new THREE.Mesh(g, this.mat);
      bar.position.set(-width / 2 + 0.3 + i * ((width - 0.6) / (barCount - 1)), height / 2, 0);
      bar.castShadow = true;
      this.group.add(bar);
    }
    const bands = Math.max(2, Math.floor(height / 0.9));
    for (let i = 0; i < bands; i++) {
      const g = boxGeo(width, 0.16, thickness * 0.8, 0.6);
      this.geo.push(g);
      const band = new THREE.Mesh(g, this.mat);
      band.position.set(0, 0.5 + i * ((height - 1.0) / (bands - 1)), 0);
      band.castShadow = true;
      this.group.add(band);
    }
    // the collider is what actually blocks the player; it is removed when the gate opens
    phys.box(x, y + height / 2, z, width / 2, height / 2, thickness / 2, yaw);

    this.lever = new THREE.Group();
    this.lever.position.set(leverX, leverY, leverZ);
    const baseG = boxGeo(0.9, 0.5, 0.9, 0.7);
    const postG = cylGeo(0.1, 0.13, 1.4, 8, 0.8);
    const handleG = sphereGeo(0.16, 8);
    this.geo.push(baseG, postG, handleG);
    const base = new THREE.Mesh(baseG, mats.stoneCarved);
    base.position.y = 0.25; base.castShadow = true; base.receiveShadow = true;
    const post = new THREE.Mesh(postG, mats.iron);
    post.position.y = 1.1; post.castShadow = true;
    const handle = new THREE.Mesh(handleG, mats.bronze);
    handle.position.y = 1.8; handle.castShadow = true;
    this.lever.add(base, post, handle);
  }

  get handleWorld(): THREE.Vector3 {
    return this.lever.children[2].getWorldPosition(new THREE.Vector3());
  }

  open(): void {
    this.opened = true;
    this.leverT = 0;
  }

  update(dt: number): void {
    if (this.opened) {
      this.leverT = Math.min(1, this.leverT + dt * 1.6);
      this.lever.rotation.z = -0.6 * this.leverT;
      this.group.position.y = this.group.position.y + 0.0;
    }
  }

  dispose(): void {
    for (const g of this.geo) g.dispose();
    this.mat.dispose();
  }
}

export class BellStructure {
  group: THREE.Group;
  private bell: THREE.Mesh | null = null;
  private swing = 0;
  private ringing = false;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  attach(bell: THREE.Mesh): void {
    this.bell = bell;
  }

  ring(): void {
    this.ringing = true;
    this.swing = 1;
  }

  update(dt: number): void {
    if (!this.bell) return;
    if (this.ringing) {
      this.swing = Math.max(0, this.swing - dt * 0.35);
      this.bell.rotation.z = Math.sin(performance.now() * 0.006) * 0.12 * this.swing;
      if (this.swing <= 0) this.ringing = false;
    }
  }
}
