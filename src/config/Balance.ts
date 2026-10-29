/**
 * ASHEN VIGIL — single source of truth for gameplay tuning.
 * All durations are SECONDS, all distances METRES, all masses KILOGRAMS.
 * Nothing here may depend on graphics quality: combat timing is quality-independent.
 */

export const SIM = {
  fixedDt: 1 / 60,
  maxSubsteps: 5,
  maxFrameDt: 0.25,
  gravity: -24,
  terminalSpeed: -32,
} as const;

export const WORLD = {
  /** Y below which the player is considered lost to the void. */
  voidY: -22,
  voidDamage: 9999,
} as const;

export const PLAYER = {
  capsuleRadius: 0.36,
  capsuleHalfHeight: 0.5, // body origin is at the feet; collider is offset up by radius+halfHeight
  eyeHeight: 1.52,
  turnSpeed: 13,
  walkSpeed: 2.7,
  runSpeed: 4.7,
  sprintSpeed: 6.5,
  accel: 26,
  decel: 30,
  airControl: 0.55,
  stepHeight: 0.46,
  maxSlopeDeg: 46,
  slideSlopeDeg: 34,
  baseHealth: 120,
  baseStamina: 100,
  baseDamage: 18,
  basePoise: 34,
  poiseRegenDelay: 0.7,
  flaskCharges: 3,
  flaskHeal: 46,
  flaskCast: 1.15,
  flaskCancelWindow: 0.35, // may be cancelled into a dodge during the first N seconds
  invulnAfterHit: 0.22, // brief i-frames so multi-hitter attacks cannot chunk to death instantly
  staggerLock: 0.42,
  guardBreakLock: 1.15,
  respawnHealthFraction: 1,
} as const;

export const STAMINA = {
  regenDelayAfterUse: 0.55,
  regenRate: 34,
  regenRateGuarding: 12,
  guardHoldDrain: 7,
  sprintDrain: 15,
  lowThreshold: 0.18, // below this fraction the bar flashes
} as const;

export const GUARD = {
  arcDeg: 110, // frontal protection arc
  damageMultiplier: 0.2, // 80% reduction
  chipStaminaFraction: 0.55, // stamina cost = raw damage * this
  minStaminaToHold: 0,
} as const;

export interface AttackTrack {
  windup: number;
  active: number;
  recovery: number;
  staminaCost: number;
  damageMul: number;
  poiseMul: number;
  /** fraction of the swing during which the weapon arc is widest (visual + query aid) */
  arcDeg: number;
  reach: number;
  moveSpeedMul: number;
  /** forward drift applied during the active window (metres/sec) */
  lungeSpeed: number;
  cancelIntoDodge: number; // seconds after start where a dodge cancel is allowed (-1 = never, 99 = always)
  cancelIntoGuard: number;
}

export const COMBAT = {
  comboInputBuffer: 0.38,
  comboWindowAfterRecovery: 0.85,
  lightChain: [
    { windup: 0.17, active: 0.19, recovery: 0.30, staminaCost: 15, damageMul: 1.0, poiseMul: 0.55, arcDeg: 130, reach: 2.15, moveSpeedMul: 0.35, lungeSpeed: 2.4, cancelIntoDodge: 99, cancelIntoGuard: 99 },
    { windup: 0.15, active: 0.19, recovery: 0.30, staminaCost: 15, damageMul: 1.0, poiseMul: 0.55, arcDeg: 130, reach: 2.15, moveSpeedMul: 0.35, lungeSpeed: 2.4, cancelIntoDodge: 99, cancelIntoGuard: 99 },
    { windup: 0.20, active: 0.22, recovery: 0.50, staminaCost: 21, damageMul: 1.4, poiseMul: 1.0, arcDeg: 165, reach: 2.35, moveSpeedMul: 0.25, lungeSpeed: 3.0, cancelIntoDodge: 99, cancelIntoGuard: 99 },
  ] as AttackTrack[],
  heavy: { windup: 0.44, active: 0.24, recovery: 0.62, staminaCost: 30, damageMul: 2.2, poiseMul: 2.1, arcDeg: 150, reach: 2.5, moveSpeedMul: 0.15, lungeSpeed: 3.2, cancelIntoDodge: 0.30, cancelIntoGuard: 0.30 } as AttackTrack,
  /** weapon query sampling */
  hitRadius: 0.7, // swept-blade probe: must reliably catch a capsule at any blade height
  samplesPerSubstep: 4,
  maxHitPerSwing: 1,
} as const;

