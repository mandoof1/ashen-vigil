/** Shared typed contracts. No three.js / Rapier imports here: these are unit-testable. */

export type ActorId = number;

export const NO_ACTOR: ActorId = -1;

export type Faction = 'player' | 'enemy' | 'neutral';

export type ActorKind = 'player' | 'sentry' | 'pilgrim' | 'brute' | 'warden' | 'prop';

export type CombatState =
  | 'idle' | 'walk' | 'run' | 'sprint' | 'air'
  | 'attackWindup' | 'attackActive' | 'attackRecovery'
  | 'guard' | 'guardImpact' | 'dodge' | 'heal' | 'stagger' | 'guardBreak'
  | 'dead' | 'interact' | 'transition';

export type DamageKind = 'light' | 'heavy' | 'enemy' | 'boss' | 'area' | 'fall';

/** A hit attempt produced by the attack system, before the defender resolves it. */
export interface DamageRequest {
  attackId: number;      // unique per swing / attack instance
  source: ActorId;
  target: ActorId;
  kind: DamageKind;
  baseDamage: number;    // already includes weapon/upgrade scaling
  poiseDamage: number;
  /** world-space direction the blow travels (normalised) */
  dirX: number;
  dirZ: number;
  /** true when the attack came from a wide area effect (unblockable by facing alone) */
  fromArea: boolean;
  hitX: number;
  hitY: number;
  hitZ: number;
}

export interface DefenderInfo {
  faction: Faction;
  facingX: number;
  facingZ: number;
  guarding: boolean;
  guardArcDeg: number;
  stamina: number;
  maxStamina: number;
  invulnerable: boolean;
  health: number;
  poise: number;
  maxPoise: number;
  staggerThresholdReached: boolean;
  shieldedFront: boolean;
}

export interface DamageResult {
  request: DamageRequest;
  damage: number;        // health actually removed
  chip: number;          // stamina removed by blocking
  staminaCost: number;
  blocked: boolean;
  guardBroken: boolean;
  staggered: boolean;
  killed: boolean;
  poiseDamage: number;
  hitStop: number;
}

export interface HitRecord {
  attackId: number;
  target: ActorId;
}

export interface UpgradeLevels {
  health: number;
  stamina: number;
  damage: number;
}

export interface DropState {
  embers: number;
  x: number;
  y: number;
  z: number;
  collected: boolean;
}

export interface SaveData {
  version: number;
  createdAt: number;
  updatedAt: number;
  checkpointId: string;
  embers: number;
  upgrades: UpgradeLevels;
  shortcuts: Record<string, boolean>;
  pickups: Record<string, boolean>;
  lore: Record<string, boolean>;
  bossesDefeated: Record<string, boolean>;
  drop: DropState | null;
  settings: Record<string, unknown>;
  quality: Record<string, unknown>;
  tutorialSeen: Record<string, boolean>;
  stats: { deaths: number; kills: number; playSeconds: number; bellRung: boolean };
}
