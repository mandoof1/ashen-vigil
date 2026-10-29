/**
 * Attack windows and hit resolution.
 *
 * Damage is only produced during the visible active window, and the query sweeps the
 * actual rendered blade (previous frame tip -> current frame tip, sampled), so a fast
 * swing can never tunnel past a target between two rendered frames.
 * Hits are de-duplicated per attack instance id.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/Physics';
import { MASK_ACTOR, MASK_WORLD } from '../physics/Physics';
import { HitRegistry } from '../core/HitRegistry';
import { resolveDamage } from '../core/Damage';
import { COMBAT } from '../config/Balance';
import type { AttackTrack } from '../config/Balance';
import type { Actor } from '../entities/Actor';
import type { DamageKind, DamageRequest, ActorId } from '../core/Types';
import type { EventBus } from '../core/Events';
import { DEG, clamp } from '../core/MathX';

export interface AreaAttack {
  x: number; y: number; z: number;
  radius: number;
  arcDeg: number;
  facingX: number; facingZ: number;
  damage: number;
  poise: number;
  attackId: number;
  source: Actor;
  kind: DamageKind;
  resolved: boolean;
}

export class CombatSystem {
  private registry = new HitRegistry();
  private areas: AreaAttack[] = [];
  private tipA = new THREE.Vector3();
  private tipB = new THREE.Vector3();
  private midA = new THREE.Vector3();
  private midB = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  /** global hit-stop (visual/UI only; simulation timing is never distorted) */
  public hitStopTimer = 0;

  constructor(private phys: PhysicsWorld, private events: EventBus, private byCollider: Map<number, Actor>) { }

  beginAttack(actor: Actor, track: AttackTrack): number {
    void track;
    const id = this.registry.beginAttack(COMBAT.maxHitPerSwing);
    actor.attackId = id;
    actor.tipReady = false;
    return id;
  }

  endAttack(actor: Actor): void {
    if (actor.attackId >= 0) this.registry.endAttack(actor.attackId);
    actor.attackId = -1;
  }

  registerArea(area: AreaAttack): void { this.areas.push(area); }

  private hitStop(amount: number): void {
    this.hitStopTimer = Math.max(this.hitStopTimer, amount);
  }

  /** Resolve every attack that is currently inside its active window. */
  tick(dt: number, actors: Iterable<Actor>): void {
    void dt;
    for (const actor of actors) {
      if (actor.attackId < 0) continue;
      if (actor.state !== 'attackActive') {
        if (actor.state !== 'attackWindup') this.endAttack(actor);
        continue;
      }
      const track = actor.currentTrack;
      if (!track) { this.endAttack(actor); continue; }

      actor.weaponTipWorld(this.tipB);
      actor.weaponMidWorld(this.midB);
      if (!actor.tipReady) {
        actor.prevTip.copy(this.tipB);
        actor.prevMid.copy(this.midB);
        actor.tipReady = true;
        continue;
      }
      this.tipA.copy(actor.prevTip);
      this.midA.copy(actor.prevMid);

      const p = actor.rawPosition;
      const facing = actor.facing;
      const cosArc = Math.cos((track.arcDeg * DEG) / 2);
      const maxReach = track.reach * 1.2;

      const consider = (hx: number, hy: number, hz: number) => {
        this.phys.overlapSphere(hx, hy, hz, COMBAT.hitRadius, MASK_ACTOR, (handle) => {
          const target = this.byCollider.get(handle);
          if (!target || target === actor || !target.alive) return true;
          if (!this.factionsHostile(actor.faction, target.faction)) return true;
          if (this.registry.hitsFor(actor.attackId) >= COMBAT.maxHitPerSwing * 4) return false;
          // dedupe first: one hit per target per swing
          if (!this.registry.tryRecord(actor.attackId, target.id)) return true;
          // reach + arc
          const tp = target.rawPosition;
          const dx = tp.x - p.x, dz = tp.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist > maxReach) return true;
          if (track.arcDeg < 350 && dist > 0.4) {
            const dot = (dx / dist) * facing.x + (dz / dist) * facing.z;
            if (dot < cosArc - 0.12) return true;
          }
          // Wall obstruction: a blow cannot pass through thick geometry. The test runs from the
          // swing's origin to the blade sample, not to the target's chest — a guardian standing
          // flush against a wall is still hit by a blade that is already touching it.
          const eyeY = p.y + 1.0;
          if (Math.hypot(hx - p.x, hz - p.z) > 0.6 && this.phys.lineBlocked(p.x, eyeY, p.z, hx, hy, hz, MASK_WORLD)) return true;

          const kind: DamageKind = actor.faction === 'player'
            ? (actor.lastAttackKind === 'heavy' ? 'heavy' : 'light')
            : (actor.kind === 'warden' ? 'boss' : 'enemy');

          const base = this.damageFor(actor, track);
          const request: DamageRequest = {
            attackId: actor.attackId, source: actor.id, target: target.id,
            kind, baseDamage: base, poiseDamage: track.poiseMul * (actor.faction === 'player' ? 26 : 18),
            dirX: facing.x, dirZ: facing.z, fromArea: false,
            hitX: hx, hitY: hy, hitZ: hz,
          };
          const result = resolveDamage(request, target.defenderInfo());
          target.applyDamage(result);
          this.reportHit(actor, target, result, hx, hy, hz);
          return true;
        });
      };

      // sweep both the blade tip and a mid-blade point: a fast swing must never skip a target,
      // and a target standing close can be caught by the shaft rather than the tip
      const steps = COMBAT.samplesPerSubstep;
      const sweeps: Array<[THREE.Vector3, THREE.Vector3]> = [[this.tipA, this.tipB], [this.midA, this.midB]];
      for (const [from, to] of sweeps) {
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          consider(
            from.x + (to.x - from.x) * t,
            from.y + (to.y - from.y) * t,
            from.z + (to.z - from.z) * t,
          );
        }
      }

      actor.prevTip.copy(this.tipB);
      actor.prevMid.copy(this.midB);
    }

    // ---- area attacks (boss slam / bell toll): the region is telegraphed before this fires
    for (let i = this.areas.length - 1; i >= 0; i--) {
      const area = this.areas[i];
      if (area.resolved) { this.areas.splice(i, 1); continue; }
      area.resolved = true;
      for (const target of this.byCollider.values()) {
        if (!target.alive) continue;
        if (!this.factionsHostile(area.source.faction, target.faction)) continue;
        if (!this.registry.tryRecord(area.attackId, target.id)) continue;
        const dx = target.rawPosition.x - area.x, dz = target.rawPosition.z - area.z;
        const dist = Math.hypot(dx, dz);
        if (dist > area.radius) continue;
        if (area.arcDeg < 350 && dist > 0.4) {
          const dot = (dx / dist) * area.facingX + (dz / dist) * area.facingZ;
          if (dot < Math.cos((area.arcDeg * DEG) / 2)) continue;
        }
        const request: DamageRequest = {
          attackId: area.attackId, source: area.source.id, target: target.id,
          kind: area.kind, baseDamage: area.damage, poiseDamage: area.poise,
          dirX: area.facingX || dx / (dist || 1), dirZ: area.facingZ || dz / (dist || 1),
          fromArea: true, hitX: target.rawPosition.x, hitY: target.rawPosition.y + 0.8, hitZ: target.rawPosition.z,
        };
        const result = resolveDamage(request, target.defenderInfo());
        target.applyDamage(result);
        this.reportHit(area.source, target, result, request.hitX, request.hitY, request.hitZ);
      }
      this.registry.endAttack(area.attackId);
    }
  }

  private damageFor(actor: Actor, track: AttackTrack): number {
    if (actor.faction === 'player') {
      const pl = actor as unknown as { weaponDamage?: number };
      return (pl.weaponDamage ?? 18) * track.damageMul;
    }
    return 16 * track.damageMul * (actor.kind === 'warden' ? 1.35 : 1);
  }

  private factionsHostile(a: string, b: string): boolean {
    if (a === b) return false;
    if (a === 'player') return b === 'enemy';
    if (a === 'enemy') return b === 'player';
    return false;
  }

  private reportHit(attacker: Actor, target: Actor, result: import('../core/Types').DamageResult, x: number, y: number, z: number): void {
    const p = target.rawPosition;
    if (result.damage > 0) {
      this.hitStop(result.hitStop);
      this.events.emit('hit', {
        result, attacker: attacker.kind, target: target.kind,
        x, y, z, normalX: attacker.facing.x, normalY: 0.4, normalZ: attacker.facing.z,
      });
      if (result.staggered) this.events.emit('stagger', { x: p.x, y: p.y, z: p.z });
      if (result.killed) this.events.emit('death', { x: p.x, y: p.y, z: p.z, kind: target.kind, faction: target.faction });
    } else if (result.blocked) {
      this.events.emit('guardImpact', { x, y, z, blocked: true, broken: result.guardBroken, faction: target.faction });
      if (result.guardBroken) this.events.emit('stagger', { x: p.x, y: p.y, z: p.z });
    }
  }

  get hitStopActive(): boolean { return this.hitStopTimer > 0; }

  endFrame(dt: number): void {
    if (this.hitStopTimer > 0) this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
  }

  clear(): void {
    this.registry.clear();
    this.areas.length = 0;
  }

  get registryRef(): HitRegistry { return this.registry; }
  clampValue(v: number): number { return clamp(v, 0, 1); }
  actorIdOf(handle: number): ActorId | null { return this.byCollider.get(handle)?.id ?? null; }
  tmpVector(): THREE.Vector3 { return this.tmp; }
}