export const DODGE = {
  cost: 20,
  duration: 0.62,
  invulnStart: 0.08,
  invulnEnd: 0.42,
  speed: 7.4,
  rollTurnIn: 0.12,
  cooldown: 0.12,
  bufferWindow: 0.25,
  moveSpeedMul: 0,
} as const;

export interface EnemyDef {
  id: string;
  name: string;
  health: number;
  poise: number;
  damageMul: number;
  emberDrop: number;
  capsuleRadius: number;
  capsuleHalfHeight: number;
  height: number;
  turnSpeed: number;
  walkSpeed: number;
  runSpeed: number;
  detectRange: number;
  detectFovDeg: number;
  leashRange: number;
  attackRange: number;
  attackCooldown: number;
  maxActiveAttackers: number;
  staggerRecover: number;
  shieldedFront?: boolean;
  bodyColor: number;
  clothColor: number;
  metalColor: number;
  weaponKind: 'sword' | 'mace' | 'axe' | 'bellhammer';
  scale: number;
  attacks: Record<string, AttackTrack>;
  behaviour: {
    preferredDistance: number;
    strafeChance: number;
    backstepChance: number;
    variationChance: number;
    variationDelay: number;
  };
}

export const ENEMIES: Record<'sentry' | 'pilgrim' | 'brute', EnemyDef> = {
  sentry: {
    id: 'sentry', name: 'Hollow Sentry',
    health: 74, poise: 24, damageMul: 1, emberDrop: 30,
    capsuleRadius: 0.36, capsuleHalfHeight: 0.5, height: 1.78,
    turnSpeed: 6.5, walkSpeed: 2.4, runSpeed: 4.0,
    detectRange: 15, detectFovDeg: 110, leashRange: 34, attackRange: 2.3, attackCooldown: 1.05,
    maxActiveAttackers: 2, staggerRecover: 0.55,
    bodyColor: 0x4b5563, clothColor: 0x5a3a34, metalColor: 0x8a7a5c,
    weaponKind: 'sword', scale: 1,
    attacks: {
      strike: { windup: 0.46, active: 0.2, recovery: 0.5, staminaCost: 0, damageMul: 1, poiseMul: 0.8, arcDeg: 120, reach: 2.3, moveSpeedMul: 0.2, lungeSpeed: 1.2, cancelIntoDodge: -1, cancelIntoGuard: -1 },
      delayed: { windup: 0.72, active: 0.22, recovery: 0.62, staminaCost: 0, damageMul: 1.35, poiseMul: 1.2, arcDeg: 140, reach: 2.45, moveSpeedMul: 0.2, lungeSpeed: 2.2, cancelIntoDodge: -1, cancelIntoGuard: -1 },
    },
    behaviour: { preferredDistance: 2.0, strafeChance: 0.35, backstepChance: 0.12, variationChance: 0.35, variationDelay: 0.35 },
  },
  pilgrim: {
    id: 'pilgrim', name: 'Shield Pilgrim',
    health: 96, poise: 42, damageMul: 1, emberDrop: 46,
    capsuleRadius: 0.4, capsuleHalfHeight: 0.52, height: 1.86,
    turnSpeed: 4.6, walkSpeed: 2.0, runSpeed: 3.4,
    detectRange: 16, detectFovDeg: 120, leashRange: 34, attackRange: 2.2, attackCooldown: 1.5,
    maxActiveAttackers: 2, staggerRecover: 0.7, shieldedFront: true,
    bodyColor: 0x59646f, clothColor: 0x6b6552, metalColor: 0x9a8f76,
    weaponKind: 'mace', scale: 1.02,
    attacks: {
      bash: { windup: 0.55, active: 0.2, recovery: 0.66, staminaCost: 0, damageMul: 1.1, poiseMul: 1.4, arcDeg: 80, reach: 2.15, moveSpeedMul: 0.25, lungeSpeed: 2.6, cancelIntoDodge: -1, cancelIntoGuard: -1 },
      thrust: { windup: 0.62, active: 0.24, recovery: 0.8, staminaCost: 0, damageMul: 1.5, poiseMul: 1.1, arcDeg: 45, reach: 2.9, moveSpeedMul: 0.3, lungeSpeed: 3.4, cancelIntoDodge: -1, cancelIntoGuard: -1 },
    },
    behaviour: { preferredDistance: 1.95, strafeChance: 0.15, backstepChance: 0.1, variationChance: 0.3, variationDelay: 0.5 },
  },
  brute: {
    id: 'brute', name: 'Ashbound Brute',
    health: 158, poise: 92, damageMul: 1, emberDrop: 78,
    capsuleRadius: 0.52, capsuleHalfHeight: 0.66, height: 2.32,
    turnSpeed: 3.4, walkSpeed: 2.0, runSpeed: 3.6,
    detectRange: 17, detectFovDeg: 100, leashRange: 40, attackRange: 3.3, attackCooldown: 1.9,
    maxActiveAttackers: 1, staggerRecover: 0.85,
    bodyColor: 0x3f4753, clothColor: 0x4a3b30, metalColor: 0x7d6f55,
    weaponKind: 'axe', scale: 1.28,
    attacks: {
      overhead: { windup: 0.86, active: 0.24, recovery: 0.95, staminaCost: 0, damageMul: 1.6, poiseMul: 1.8, arcDeg: 90, reach: 3.2, moveSpeedMul: 0.15, lungeSpeed: 1.4, cancelIntoDodge: -1, cancelIntoGuard: -1 },
      sweep: { windup: 0.7, active: 0.28, recovery: 1.05, staminaCost: 0, damageMul: 1.35, poiseMul: 1.6, arcDeg: 200, reach: 3.5, moveSpeedMul: 0.2, lungeSpeed: 0.8, cancelIntoDodge: -1, cancelIntoGuard: -1 },
    },
    behaviour: { preferredDistance: 2.9, strafeChance: 0.1, backstepChance: 0.05, variationChance: 0.4, variationDelay: 0.45 },
  },
};

