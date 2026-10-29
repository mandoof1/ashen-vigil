import { PLAYER, PROGRESSION } from '../config/Balance';
import type { UpgradeLevels } from './Types';

export type UpgradeKind = 'health' | 'stamina' | 'damage';

export const UPGRADE_ORDER: UpgradeKind[] = ['health', 'stamina', 'damage'];

export function upgradeLabel(kind: UpgradeKind): { name: string; desc: string } {
  switch (kind) {
    case 'health': return { name: 'Vigil Body', desc: 'Maximum vitality' };
    case 'stamina': return { name: 'Vigil Wind', desc: 'Maximum stamina' };
    case 'damage': return { name: 'Cutter Edge', desc: 'Weapon damage' };
  }
}

export function maxLevel(kind: UpgradeKind): number {
  return kind === 'health' ? PROGRESSION.maxHealthLevels
    : kind === 'stamina' ? PROGRESSION.maxStaminaLevels
      : PROGRESSION.damageLevels;
}

/** Cost of the next level, or null when the track is capped. */
export function upgradeCost(kind: UpgradeKind, level: number): number | null {
  const table: readonly number[] =
    kind === 'health' ? PROGRESSION.prices.health
      : kind === 'stamina' ? PROGRESSION.prices.stamina
        : PROGRESSION.prices.damage;
  if (level < 0 || level >= table.length) return null;
  return table[level];
}

export function statValue(kind: UpgradeKind, level: number): number {
  const l = Math.max(0, Math.min(maxLevel(kind), level | 0));
  switch (kind) {
    case 'health': return PLAYER.baseHealth + l * PROGRESSION.maxHealthPerLevel;
    case 'stamina': return PLAYER.baseStamina + l * PROGRESSION.maxStaminaPerLevel;
    case 'damage': return PLAYER.baseDamage + l * PROGRESSION.damagePerLevel;
  }
}

export interface PurchaseWallet {
  embers: number;
  upgrades: UpgradeLevels;
}

export type PurchaseOutcome =
  | { ok: true; kind: UpgradeKind; cost: number; embers: number }
  | { ok: false; reason: 'maxed' | 'afford' | 'unknown' };

/** Deduct-and-apply exactly once. Never mutates on failure. */
export function applyUpgrade(wallet: PurchaseWallet, kind: UpgradeKind): PurchaseOutcome {
  if (!UPGRADE_ORDER.includes(kind)) return { ok: false, reason: 'unknown' };
  const level = wallet.upgrades[kind] ?? 0;
  const cost = upgradeCost(kind, level);
  if (cost === null) return { ok: false, reason: 'maxed' };
  if (wallet.embers < cost) return { ok: false, reason: 'afford' };
  wallet.embers -= cost;
  wallet.upgrades[kind] = level + 1;
  return { ok: true, kind, cost, embers: wallet.embers };
}

export function normaliseUpgrades(raw: unknown): UpgradeLevels {
  const r = (raw ?? {}) as Record<string, unknown>;
  const clampLevel = (v: unknown, kind: UpgradeKind): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
    return Math.max(0, Math.min(maxLevel(kind), n));
  };
  return { health: clampLevel(r.health, 'health'), stamina: clampLevel(r.stamina, 'stamina'), damage: clampLevel(r.damage, 'damage') };
}
