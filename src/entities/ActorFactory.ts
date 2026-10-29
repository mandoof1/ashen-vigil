/** Builds player / enemy / boss actors: physics capsule + original rig + materials. */
import { buildCharacterMaterials } from '../render/Materials';
import { buildRig, type RigOptions } from '../render/HumanoidRig';
import type { PhysicsWorld } from '../physics/Physics';
import { Player } from './Player';
import { Enemy } from './Enemy';
import { Boss } from './Boss';
import { ENEMIES, BOSS } from '../config/Balance';
import type { SpawnDef } from '../world/LevelData';
import type { UpgradeLevels } from '../core/Types';

export interface ActorHandle {
  actor: Enemy | Boss | Player;
  colliderHandle: number;
}

export function createPlayer(
  phys: PhysicsWorld, aniso: number, upgrades: UpgradeLevels, embers: number,
  maxFlasks: number, x: number, y: number, z: number, yaw: number,
): Player {
  const mats = buildCharacterMaterials(0x6f7a87, 0x7b4239, 0xb09a6e, aniso, 101);
  const opts: RigOptions = {
    scale: 1, weapon: 'sword', shield: 1, bulk: 1.06, cloak: true,
    hornedHelm: false, bellPauldrons: false, chains: false, emberGlow: false,
  };
  const rig = buildRig(mats, opts, 1.8);
  const body = phys.createCharacter(x, y, z, 0.36, 0.5);
  return new Player(phys, body, rig, {
    id: 1, kind: 'player', faction: 'player', x, y, z, yaw,
    radius: 0.36, halfHeight: 0.5, height: 1.8,
    maxHealth: 120, poise: 34, upgrades, embers, maxFlasks,
  });
}

export function createEnemy(phys: PhysicsWorld, aniso: number, spawn: SpawnDef, id: number): Enemy {
  const def = ENEMIES[spawn.type];
  const mats = buildCharacterMaterials(def.bodyColor, def.clothColor, def.metalColor, aniso, id * 37 + 5);
  const opts: RigOptions = {
    scale: def.scale,
    weapon: def.weaponKind,
    shield: def.shieldedFront ? 1.45 : (spawn.type === 'sentry' ? 0.7 : 0),
    bulk: spawn.type === 'brute' ? 1.35 : 1.02,
    cloak: spawn.type !== 'sentry',
    hornedHelm: spawn.type !== 'pilgrim',
    bellPauldrons: false,
    chains: spawn.type === 'brute',
    emberGlow: false,
  };
  const rig = buildRig(mats, opts, def.height);
  const body = phys.createCharacter(spawn.x, spawn.y, spawn.z, def.capsuleRadius, def.capsuleHalfHeight);
  return new Enemy(phys, body, rig, {
    id, kind: spawn.type, faction: 'enemy',
    x: spawn.x, y: spawn.y, z: spawn.z, yaw: 0,
    radius: def.capsuleRadius, halfHeight: def.capsuleHalfHeight, height: def.height,
    maxHealth: def.health, poise: def.poise,
    def, home: [spawn.home?.[0] ?? spawn.x, spawn.home?.[1] ?? spawn.z],
    patrol: spawn.patrol, tag: spawn.tag,
  });
}

export function createBoss(phys: PhysicsWorld, aniso: number, id: number, x: number, y: number, z: number): Boss {
  const def = BOSS.def;
  const mats = buildCharacterMaterials(def.bodyColor, def.clothColor, def.metalColor, aniso, 911);
  const opts: RigOptions = {
    scale: def.scale, weapon: def.weaponKind, shield: 0, bulk: 1.3,
    cloak: true, hornedHelm: true, bellPauldrons: true, chains: true, emberGlow: true,
  };
  const rig = buildRig(mats, opts, def.height);
  const body = phys.createCharacter(x, y, z, def.capsuleRadius, def.capsuleHalfHeight);
  return new Boss(phys, body, rig, {
    id, kind: 'warden', faction: 'enemy',
    x, y, z, yaw: 0,
    radius: def.capsuleRadius, halfHeight: def.capsuleHalfHeight, height: def.height,
    maxHealth: def.health, poise: def.poise,
    def, home: [x, z],
  });
}