export const BOSS = {
  def: {
    id: 'warden', name: 'The Bellbound Warden',
    health: 760, poise: 165, damageMul: 1, emberDrop: 0,
    capsuleRadius: 0.62, capsuleHalfHeight: 0.82, height: 3.1,
    turnSpeed: 4.2, walkSpeed: 2.6, runSpeed: 4.6,
    detectRange: 30, detectFovDeg: 360, leashRange: 999, attackRange: 4.4, attackCooldown: 1.2,
    maxActiveAttackers: 1, staggerRecover: 0.6,
    bodyColor: 0x4e5a68, clothColor: 0x7a5531, metalColor: 0xb89a67,
    weaponKind: 'bellhammer', scale: 1.72,
    attacks: {
      sweep: { windup: 0.58, active: 0.26, recovery: 0.72, staminaCost: 0, damageMul: 1.15, poiseMul: 1.4, arcDeg: 210, reach: 4.3, moveSpeedMul: 0.2, lungeSpeed: 1.2, cancelIntoDodge: -1, cancelIntoGuard: -1 },
      combo1: { windup: 0.5, active: 0.24, recovery: 0.34, staminaCost: 0, damageMul: 1.0, poiseMul: 1.2, arcDeg: 190, reach: 4.2, moveSpeedMul: 0.25, lungeSpeed: 1.6, cancelIntoDodge: -1, cancelIntoGuard: -1 },
      combo2: { windup: 0.42, active: 0.26, recovery: 0.95, staminaCost: 0, damageMul: 1.3, poiseMul: 1.8, arcDeg: 220, reach: 4.5, moveSpeedMul: 0.2, lungeSpeed: 2.2, cancelIntoDodge: -1, cancelIntoGuard: -1 },
      slam: { windup: 0.82, active: 0.26, recovery: 1.05, staminaCost: 0, damageMul: 1.55, poiseMul: 2.2, arcDeg: 360, reach: 3.9, moveSpeedMul: 0.05, lungeSpeed: 0, cancelIntoDodge: -1, cancelIntoGuard: -1 },
      lunge: { windup: 0.62, active: 0.42, recovery: 0.9, staminaCost: 0, damageMul: 1.25, poiseMul: 1.6, arcDeg: 70, reach: 4.6, moveSpeedMul: 0.1, lungeSpeed: 9.5, cancelIntoDodge: -1, cancelIntoGuard: -1 },
      toll: { windup: 0.95, active: 0.35, recovery: 1.15, staminaCost: 0, damageMul: 1.4, poiseMul: 2.0, arcDeg: 360, reach: 6.4, moveSpeedMul: 0, lungeSpeed: 0, cancelIntoDodge: -1, cancelIntoGuard: -1 },
    },
    behaviour: { preferredDistance: 3.4, strafeChance: 0.25, backstepChance: 0.1, variationChance: 0.5, variationDelay: 0.4 },
  } as EnemyDef,
  phaseTwoFraction: 0.5,
  transitionDuration: 1.9,
  phaseTwoCooldownMul: 0.72,
  phaseTwoSpeedMul: 1.12, // windup shortening only; damage is NOT doubled
  arenaRadius: 15.5,
  arenaCenter: { x: 0, z: -46 },
  slamRadius: 3.9,
  slamTelegraphLead: 0.55, // region is shown this long before the windup even finishes enough to matter
  tollRingRadius: 6.4,
  rewardEmbers: 900,
} as const;

