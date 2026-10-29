import { COMBAT, FX, GUARD } from '../config/Balance';
import type { DamageRequest, DamageResult, DefenderInfo } from './Types';
import { DEG } from './MathX';

/** True when the blow arrives inside the defender's protection arc. */
export function withinGuardArc(defender: Pick<DefenderInfo, 'facingX' | 'facingZ'>, request: DamageRequest, arcDeg: number): boolean {
  const fl = Math.hypot(defender.facingX, defender.facingZ);
  if (fl < 1e-6) return false;
  const fx = defender.facingX / fl, fz = defender.facingZ / fl;
  // direction the attack travels *toward* the defender; the blow comes from the opposite side
  const dx = request.dirX, dz = request.dirZ;
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-6) return true;
  const dot = (fx * -dx + fz * -dz) / dl;
  const cosHalf = Math.cos((arcDeg * DEG) / 2);
  return dot >= cosHalf;
}

/**
 * Resolve one hit attempt against one defender. Pure and deterministic.
 * Order of precedence: invulnerability -> shield/guard -> chip -> poise.
 */
export function resolveDamage(request: DamageRequest, defender: DefenderInfo): DamageResult {
  const area = request.fromArea;
  const facingOk = withinGuardArc(defender, request, defender.guardArcDeg);

  if (defender.invulnerable) {
    return {
      request, damage: 0, chip: 0, staminaCost: 0, blocked: false, guardBroken: false,
      staggered: false, killed: false, poiseDamage: 0, hitStop: 0,
    };
  }

  let damage = Math.max(0, request.baseDamage);
  let chip = 0;
  let blocked = false;
  let guardBroken = false;

  const frontalShield = defender.shieldedFront && facingOk;
  if (frontalShield && request.kind === 'light') {
    // a raised shield stops frontal light cuts outright; heavy blows still bite
    damage = 0;
    blocked = true;
    chip = 0;
  } else if (defender.guarding && facingOk) {
    blocked = true;
    damage = damage * GUARD.damageMultiplier;
    chip = request.baseDamage * GUARD.chipStaminaFraction * (area ? 2 : 1);
    if (defender.stamina <= chip + 1e-6) {
      guardBroken = true;
      damage = request.baseDamage * 0.6; // punish: the guard collapses and most damage gets through
      chip = defender.stamina;
    }
  }

  const killed = damage >= defender.health && defender.health > 0;
  const poiseDamage = blocked && !guardBroken ? request.poiseDamage * 0.35 : request.poiseDamage;
  const staggered = !killed && !guardBroken && defender.poise > 0 && poiseDamage >= defender.poise;

  const hitStop = damage <= 0
    ? (blocked ? 0.02 : 0)
    : (request.poiseDamage >= 1.6 ? FX.hitStopHeavy : (defender.faction === 'player' ? FX.hitStopPlayer : FX.hitStopEnemy));

  return {
    request,
    damage: Math.min(damage, defender.health),
    chip,
    staminaCost: blocked ? chip : 0,
    blocked,
    guardBroken,
    staggered,
    killed,
    poiseDamage,
    hitStop: Math.min(hitStop, COMBAT.maxHitPerSwing > 0 ? 0.12 : 0.12),
  };
}
