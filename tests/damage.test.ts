import { describe, it, expect } from 'vitest';
import { resolveDamage, withinGuardArc } from '../src/core/Damage';
import { GUARD } from '../src/config/Balance';
import type { DamageRequest, DefenderInfo } from '../src/core/Types';

function req(over: Partial<DamageRequest> = {}): DamageRequest {
  return {
    attackId: 1, source: 1, target: 2, kind: 'light', baseDamage: 100, poiseDamage: 1,
    dirX: 0, dirZ: 1, fromArea: false, hitX: 0, hitY: 0, hitZ: 0, ...over,
  };
}

function def(over: Partial<DefenderInfo> = {}): DefenderInfo {
  return {
    faction: 'player', facingX: 0, facingZ: -1, guarding: false, guardArcDeg: GUARD.arcDeg,
    stamina: 100, maxStamina: 100, invulnerable: false, health: 1000, poise: 60, maxPoise: 60,
    staggerThresholdReached: false, shieldedFront: false, ...over,
  };
}

describe('resolveDamage', () => {
  it('applies full damage to an unguarded defender', () => {
    const r = resolveDamage(req(), def());
    expect(r.damage).toBe(100);
    expect(r.blocked).toBe(false);
    expect(r.chip).toBe(0);
  });

  it('invulnerability (dodge i-frames) absorbs the blow completely', () => {
    const r = resolveDamage(req(), def({ invulnerable: true }));
    expect(r.damage).toBe(0);
    expect(r.blocked).toBe(false);
    expect(r.hitStop).toBe(0);
  });

  it('guard reduces damage and chips stamina', () => {
    const r = resolveDamage(req(), def({ guarding: true }));
    expect(r.blocked).toBe(true);
    expect(r.damage).toBeCloseTo(100 * GUARD.damageMultiplier);
    expect(r.chip).toBeCloseTo(100 * GUARD.chipStaminaFraction);
  });

  it('guard only protects inside the arc — a hit from behind is not blocked', () => {
    const facing = { facingX: 0, facingZ: -1 };
    // a blow travelling toward +Z arrives from -Z, i.e. the defender's front
    expect(withinGuardArc(facing, req({ dirX: 0, dirZ: 1 }), GUARD.arcDeg)).toBe(true);
    expect(withinGuardArc(facing, req({ dirX: 0, dirZ: -1 }), GUARD.arcDeg)).toBe(false);
    const behind = resolveDamage(req({ dirX: 0, dirZ: -1 }), def({ guarding: true }));
    expect(behind.blocked).toBe(false);
    expect(behind.damage).toBe(100);
  });

  it('breaking the guard lets most of the blow through and is flagged once', () => {
    const r = resolveDamage(req({ baseDamage: 100 }), def({ guarding: true, stamina: 2 }));
    expect(r.guardBroken).toBe(true);
    expect(r.damage).toBeGreaterThan(100 * GUARD.damageMultiplier);
    expect(r.chip).toBe(2);
    expect(r.staminaCost).toBe(2);
  });

  it('damage is clamped to remaining health and reports the kill', () => {
    const r = resolveDamage(req({ baseDamage: 500 }), def({ health: 40 }));
    expect(r.damage).toBe(40);
    expect(r.killed).toBe(true);
    expect(r.staggered).toBe(false);
  });

  it('poise builds to a stagger only when it is not blocked away', () => {
    const blocked = resolveDamage(req({ poiseDamage: 60 }), def({ guarding: true, stamina: 1000, maxStamina: 1000 }));
    expect(blocked.staggered).toBe(false);
    const open = resolveDamage(req({ poiseDamage: 60 }), def());
    expect(open.staggered).toBe(true);
  });

  it('area attacks chip twice the stamina of an equal frontal cut', () => {
    const single = resolveDamage(req({ kind: 'light', baseDamage: 100 }), def({ guarding: true, stamina: 1000, maxStamina: 1000 }));
    const area = resolveDamage(req({ kind: 'area', baseDamage: 100, fromArea: true }), def({ guarding: true, stamina: 1000, maxStamina: 1000 }));
    expect(area.blocked).toBe(true);
    expect(area.chip).toBeCloseTo(single.chip * 2);
  });

  it('an area attack arriving from behind is not blocked at all', () => {
    const r = resolveDamage(req({ kind: 'area', dirX: 0, dirZ: -1, fromArea: true }), def({ guarding: true }));
    expect(r.blocked).toBe(false);
    expect(r.damage).toBe(100);
  });

  it('a raised shield stops frontal light cuts but not heavy blows', () => {
    const light = resolveDamage(req({ kind: 'light' }), def({ shieldedFront: true }));
    expect(light.damage).toBe(0);
    expect(light.blocked).toBe(true);
    const heavy = resolveDamage(req({ kind: 'heavy', baseDamage: 100 }), def({ shieldedFront: true }));
    expect(heavy.damage).toBeGreaterThan(0);
  });

  it('hit-stop is bounded so feedback can never stall the simulation', () => {
    const r = resolveDamage(req({ baseDamage: 999, poiseDamage: 99 }), def({ health: 1000 }));
    expect(r.hitStop).toBeGreaterThan(0);
    expect(r.hitStop).toBeLessThanOrEqual(0.12);
  });

  it('zero-damage requests never report a kill', () => {
    const r = resolveDamage(req({ baseDamage: 0 }), def({ health: 1 }));
    expect(r.killed).toBe(false);
    expect(r.damage).toBe(0);
  });
});
