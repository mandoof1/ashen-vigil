/**
 * Original articulated character rig. No skeletal asset is bundled: every figure is
 * built from primitives parented to a joint hierarchy, then animated procedurally.
 * Joint names are stable so the animator can address them by name.
 */
import * as THREE from 'three';
import { boxGeo, cylGeo, sphereGeo, torusGeo } from './GeometryUtils';
import type { CharacterMaterials } from './Materials';

export type WeaponKind = 'sword' | 'mace' | 'axe' | 'bellhammer';

export interface RigOptions {
  scale: number;
  weapon: WeaponKind;
  shield: number;        // 0 = none, 1 = standard, 1.4 = tower shield
  bulk: number;          // torso/limb thickness multiplier
  cloak: boolean;
  hornedHelm: boolean;
  bellPauldrons: boolean;
  chains: boolean;
  emberGlow: boolean;
}

export interface Rig {
  root: THREE.Group;
  joints: Map<string, THREE.Object3D>;
  weaponTip: THREE.Object3D;
  weaponMid: THREE.Object3D;
  handR: THREE.Object3D;
  handL: THREE.Object3D;
  head: THREE.Object3D;
  chest: THREE.Object3D;
  meshes: THREE.Mesh[];
  materials: CharacterMaterials;
  height: number;
  dispose(): void;
}

const J = (name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  parent.add(o);
  return o;
};

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

