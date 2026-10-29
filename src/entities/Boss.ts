/**
 * The Bellbound Warden — a two-phase boss.
 *
 * Phase one: horizontal sweep, two-hit combo with a readable pause, overhead slam with a
 * telegraphed impact region, and a long-range lunge.
 * Phase two (at half health): a readable transition, an ember-lit visual change, a new
 * bell-toll ring attack and shorter windups. Damage is NOT doubled; pressure comes from
 * cooldowns and the extra tool, so punish windows stay fair.
 */
import * as THREE from 'three';
import { Enemy, type CombatGroup, type EnemyInit } from './Enemy';
import type { Player } from './Player';
import type { PhysicsWorld } from '../physics/Physics';
import type { NavigationGraph } from '../world/Navigation';
import type { EventBus } from '../core/Events';
import type { CombatSystem } from '../combat/Combat';
import { BOSS, type AttackTrack } from '../config/Balance';
import type { CharacterBody } from '../physics/Physics';
import type { Rig } from '../render/HumanoidRig';
import { clamp } from '../core/MathX';

export interface Telegraph {
  kind: 'slam' | 'toll' | 'ring';
  x: number; z: number;
  radius: number;
  t: number;
  duration: number;
  active: boolean;
}

export class Boss extends Enemy {
  public phase: 1 | 2 = 1;
  public inTransition = false;
  public transitionTimer = 0;
  public telegraph: Telegraph | null = null;
  public defeated = false;
  public introTimer = 0;
  public introActive = false;
  private pendingCombo: string | null = null;
  private comboPause = 0;
  private forcedMove: string | null = null;
  private tracks: Record<string, AttackTrack>;
  public arenaCenter = new THREE.Vector2(0, -46);
  public arenaHalf = 14.2;
  public victoryTimer = 0;
  public dying = false;

  constructor(phys: PhysicsWorld, body: CharacterBody, rig: Rig, init: EnemyInit) {
    super(phys, body, rig, init);
    this.tracks = { ...init.def.attacks };
    this.home.set(init.home[0], init.y, init.home[1]);
  }

  resetBoss(x: number, y: number, z: number, yaw: number): void {
    this.phase = 1;
    this.inTransition = false;
    this.transitionTimer = 0;
    this.telegraph = null;
    this.defeated = false;
    this.dying = false;
    this.pendingCombo = null;
    this.comboPause = 0;
    this.forcedMove = null;
    this.phaseCooldownMul = 1;
    this.victoryTimer = 0;
    this.introActive = false;
    this.resetFromWorld(yaw);
    this.teleport(x, y, z, yaw);
  }

  beginIntro(): void {
    this.introActive = true;
    this.introTimer = 0;
    this.setState('transition');
    this.ai = 'alert';
  }

  private phaseTracks(): Record<string, AttackTrack> {
    if (this.phase === 1) return this.tracks;
    const out: Record<string, AttackTrack> = {};
    for (const [k, t] of Object.entries(this.tracks)) {
      out[k] = { ...t, windup: t.windup * 0.86, recovery: t.recovery * 0.94 };
    }
    return out;
  }

  override update(
    dt: number,
    player: Player,
    phys: PhysicsWorld,
    nav: NavigationGraph,
    events: EventBus,
    combat: CombatSystem,
    group: CombatGroup,
    arenaLocked: boolean,
  ): void {
    if (this.dying) {
      this.victoryTimer += dt;
      this.setState('dead');
      this.tickTimers(dt);
      return;
    }

    if (this.introActive) {
      this.introTimer += dt;
      this.actionTime += dt;
      this.stateTime += dt;
      this.setState(this.introTimer < 1.6 ? 'transition' : 'idle');
      if (this.introTimer >= 2.4) this.introActive = false;
      return;
    }

    if (this.inTransition) {
      this.transitionTimer += dt;
      this.actionTime += dt;
      this.stateTime += dt;
      this.setState('transition');
      const dur = BOSS.transitionDuration;
      if (this.transitionTimer >= dur * 0.55 && !this.telegraph) {
        const p = this.rawPosition;
        this.telegraph = { kind: 'ring', x: p.x, z: p.z, radius: 7.4, t: 0, duration: dur * 0.45, active: true };
      }
      if (this.telegraph) {
        this.telegraph.t += dt;
        if (this.telegraph.t >= this.telegraph.duration) {
          const p = this.rawPosition;
          combat.registerArea({
            x: p.x, y: p.y, z: p.z, radius: this.telegraph.radius, arcDeg: 360,
            facingX: 0, facingZ: 0, damage: 22, poise: 1.6,
            attackId: combat.beginAttack(this, this.phaseTracks().toll ?? this.phaseTracks().slam),
            source: this, kind: 'area', resolved: false,
          });
          this.telegraph = null;
          events.emit('bossPhase', { phase: 2 });
        }
      }
      if (this.transitionTimer >= dur) {
        this.inTransition = false;
        this.setState('idle');
        this.ai = 'pursue';
        this.attackCooldown = 0.5;
      }
      return;
    }

    // phase change trigger
    if (this.phase === 1 && this.alive && this.healthFraction <= BOSS.phaseTwoFraction) {
      this.phase = 2;
      this.inTransition = true;
      this.transitionTimer = 0;
      this.actionTime = 0;
      this.currentTrack = null;
      this.combat?.endAttack(this);
      this.phaseCooldownMul = BOSS.phaseTwoCooldownMul;
      this.releaseGroupPublic();
      events.emit('bossPhase', { phase: 2 });
    }

    // combo follow-through with a readable pause
    if (this.comboPause > 0 && this.state === 'idle') {
      this.comboPause -= dt;
      if (this.comboPause <= 0 && this.pendingCombo) {
        const p = this.rawPosition, t = player.rawPosition;
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        const key = this.pendingCombo;
        this.pendingCombo = null;
        if (d < this.def.attackRange * 1.25) {
          this.forcedMove = key;
          if (!this.acquireGroupPublic(group)) this.forcedMove = null;
          else { this.startAttack(player, events); return; }
        }
      }
    }

    super.update(dt, player, phys, nav, events, combat, group, arenaLocked);

    // keep the boss inside the arena
    const p = this.rawPosition;
    const dx = clamp(p.x, -this.arenaHalf + 1, this.arenaHalf - 1);
    const dz = clamp(p.z, this.arenaCenter.y - this.arenaHalf + 1, this.arenaCenter.y + this.arenaHalf - 1);
    if (Math.abs(dx - p.x) > 0.01 || Math.abs(dz - p.z) > 0.01) {
      this.teleport(dx, p.y, dz, this.yaw);
    }
  }

