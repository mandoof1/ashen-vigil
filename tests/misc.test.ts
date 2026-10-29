import { describe, it, expect } from 'vitest';
import { applyUpgrade, statValue, upgradeCost, maxLevel, normaliseUpgrades, UPGRADE_ORDER } from '../src/core/Progression';
import { PLAYER, PROGRESSION, SIM } from '../src/config/Balance';
import { clampQuality, PRESETS, DEFAULT_QUALITY } from '../src/config/Quality';
import { clamp, wrapAngle, angleDiff, norm2, damp, approach, mulberry32 } from '../src/core/MathX';

describe('progression', () => {
  it('prices rise monotonically for every track', () => {
    for (const kind of UPGRADE_ORDER) {
      let prev = -1;
      for (let lvl = 0; lvl < maxLevel(kind); lvl++) {
        const c = upgradeCost(kind, lvl)!;
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
      expect(upgradeCost(kind, maxLevel(kind))).toBeNull();
    }
  });

  it('stat tracks start at the base value and grow monotonically', () => {
    expect(statValue('health', 0)).toBe(PLAYER.baseHealth);
    for (let i = 1; i <= maxLevel('health'); i++) expect(statValue('health', i)).toBeGreaterThan(statValue('health', i - 1));
    expect(statValue('health', 99)).toBe(PLAYER.baseHealth + PROGRESSION.maxHealthLevels * PROGRESSION.maxHealthPerLevel);
    expect(statValue('damage', -5)).toBe(PLAYER.baseDamage);
  });

  it('purchase deducts exactly the cost once', () => {
    const wallet = { embers: 500, upgrades: { health: 0, stamina: 0, damage: 0 } };
    const res = applyUpgrade(wallet, 'health');
    expect(res.ok).toBe(true);
    expect(wallet.embers).toBe(500 - PROGRESSION.prices.health[0]);
    expect(wallet.upgrades.health).toBe(1);
  });

  it('a failed purchase never mutates the wallet', () => {
    const wallet = { embers: 5, upgrades: { health: 0, stamina: 0, damage: 0 } };
    const res = applyUpgrade(wallet, 'health');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('afford');
    expect(wallet.embers).toBe(5);
    expect(wallet.upgrades.health).toBe(0);
  });

  it('tracks cap and report "maxed" past the cap', () => {
    const wallet = { embers: 1e9, upgrades: { health: maxLevel('health'), stamina: 0, damage: 0 } };
    const res = applyUpgrade(wallet, 'health');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('maxed');
    expect(wallet.embers).toBe(1e9);
  });

  it('unknown upgrade kinds are rejected', () => {
    const wallet = { embers: 100, upgrades: { health: 0, stamina: 0, damage: 0 } };
    const res = applyUpgrade(wallet, 'luck' as never);
    expect(res.ok).toBe(false);
  });

  it('normaliseUpgrades clamps hostile input', () => {
    expect(normaliseUpgrades({ health: 'x', stamina: 99, damage: -3 })).toEqual({ health: 0, stamina: maxLevel('stamina'), damage: 0 });
    expect(normaliseUpgrades(null)).toEqual({ health: 0, stamina: 0, damage: 0 });
  });
});

describe('quality presets', () => {
  it('every preset is complete and internally consistent', () => {
    for (const name of ['low', 'medium', 'high', 'ultra'] as const) {
      const q = PRESETS[name];
      expect(q.renderScale).toBeGreaterThan(0);
      expect(q.renderScale).toBeLessThanOrEqual(2);
      expect(q.shadowDistance).toBeGreaterThanOrEqual(0);
      expect(q.particles).toBeGreaterThanOrEqual(0);
    }
    expect(PRESETS.low.renderScale).toBeLessThanOrEqual(PRESETS.ultra.renderScale);
  });

  it('clampQuality keeps any user slider inside legal bounds', () => {
    const q = clampQuality({ ...DEFAULT_QUALITY, preset: 'custom', renderScale: 99, particles: -5, lodDistance: -1 });
    expect(q.renderScale).toBeLessThanOrEqual(2);
    expect(q.renderScale).toBeGreaterThan(0);
    expect(q.particles).toBeGreaterThanOrEqual(0);
    expect(q.lodDistance).toBeGreaterThan(0);
    const q2 = clampQuality({ ...DEFAULT_QUALITY, renderScale: NaN });
    expect(Number.isFinite(q2.renderScale)).toBe(true);
  });

  it('quality never changes simulation timing', () => {
    // the fixed step is a constant that no quality path can touch
    expect(SIM.fixedDt).toBeCloseTo(1 / 60, 6);
    expect(SIM.maxSubsteps).toBeGreaterThan(0);
    expect(JSON.stringify(PRESETS.low)).not.toContain('dt');
  });
});

describe('math helpers', () => {
  it('clamp and approach behave at the edges', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
  });

  it('angles wrap through the -PI/PI seam instead of spinning', () => {
    expect(wrapAngle(Math.PI * 2 + 0.1)).toBeCloseTo(0.1);
    expect(angleDiff(3.0, -3.0)).toBeCloseTo(0.2831853, 4);
    expect(Math.abs(angleDiff(3.1, -3.1))).toBeLessThan(Math.PI);
  });

  it('norm2 handles the zero vector', () => {
    expect(norm2(0, 0)).toEqual({ x: 0, z: 0, len: 0 });
    expect(norm2(0, 3).z).toBe(1);
  });

  it('damp is frame-rate independent: same elapsed time, same result', () => {
    const a = (() => { let v = 0; for (let i = 0; i < 60; i++) v = damp(v, 10, 0.2, 1 / 60); return v; })();
    const b = (() => { let v = 0; for (let i = 0; i < 240; i++) v = damp(v, 10, 0.2, 1 / 240); return v; })();
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });

  it('the procedural rng is deterministic per seed', () => {
    const a = mulberry32(1337), b = mulberry32(1337);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