export function buildRig(mats: CharacterMaterials, opts: RigOptions, height = 1.8): Rig {
  const s = height / 1.8 * opts.scale;
  const bulk = opts.bulk;
  const root = new THREE.Group();
  root.name = 'rig';
  const joints = new Map<string, THREE.Object3D>();
  const meshes: THREE.Mesh[] = [];
  const extras: THREE.Material[] = [];
  const reg = (name: string, o: THREE.Object3D) => joints.set(name, o);
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    meshes.push(part(parent, geo, mat, x * s, y * s, z * s));
  };

  // ---- spine chain
  const hips = J('hips', root, 0, 0.95 * s, 0); reg('hips', hips);
  add(hips, boxGeo(0.34 * bulk, 0.24, 0.24 * bulk, 0.9), mats.leather);
  add(hips, boxGeo(0.36 * bulk, 0.16, 0.26 * bulk, 0.9), mats.body, 0, 0.02);

  const spine = J('spine', hips, 0, 0.14 * s, 0); reg('spine', spine);
  const chest = J('chest', spine, 0, 0.2 * s, 0); reg('chest', chest);
  add(chest, boxGeo(0.42 * bulk, 0.4, 0.28 * bulk, 0.9), mats.body, 0, 0.06);
  add(chest, boxGeo(0.44 * bulk, 0.14, 0.3 * bulk, 0.9), mats.trim, 0, 0.2);
  add(chest, boxGeo(0.3 * bulk, 0.3, 0.06, 0.9), mats.cloth, 0, 0.02, -0.17 * bulk);

  const neck = J('neck', chest, 0, 0.26 * s, 0); reg('neck', neck);
  const head = J('head', neck, 0, 0.08 * s, 0); reg('head', head);
  add(head, sphereGeo(0.13 * bulk, 10), mats.leather, 0, 0.09);
  // helmet / hood
  if (opts.hornedHelm) {
    add(head, cylGeo(0.15 * bulk, 0.17 * bulk, 0.26, 10, 0.9, [1, 1, 1]), mats.trim, 0, 0.11);
    add(head, boxGeo(0.06, 0.16, 0.06, 0.9), mats.trim, -0.16 * bulk, 0.2, 0);
    add(head, boxGeo(0.06, 0.16, 0.06, 0.9), mats.trim, 0.16 * bulk, 0.2, 0);
    add(head, boxGeo(0.3, 0.05, 0.06, 0.9), mats.iron, 0, 0.1, -0.16);
  } else {
    add(head, cylGeo(0.16 * bulk, 0.14 * bulk, 0.24, 10, 0.9, [1, 1, 1]), mats.trim, 0, 0.11);
    add(head, boxGeo(0.34 * bulk, 0.1, 0.3 * bulk, 0.9), mats.cloth, 0, 0.22);
    add(head, boxGeo(0.28 * bulk, 0.09, 0.06, 0.9), mats.iron, 0, 0.1, -0.15);
  }

  // ---- arms
  const armY = 0.19, armX = 0.24 * bulk;
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const shoulder = J(`shoulder${side}`, chest, sx * armX * s, armY * s, 0); reg(`shoulder${side}`, shoulder);
    if (opts.bellPauldrons) {
      add(shoulder, cylGeo(0.1 * bulk, 0.3 * bulk, 0.3, 12, 0.9, [1, 1, 1]), mats.trim, sx * 0.04, 0.02);
      add(shoulder, cylGeo(0.3 * bulk, 0.34 * bulk, 0.12, 12, 0.9, [1, 1, 1]), mats.trim, sx * 0.04, 0.16);
    } else {
      add(shoulder, sphereGeo(0.12 * bulk, 8), mats.trim, sx * 0.02, 0.02);
      add(shoulder, boxGeo(0.18 * bulk, 0.14, 0.22 * bulk, 0.9), mats.body, sx * 0.03, -0.04);
    }
    const upper = J(`upperArm${side}`, shoulder, 0, -0.05 * s, 0); reg(`upperArm${side}`, upper);
    add(upper, cylGeo(0.062 * bulk, 0.058 * bulk, 0.28, 8, 0.9, [1, 1, 1]), mats.body, 0, -0.15);
    const fore = J(`foreArm${side}`, upper, 0, -0.3 * s, 0); reg(`foreArm${side}`, fore);
    add(fore, cylGeo(0.058 * bulk, 0.05 * bulk, 0.26, 8, 0.9, [1, 1, 1]), mats.body, 0, -0.13);
    add(fore, cylGeo(0.075 * bulk, 0.07 * bulk, 0.1, 8, 0.9, [1, 1, 1]), mats.trim, 0, -0.06);
    const hand = J(`hand${side}`, fore, 0, -0.28 * s, 0); reg(`hand${side}`, hand);
    add(hand, boxGeo(0.07, 0.08, 0.07, 0.9), mats.leather);
  }

  // ---- legs
  const legX = 0.115 * bulk;
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const thigh = J(`thigh${side}`, hips, sx * legX * s, -0.06 * s, 0); reg(`thigh${side}`, thigh);
    add(thigh, cylGeo(0.085 * bulk, 0.075 * bulk, 0.4, 8, 0.9, [1, 1, 1]), mats.body, 0, -0.21);
    add(thigh, boxGeo(0.2 * bulk, 0.24, 0.24 * bulk, 0.9), mats.cloth, 0, -0.12);
    const shin = J(`shin${side}`, thigh, 0, -0.44 * s, 0); reg(`shin${side}`, shin);
    add(shin, cylGeo(0.072 * bulk, 0.06 * bulk, 0.38, 8, 0.9, [1, 1, 1]), mats.body, 0, -0.2);
    add(shin, boxGeo(0.16 * bulk, 0.16, 0.18 * bulk, 0.9), mats.trim, 0, -0.1);
    const foot = J(`foot${side}`, shin, 0, -0.42 * s, 0); reg(`foot${side}`, foot);
    add(foot, boxGeo(0.13, 0.09, 0.28, 0.9), mats.leather, 0, -0.03, -0.05);
  }

  // ---- cloak
  if (opts.cloak) {
    const c0 = J('cloak0', chest, 0, 0.16 * s, 0.14 * s); reg('cloak0', c0);
    let parent = c0;
    for (let i = 1; i <= 3; i++) {
      const seg = J(`cloak${i}`, parent, 0, -0.26 * s, 0.02 * s); reg(`cloak${i}`, seg);
      add(seg, boxGeo(0.42 - i * 0.03, 0.3, 0.05, 0.9), mats.cloth, 0, -0.14);
      parent = seg;
    }
  }

  // ---- chains
  if (opts.chains) {
    for (const dx of [-0.16, 0.16]) {
      let parent = chest;
      for (let i = 0; i < 4; i++) {
        const link = J(`chain_${dx}_${i}`, parent, dx * s, i === 0 ? -0.1 * s : -0.2 * s, -0.02 * s);
        add(link, torusGeo(0.05, 0.014, 6), mats.iron);
        parent = link;
      }
    }
  }

  // ---- weapon
  const handR = joints.get('handR')!;
  const weaponRoot = J('weapon', handR, 0, -0.03 * s, -0.02 * s); reg('weapon', weaponRoot);
  const weaponTip = new THREE.Object3D();
  const weaponMid = new THREE.Object3D();
  let bladeLen = 1.0;
  switch (opts.weapon) {
    case 'sword': {
      bladeLen = 1.05;
      add(weaponRoot, cylGeo(0.028, 0.032, 0.16, 6, 0.9, [1, 1, 1]), mats.leather, 0, -0.06);
      add(weaponRoot, boxGeo(0.22, 0.04, 0.05, 0.9), mats.trim, 0, 0.03);
      add(weaponRoot, boxGeo(0.055, bladeLen, 0.13, 0.9), mats.steel, 0, 0.05 + bladeLen / 2);
      add(weaponRoot, boxGeo(0.02, bladeLen * 0.9, 0.15, 0.9), mats.iron, 0, 0.05 + bladeLen / 2, 0.005);
      break;
    }
    case 'mace': {
      bladeLen = 0.8;
      add(weaponRoot, cylGeo(0.03, 0.035, 0.5, 6, 0.9, [1, 1, 1]), mats.wood, 0, 0.25);
      add(weaponRoot, boxGeo(0.19, 0.22, 0.19, 0.9), mats.iron, 0, 0.56);
      add(weaponRoot, boxGeo(0.24, 0.06, 0.24, 0.9), mats.trim, 0, 0.56);
      break;
    }
    case 'axe': {
      bladeLen = 1.35;
      add(weaponRoot, cylGeo(0.04, 0.045, 1.1, 6, 0.9, [1, 1, 1]), mats.wood, 0, 0.5);
      add(weaponRoot, boxGeo(0.5, 0.62, 0.07, 0.9), mats.steel, 0.22, 0.95);
      add(weaponRoot, boxGeo(0.16, 0.7, 0.09, 0.9), mats.iron, -0.02, 0.95);
      break;
    }
    case 'bellhammer': {
      bladeLen = 1.9;
      add(weaponRoot, cylGeo(0.055, 0.06, 1.5, 8, 0.9, [1, 1, 1]), mats.wood, 0, 0.7);
      add(weaponRoot, cylGeo(0.34, 0.42, 0.55, 14, 0.9, [1, 1, 1]), mats.trim, 0, 1.62);
      add(weaponRoot, cylGeo(0.45, 0.36, 0.16, 14, 0.9, [1, 1, 1]), mats.trim, 0, 1.9);
      add(weaponRoot, boxGeo(0.1, 0.3, 0.1, 0.9), mats.iron, 0, 1.3);
      break;
    }
  }
  weaponTip.position.set(0, (0.05 + bladeLen) * s, 0);
  weaponMid.position.set(0, (0.05 + bladeLen * 0.55) * s, 0);
  weaponRoot.add(weaponTip, weaponMid);

  // ---- shield
  const handL = joints.get('handL')!;
  if (opts.shield > 0) {
    const sh = J('shield', handL, 0, 0.02 * s, -0.06 * s); reg('shield', sh);
    const w = 0.5 * opts.shield, h = 0.66 * opts.shield;
    add(sh, boxGeo(w, h, 0.06, 0.9), mats.trim, 0, h * 0.35);
    add(sh, boxGeo(w * 0.8, h * 0.7, 0.05, 0.9), mats.cloth, 0, h * 0.35, -0.04);
    add(sh, cylGeo(0.06, 0.06, 0.08, 8, 0.9, [1, 1, 1]), mats.iron, 0, h * 0.35, 0.06);
  }

  // ---- ember glow (boss only): the Warden burns from the inside
  if (opts.emberGlow) {
    // molten seams read as cracks through the bell it was welded into, and keep the
    // silhouette identifiable even when the rest of the figure is in deep shadow
    const seam = new THREE.MeshStandardMaterial({ color: 0x150c06, emissive: 0xff8f36, emissiveIntensity: 2.6, roughness: 0.45, metalness: 0 });
    extras.push(seam);
    const bars: Array<[number, number, number, number, number, number, number]> = [
      // x, y, z, length, thickness, rotationZ, rotationX
      [-0.13, 1.52, -0.155, 0.30, 0.035, 0.5, 0],
      [0.15, 1.34, -0.16, 0.26, 0.03, -0.7, 0],
      [0.0, 1.12, -0.185, 0.34, 0.04, 0.12, 0.25],
      [-0.06, 0.86, -0.2, 0.22, 0.03, 1.1, 0],
      [0.1, 1.68, -0.1, 0.2, 0.03, 1.5, 0.4],
    ];
    for (const [x, y, z, len, th, rz, rx] of bars) {
      const m = new THREE.Mesh(boxGeo(len, th, th, 0.4), seam);
      m.position.set(x * s, y * s, z * s);
      m.rotation.set(rx, 0, rz);
      chest.add(m);
      meshes.push(m);
    }
    for (const [x, y, z] of [[-0.2, 1.5, -0.13], [0.2, 1.5, -0.13], [0, 1.18, -0.17]] as const) {
      const m = new THREE.Mesh(sphereGeo(0.05, 6), seam);
      m.position.set(x * s, y * s, z * s);
      chest.add(m);
      meshes.push(m);
    }
  }

  root.scale.setScalar(1);
  return {
    root, joints, weaponTip, weaponMid, handR, handL, head, chest, meshes, materials: mats, height: height * opts.scale,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const x of extras) x.dispose();
      mats.dispose();
    },
  };
}

/** Convenience: place a rig group so its origin sits at the actor's feet. */
export function attachRig(parent: THREE.Object3D, rig: Rig): THREE.Group {
  parent.add(rig.root);
  return rig.root;
}

export const RIG_DEFAULTS: RigOptions = {
  scale: 1, weapon: 'sword', shield: 1, bulk: 1, cloak: true,
  hornedHelm: false, bellPauldrons: false, chains: false, emberGlow: false,
};