  releaseGroupPublic(): void { this.releaseGroup(); }
  acquireGroupPublic(g: CombatGroup): boolean { return this.acquireGroup(g); }

  protected override startAttack(player: Player, events: EventBus): void {
    const p = this.rawPosition, t = player.rawPosition;
    const dist = Math.hypot(t.x - p.x, t.z - p.z);
    const tracks = this.phaseTracks();
    let key: string;
    if (this.forcedMove) {
      key = this.forcedMove;
      this.forcedMove = null;
    } else if (dist > 7.2 && tracks.lunge) {
      key = 'lunge';
    } else {
      const pool: string[] = ['sweep', 'combo', 'slam'];
      if (this.phase === 2) pool.push('toll', 'combo');
      if (dist > 4.6) pool.push('lunge');
      key = pool[Math.floor(Math.random() * pool.length)];
    }

    if (key === 'combo') {
      this.beginMove('combo1', tracks.combo1, player, events);
      this.pendingCombo = 'combo2';
      this.comboPause = 0.5;
      return;
    }
    this.beginMove(key, tracks[key], player, events);
  }

  private beginMove(key: string, track: AttackTrack | undefined, player: Player, events: EventBus): void {
    if (!track) return;
    this.currentTrack = track;
    this.attackName = key;
    this.lastAttackKind = 'boss';
    this.actionTime = 0;
    this.setState('attackWindup');
    this.ai = 'attack';
    this.tipReady = false;
    this.events = events;
    this.combat?.beginAttack(this, track);
    const p = this.rawPosition;
    this.events?.emit('attackSwing', { x: p.x, y: p.y + 1.6, z: p.z, power: key === 'slam' || key === 'toll' ? 1.6 : 1.1, faction: 'boss' });
    if (key === 'slam' || key === 'toll') {
      this.telegraph = {
        kind: key, x: p.x, z: p.z,
        radius: key === 'toll' ? BOSS.tollRingRadius : BOSS.slamRadius,
        t: 0, duration: Math.max(0.2, track.windup - BOSS.slamTelegraphLead), active: true,
      };
    } else {
      this.telegraph = null;
    }
    void player;
  }

  protected override advanceAttack(dt: number, combat: CombatSystem, events: EventBus): void {
    const t = this.currentTrack;
    if (!t) { this.setState('idle'); this.ai = 'recover'; return; }
    const w = t.windup, a = t.active, r = t.recovery;
    const areaMove = this.attackName === 'slam' || this.attackName === 'toll';

    if (this.telegraph && this.telegraph.kind !== 'ring') {
      this.telegraph.t += dt;
      const p = this.rawPosition;
      this.telegraph.x = p.x; this.telegraph.z = p.z;
    }

    if (this.actionTime < w) {
      this.setState('attackWindup');
      const f = this.facing;
      this.integrate(dt, f.x * t.lungeSpeed * 0.25, f.z * t.lungeSpeed * 0.25, this.phys);
    } else if (this.actionTime < w + a) {
      if (this.state !== 'attackActive') {
        this.setState('attackActive');
        if (areaMove) {
          const p = this.rawPosition;
          combat.registerArea({
            x: p.x, y: p.y, z: p.z,
            radius: this.attackName === 'toll' ? BOSS.tollRingRadius : BOSS.slamRadius,
            arcDeg: 360, facingX: 0, facingZ: 0,
            damage: 30 * t.damageMul, poise: t.poiseMul,
            attackId: this.attackId, source: this, kind: 'area', resolved: false,
          });
          this.telegraph = null;
        }
      }
      const f = this.facing;
      this.integrate(dt, f.x * t.lungeSpeed, f.z * t.lungeSpeed, this.phys);
    } else if (this.actionTime < w + a + r) {
      this.setState('attackRecovery');
      this.integrate(dt, 0, 0, this.phys);
    } else {
      if (!areaMove) combat.endAttack(this);
      else combat.endAttack(this);
      this.currentTrack = null;
      this.attackCooldown = this.def.attackCooldown * this.phaseCooldownMul;
      this.releaseGroup();
      this.setState('idle');
      this.ai = 'recover';
    }
    void events;
  }

  /** Called when health reaches zero: the boss staggers to a stop rather than ragdolling. */
  /** The Warden never just collapses: death is a scripted sequence that ends the fight. */
  override kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.startDeath();
  }

  startDeath(): void {
    if (this.dying) return;
    this.dying = true;
    this.defeated = true;
    this.alive = false;
    this.setState('dead');
    this.actionTime = 0;
    this.combat?.endAttack(this);
    this.releaseGroup();
  }

  override applyDamage(result: import('../core/Types').DamageResult): void {
    if (this.dying) return;
    super.applyDamage(result);
    if (this.health <= 0) this.startDeath();
  }
}
