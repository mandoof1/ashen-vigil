/** Shared PBR material library. Built once, reused by every static mesh. */
import * as THREE from 'three';
import { makeClothSet, makeGroundSet, makeMetalSet, makeRadialSprite, makeStoneSet, makeWoodSet, type TextureSet } from './Textures';

export interface MaterialLibrary {
  stoneWall: THREE.MeshStandardMaterial;
  stoneFloor: THREE.MeshStandardMaterial;
  stoneStep: THREE.MeshStandardMaterial;
  stoneCarved: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  moss: THREE.MeshStandardMaterial;
  clothBanner: THREE.MeshStandardMaterial;
  ember: THREE.MeshBasicMaterial;
  barrier: THREE.MeshStandardMaterial;
  ash: THREE.MeshStandardMaterial;
  /** shared soft radial sprite for flame glows / halos (never a hard square) */
  glow: THREE.Texture;
  sets: TextureSet[];
  dispose(): void;
}

let anisoCap = 4;
const tune = (t: THREE.Texture): void => { t.anisotropy = Math.max(1, Math.min(8, anisoCap)); };

export function buildMaterials(maxAnisotropy: number): MaterialLibrary {
  const sets: TextureSet[] = [];
  anisoCap = maxAnisotropy;

  const wallSet = makeStoneSet({ seed: 11, base: [0.40, 0.45, 0.52], warm: [0.52, 0.48, 0.41], cracks: 0.62 });
  const floorSet = makeStoneSet({ seed: 77, base: [0.35, 0.39, 0.45], warm: [0.47, 0.43, 0.37], cracks: 0.42 });
  const stepSet = makeStoneSet({ seed: 23, base: [0.41, 0.45, 0.50], warm: [0.50, 0.46, 0.40], cracks: 0.3, size: 256 });
  const carvedSet = makeStoneSet({ seed: 55, base: [0.46, 0.48, 0.53], warm: [0.56, 0.50, 0.41], cracks: 0.25 });
  const groundSet = makeGroundSet();
  const bronzeSet = makeMetalSet(303);
  const ironSet = makeMetalSet(909);
  const woodSet = makeWoodSet(404);
  const bannerSet = makeClothSet(505, [0.36, 0.16, 0.15]);
  const ashSet = makeStoneSet({ seed: 808, base: [0.22, 0.23, 0.25], warm: [0.3, 0.28, 0.25], cracks: 0.15, size: 256 });
  sets.push(wallSet, floorSet, stepSet, carvedSet, groundSet, bronzeSet, ironSet, woodSet, bannerSet, ashSet);
  for (const s of sets) { tune(s.map); tune(s.roughnessMap); tune(s.normalMap); }

  const mk = (set: TextureSet, o: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      map: set.map,
      roughnessMap: set.roughnessMap,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      vertexColors: true,
      ...o,
    });
    return m;
  };

  const library: MaterialLibrary = {
    stoneWall: mk(wallSet, { color: 0xbcc4cf, roughness: 0.92, metalness: 0.02 }),
    stoneFloor: mk(floorSet, { color: 0xa8b1bd, roughness: 0.9, metalness: 0.02 }),
    stoneStep: mk(stepSet, { color: 0xb2bac5, roughness: 0.88, metalness: 0.02 }),
    stoneCarved: mk(carvedSet, { color: 0xc3c8d0, roughness: 0.8, metalness: 0.04 }),
    ground: mk(groundSet, { color: 0x9aa0a8, roughness: 0.96, metalness: 0.0 }),
    bronze: mk(bronzeSet, { color: 0xb08d4f, roughness: 0.44, metalness: 0.86 }),
    iron: mk(ironSet, { color: 0x6d7480, roughness: 0.56, metalness: 0.9 }),
    wood: mk(woodSet, { color: 0x8d7355, roughness: 0.85, metalness: 0.0 }),
    moss: new THREE.MeshStandardMaterial({ color: 0x4a5a3c, roughness: 0.95, metalness: 0, vertexColors: true, flatShading: false }),
    clothBanner: mk(bannerSet, { color: 0x8a3b3a, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    ash: mk(ashSet, { color: 0x8f949c, roughness: 0.95, metalness: 0.0 }),
    ember: new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.9, depthWrite: false }),
    glow: makeRadialSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 128, 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.16)'),
    barrier: new THREE.MeshStandardMaterial({
      color: 0x2b3a4a, emissive: 0x1c3550, emissiveIntensity: 0.9, transparent: true, opacity: 0.42,
      roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
    }),
    sets,
    dispose() {
      for (const s of sets) { s.map.dispose(); s.roughnessMap.dispose(); s.normalMap.dispose(); }
      library.glow.dispose();
      for (const key of ['stoneWall', 'stoneFloor', 'stoneStep', 'stoneCarved', 'ground', 'bronze', 'iron', 'wood', 'moss', 'clothBanner', 'ember', 'barrier', 'ash'] as const) {
        library[key].dispose();
      }
    },
  };
  return library;
}

export interface CharacterMaterials {
  body: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  dispose(): void;
}

/** Per-actor materials: shared texture sets, distinct colours. */
export function buildCharacterMaterials(body: number, cloth: number, metal: number, maxAnisotropy: number, seed: number): CharacterMaterials {
  anisoCap = maxAnisotropy;
  const clothSet = makeClothSet(seed, [((cloth >> 16) & 255) / 255, ((cloth >> 8) & 255) / 255, (cloth & 255) / 255], 1, 128);
  const metalSet = makeMetalSet(seed + 17, 1, 128);
  for (const s of [clothSet, metalSet]) { tune(s.map); tune(s.roughnessMap); tune(s.normalMap); }
  const mats: CharacterMaterials = {
    body: new THREE.MeshStandardMaterial({ color: body, roughness: 0.72, metalness: 0.28, map: metalSet.map, roughnessMap: metalSet.roughnessMap, normalMap: metalSet.normalMap, normalScale: new THREE.Vector2(0.5, 0.5) }),
    cloth: new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.94, metalness: 0.0, map: clothSet.map, roughnessMap: clothSet.roughnessMap, normalMap: clothSet.normalMap, side: THREE.DoubleSide }),
    trim: new THREE.MeshStandardMaterial({ color: metal, roughness: 0.42, metalness: 0.85, map: metalSet.map, roughnessMap: metalSet.roughnessMap, normalMap: metalSet.normalMap }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9fb0c2, roughness: 0.3, metalness: 0.95, map: metalSet.map, roughnessMap: metalSet.roughnessMap, normalMap: metalSet.normalMap }),
    iron: new THREE.MeshStandardMaterial({ color: 0x5d646f, roughness: 0.55, metalness: 0.9, map: metalSet.map, roughnessMap: metalSet.roughnessMap, normalMap: metalSet.normalMap }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6f5a42, roughness: 0.88, metalness: 0.0 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.86, metalness: 0.05 }),
    dispose() {
      clothSet.map.dispose(); clothSet.roughnessMap.dispose(); clothSet.normalMap.dispose();
      metalSet.map.dispose(); metalSet.roughnessMap.dispose(); metalSet.normalMap.dispose();
      for (const k of ['body', 'cloth', 'trim', 'steel', 'iron', 'wood', 'leather'] as const) mats[k].dispose();
    },
  };
  return mats;
}
