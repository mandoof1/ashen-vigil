import { normaliseUpgrades } from './Progression';
import type { DropState, SaveData } from './Types';

export const SAVE_KEY = 'ashen_vigil_save';
export const SAVE_VERSION = 3;

export type SaveValidation = { ok: true; data: SaveData } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

function str(v: unknown, fallback: string, maxLen = 64): string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen ? v : fallback;
}

function flagMap(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isRecord(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === 'string' && k.length <= 64) out[k] = val === true;
  }
  return out;
}

function readDrop(v: unknown): DropState | null {
  if (!isRecord(v)) return null;
  const embers = num(v.embers, 0, 0, 1_000_000);
  if (embers <= 0) return null;
  const x = num(v.x, NaN, -1e5, 1e5);
  const y = num(v.y, NaN, -1e4, 1e4);
  const z = num(v.z, NaN, -1e5, 1e5);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { embers, x, y, z, collected: v.collected === true };
}

/**
 * Validate untrusted JSON into a SaveData. Never executes anything, never throws.
 * Unknown keys are dropped; missing keys fall back to defaults; wrong types are coerced.
 */
export interface SaveLegalIds { checkpointIds?: readonly string[] }

export function validateSave(raw: unknown, legal: SaveLegalIds = {}): SaveValidation {
  if (!isRecord(raw)) return { ok: false, reason: 'not an object' };
  const version = num(raw.version, 0, 0, 1000);
  if (version <= 0) return { ok: false, reason: 'missing version' };
  if (version > SAVE_VERSION) return { ok: false, reason: `newer save (v${version})` };

  const statsIn = isRecord(raw.stats) ? raw.stats : {};
  const data: SaveData = {
    version: SAVE_VERSION,
    createdAt: num(raw.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    updatedAt: num(raw.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    checkpointId: legal.checkpointIds && !legal.checkpointIds.includes(str(raw.checkpointId, 'cp_approach'))
      ? 'cp_approach'
      : str(raw.checkpointId, 'cp_approach'),
    embers: num(raw.embers, 0, 0, 1_000_000),
    upgrades: normaliseUpgrades(raw.upgrades),
    shortcuts: flagMap(raw.shortcuts),
    pickups: flagMap(raw.pickups),
    lore: flagMap(raw.lore),
    bossesDefeated: flagMap(raw.bossesDefeated),
    drop: readDrop(raw.drop),
    settings: isRecord(raw.settings) ? (raw.settings as Record<string, unknown>) : {},
    quality: isRecord(raw.quality) ? (raw.quality as Record<string, unknown>) : {},
    tutorialSeen: flagMap(raw.tutorialSeen),
    stats: {
      deaths: num(statsIn.deaths, 0, 0, 1_000_000),
      kills: num(statsIn.kills, 0, 0, 1_000_000),
      playSeconds: num(statsIn.playSeconds, 0, 0, 1e9),
      bellRung: statsIn.bellRung === true,
    },
  };
  return { ok: true, data };
}

export function createNewSave(settings: Record<string, unknown>, quality: Record<string, unknown>): SaveData {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    checkpointId: 'cp_approach',
    embers: 0,
    upgrades: { health: 0, stamina: 0, damage: 0 },
    shortcuts: {},
    pickups: {},
    lore: {},
    bossesDefeated: {},
    drop: null,
    settings,
    quality,
    tutorialSeen: {},
    stats: { deaths: 0, kills: 0, playSeconds: 0, bellRung: false },
  };
}

export function parseSaveJSON(text: string, legal: SaveLegalIds = {}): SaveValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed JSON' };
  }
  return validateSave(parsed, legal);
}

export function serialiseSave(data: SaveData): string {
  return JSON.stringify(data);
}