export const PROGRESSION = {
  maxHealthPerLevel: 22,
  maxHealthLevels: 5,
  maxStaminaPerLevel: 16,
  maxStaminaLevels: 5,
  damagePerLevel: 5,
  damageLevels: 6,
  /** index = current level, value = cost of the NEXT level */
  prices: {
    health: [70, 150, 270, 430, 640],
    stamina: [60, 130, 240, 380, 560],
    damage: [110, 230, 400, 640, 940, 1300],
  },
} as const;

export const WORLD_REWARDS = {
  emberCache: 55,
  flaskUpgradeCharges: 1,
  loreCount: 5,
} as const;

export const CHECKPOINT = {
  threatRange: 13, // hostile actors closer than this block resting
  restHealFraction: 1,
} as const;

export const DEATH = {
  dropRadiusFromCheckpoint: 0, // 0 = use last safe position
  animDuration: 1.6,
  messageDelay: 1.1,
} as const;

export const CAMERA = {
  distance: 4.6,
  lockDistance: 5.4,
  height: 1.35,
  pitchMin: -1.15,
  pitchMax: 1.35,
  fov: 52,
  fovSprintAdd: 5,
  lookAhead: 0.35,
  damping: 9.5,
  radiusDamping: 11,
  minRadius: 1.1,
  probeRadius: 0.28,
  recoveryAfterBlock: 0.6,
  shakeDecay: 6.5,
} as const;

export const FX = {
  hitStopPlayer: 0.055,
  hitStopEnemy: 0.045,
  hitStopHeavy: 0.085,
  maxSparks: 220,
  maxAsh: 900,
  maxDust: 160,
  corpseLimit: 12,
  decalLimit: 24,
} as const;
