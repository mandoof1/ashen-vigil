/**
 * Enemy AI: explicit states, honest perception (range + FOV + line of sight), waypoint
 * navigation, leash + home behaviour, stuck recovery, and group coordination so a pack
 * never attacks all at once. Enemies use the same attack-window and hit-dedup rules as
 * the player: no privileged knowledge, no free damage.
 */
import * as THREE from 'three';
import { Actor, type ActorInit } from './Actor';
import type { CharacterBody, PhysicsWorld } from '../physics/Physics';
import type { Rig } from '../render/HumanoidRig';
import type { EnemyDef } from '../config/Balance';
import { DODGE } from '../config/Balance';
import type { DamageResult } from '../core/Types';
import { angleDiff, clamp, norm2, wrapAngle } from '../core/MathX';
import type { NavigationGraph } from '../world/Navigation';
import type { EventBus } from '../core/Events';
import type { CombatSystem } from '../combat/Combat';
import type { Player } from './Player';

export type AIState = 'idle' | 'patrol' | 'alert' | 'pursue' | 'reposition' | 'attack' | 'recover' | 'stagger' | 'return' | 'dead';

export interface CombatGroup {
  active: number;
  maxActive: number;
}

export interface EnemyInit extends ActorInit {
  def: EnemyDef;
  home: [number, number];
  patrol?: Array<[number, number]>;
  tag?: string;
}

const GRAVITY = -24;
const MAX_FALL = -30;

export class Enemy extends Actor {
  public def: EnemyDef;
  public ai: AIState = 'idle';
  public home = new THREE.Vector3();
  public patrol: Array<[number, number]>;
  public patrolIndex = 0;
  public target: Player | null = null;
  public lastSeen = new THREE.Vector3();
  public alerted = false;
  public shieldPoise: number;
  public maxShieldPoise: number;
  public shieldActive: boolean;
  public aggroRadiusBoost = 0;
  public velX = 0;
  public velZ = 0;
  public override grounded = false;
  public emberDrop: number;
  private path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private thinkTimer = 0;
  protected attackCooldown = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private stuckTimer = 0;
  private stuckAnchor = new THREE.Vector3();
  private sidestepTimer = 0;
  private sidestepDir = 0;
  private groupToken = false;
  public ambushAnnounced = false;
  public deathTime = 0;

  constructor(phys: PhysicsWorld, body: CharacterBody, rig: Rig, init: EnemyInit) {
    super(init.id, init.kind, 'enemy', phys, body, rig, init);
    this.def = init.def;
    this.home.set(init.home[0], init.y, init.home[1]);
    this.patrol = init.patrol ?? [];
    this.maxShieldPoise = init.def.shieldedFront ? 46 : 0;
    this.shieldPoise = this.maxShieldPoise;
    this.shieldActive = !!init.def.shieldedFront;
    this.shieldedFront = this.shieldActive;
    this.emberDrop = init.def.emberDrop;
    this.stuckAnchor.set(init.x, init.y, init.z);
  }

  get distanceToHome(): number {
    const p = this.rawPosition;
    return Math.hypot(p.x - this.home.x, p.z - this.home.z);
  }

  resetFromWorld(homeYaw: number): void {
    this.alive = true;
    this.health = this.maxHealth;
    this.poise = this.maxPoise;
    this.poiseDecay = 0;
    this.shieldPoise = this.maxShieldPoise;
    this.shieldActive = this.maxShieldPoise > 0;
    this.shieldedFront = this.shieldActive;
    this.ai = 'idle';
    this.setState('idle');
    this.target = null;
    this.alerted = false;
    this.attackId = -1;
    this.currentTrack = null;
    this.invulnTimer = 0;
    this.deathTime = 0;
    this.path.length = 0;
    this.pathIndex = 0;
    this.attackCooldown = 0;
    this.velX = 0; this.velZ = 0; this.vy = 0;
    this.groupToken = false;
    this.ambushAnnounced = false;
    this.teleport(this.home.x, this.home.y, this.home.z, homeYaw);
  }

  override applyDamage(result: DamageResult): void {
    const wasShielded = result.blocked && result.damage <= 0;
    super.applyDamage(result);
    if (wasShielded && this.shieldActive) {
      this.shieldPoise -= 15;
      if (this.shieldPoise <= 0) {
        this.shieldActive = false;
        this.shieldedFront = false;
        this.shieldBreakTimer = 5.5;
        this.currentTrack = null;
        this.setState('stagger');
        this.ai = 'stagger';
        this.releaseGroup();
        this.events?.emit('stagger', { x: this.rawPosition.x, y: this.rawPosition.y, z: this.rawPosition.z });
      }
    }
    if (result.staggered && this.alive) {
      this.currentTrack = null;
      this.setState('stagger');
      this.ai = 'stagger';
      this.releaseGroup();
    }
    if (!this.alive) { this.ai = 'dead'; this.releaseGroup(); }
    // being hit while idle/patrol pulls aggro
    if (this.alive && !this.target && result.damage > 0) this.aggro(null);
  }

  public events: EventBus | null = null;

  private aggro(player: Player | null): void {
    this.target = player ?? this.target;
    this.alerted = true;
    if (this.ai === 'idle' || this.ai === 'patrol' || this.ai === 'return') {
      this.ai = 'alert';
      this.setState('idle');
    }
  }

  protected acquireGroup(group: CombatGroup): boolean {
    if (this.groupToken) return true;
    if (group.active >= Math.min(group.maxActive, this.def.maxActiveAttackers)) return false;
    group.active++;
    this.groupToken = true;
    return true;
  }

  protected releaseGroup(): void {
    if (this.groupToken && this.group) { this.group.active--; this.groupToken = false; }
  }

  private group: CombatGroup | null = null;

  // -------------------------------------------------------------- perception
  protected canSee(player: Player, phys: PhysicsWorld): boolean {
    const p = this.rawPosition;
    const t = player.rawPosition;
    const dx = t.x - p.x, dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    const range = this.def.detectRange + this.aggroRadiusBoost;
    if (dist > range) return false;
    if (dist < 3.2) return true; // close enough to feel presence
    const f = this.facing;
    const dot = (dx / (dist || 1)) * f.x + (dz / (dist || 1)) * f.z;
    const cosHalf = Math.cos((this.def.detectFovDeg * Math.PI) / 360);
    if (dot < cosHalf) return false;
    return !phys.lineBlocked(p.x, p.y + 1.4, p.z, t.x, t.y + 1.2, t.z);
  }

  // ---------------------------------------------------------------- update
  update(
    dt: number,
    player: Player,
    phys: PhysicsWorld,
    nav: NavigationGraph,
    events: EventBus,
    combat: CombatSystem,
    group: CombatGroup,
    arenaLocked: boolean,
  ): void {
    this.events = events;
    this.group = group;
    this.tickTimers(dt);

    if (!this.alive) {
      this.ai = 'dead';
      this.deathTime += dt;
      this.setState('dead');
      this.integrate(dt, 0, 0, phys);
      return;
    }

    if (this.shieldBreakTimer > 0) {
      this.shieldBreakTimer -= dt;
      if (this.shieldBreakTimer <= 0 && this.maxShieldPoise > 0) {
        this.shieldActive = true;
        this.shieldedFront = true;
        this.shieldPoise = this.maxShieldPoise;
      }
    }

    this.thinkTimer -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // ---- committed actions advance on their own timers
    if (this.state === 'attackWindup' || this.state === 'attackActive' || this.state === 'attackRecovery') {
      this.advanceAttack(dt, combat, events);
      this.integrate(dt, 0, 0, phys);
      return;
    }
    if (this.state === 'stagger') {
      if (this.stateTime >= this.def.staggerRecover) {
        this.setState('idle');
        this.ai = this.target ? 'pursue' : 'return';
      }
      this.integrate(dt, 0, 0, phys);
      return;
    }

    // ---- perception (throttled)
    let see = false;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.12 + Math.random() * 0.08;
      see = player.alive && this.canSee(player, phys);
      if (see) {
        const t = player.rawPosition;
        this.lastSeen.set(t.x, t.y, t.z);
        if (!this.target) this.aggro(player);
        this.target = player;
      }
    }

    if (!this.target) {
      // idle / patrol / return home
      this.runDefault(dt, phys, nav, events, arenaLocked);
      return;
    }

    const p = this.rawPosition;
    const t = this.target.rawPosition;
    const dx = t.x - p.x, dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = norm2(dx, dz);

    // leash: a pulled enemy gives up and walks home
    if (!arenaLocked && this.distanceToHome > this.def.leashRange) {
      this.target = null;
      this.alerted = false;
      this.ai = 'return';
      this.path.length = 0;
      this.runDefault(dt, phys, nav, events, arenaLocked);
      return;
    }

    if (see) this.aggro(this.target);

    // ---- attack decision
    const inRange = dist <= this.def.attackRange;
    const facingOk = Math.abs(angleDiff(this.yaw, Math.atan2(-toPlayer.x, -toPlayer.z))) < 0.5;
    if (inRange && facingOk && this.attackCooldown <= 0 && this.acquireGroup(group)) {
      this.startAttack(player, events);
      this.integrate(dt, 0, 0, phys);
      return;
    }

    // ---- reposition / pursue
    if (dist < this.def.behaviour.preferredDistance * 0.72) {
      this.ai = 'reposition';
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 0.9 + Math.random() * 1.1;
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const back = Math.random() < this.def.behaviour.backstepChance * dt * 8 ? 1 : 0;
      const wishX = toPlayer.z * this.strafeDir - toPlayer.x * back;
      const wishZ = -toPlayer.x * this.strafeDir - toPlayer.z * back;
      this.faceToward(toPlayer.x, toPlayer.z, dt);
      this.integrate(dt, wishX * this.def.walkSpeed * 0.75, wishZ * this.def.walkSpeed * 0.75, phys);
      this.setState(this.speedNow() > 0.3 ? 'walk' : 'idle');
      return;
    }

    this.ai = 'pursue';
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.path.length === 0) {
      this.repathTimer = 0.55 + Math.random() * 0.35;
      nav.findPath(this.position, this.target.position, this.path);
      this.pathIndex = 0;
    }
    let goal = this.path[this.pathIndex];
    if (goal) {
      const gdx = goal.x - p.x, gdz = goal.z - p.z;
      if (Math.hypot(gdx, gdz) < 1.1) this.pathIndex++;
      goal = this.path[this.pathIndex] ?? new THREE.Vector3(t.x, t.y, t.z);
    } else {
      goal = new THREE.Vector3(t.x, t.y, t.z);
    }
    const gx = goal.x - p.x, gz = goal.z - p.z;
    const gn = norm2(gx, gz);
    const speed = dist > this.def.attackRange * 1.4 ? this.def.runSpeed : this.def.walkSpeed;
    this.faceToward(gn.x, gn.z, dt, 0.6);
    this.integrate(dt, gn.x * speed, gn.z * speed, phys);
    this.setState(this.speedNow() > 0.4 ? 'run' : 'idle');

    // stuck recovery
    const moved = Math.hypot(p.x - this.stuckAnchor.x, p.z - this.stuckAnchor.z);
    this.stuckTimer += dt;
    if (this.stuckTimer > 1.2) {
      if (moved < 0.35) {
        this.sidestepTimer = 0.7;
        this.sidestepDir = Math.random() < 0.5 ? -1 : 1;
        this.path.length = 0;
        this.repathTimer = 0.1;
      }
      this.stuckTimer = 0;
      this.stuckAnchor.set(p.x, p.y, p.z);
    }
    if (this.sidestepTimer > 0) {
      this.sidestepTimer -= dt;
      const sx = -gn.z * this.sidestepDir, sz = gn.x * this.sidestepDir;
      this.integrate(dt, sx * this.def.walkSpeed, sz * this.def.walkSpeed, phys);
    }
  }

  protected speedNow(): number { return Math.hypot(this.velX, this.velZ); }

  protected runDefault(dt: number, phys: PhysicsWorld, nav: NavigationGraph, events: EventBus, arenaLocked: boolean): void {
    if (arenaLocked) { this.ai = 'idle'; this.setState('idle'); this.integrate(dt, 0, 0, phys); return; }
    if (this.patrol.length > 0) {
      this.ai = 'patrol';
      const [hx, hz] = this.patrol[this.patrolIndex];
      const p = this.rawPosition;
      const dx = hx - p.x, dz = hz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8) this.patrolIndex = (this.patrolIndex + 1) % this.patrol.length;
      const n = norm2(dx, dz);
      this.faceToward(n.x, n.z, dt, 0.5);
      this.integrate(dt, n.x * this.def.walkSpeed * 0.6, n.z * this.def.walkSpeed * 0.6, phys);
      this.setState(this.speedNow() > 0.25 ? 'walk' : 'idle');
      return;
    }
    if (this.ai === 'return') {
      const p = this.rawPosition;
      const dx = this.home.x - p.x, dz = this.home.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) { this.ai = 'idle'; this.setState('idle'); this.integrate(dt, 0, 0, phys); return; }
      const n = norm2(dx, dz);
      this.faceToward(n.x, n.z, dt, 0.5);
      this.integrate(dt, n.x * this.def.runSpeed * 0.8, n.z * this.def.runSpeed * 0.8, phys);
      this.setState('run');
      return;
    }
    this.ai = 'idle';
    this.faceToward(-Math.sin(this.yaw), -Math.cos(this.yaw), dt, 0.15);
    this.integrate(dt, 0, 0, phys);
    this.setState('idle');
    void nav; void events;
  }

  protected faceToward(dirX: number, dirZ: number, dt: number, scale = 1): void {
    if (Math.abs(dirX) < 1e-4 && Math.abs(dirZ) < 1e-4) return;
    const want = Math.atan2(-dirX, -dirZ);
    const diff = angleDiff(this.yaw, want);
    const maxTurn = this.def.turnSpeed * scale * dt;
    this.yaw = wrapAngle(this.yaw + clamp(diff, -maxTurn, maxTurn));
  }

  // ---------------------------------------------------------------- attacks
  protected startAttack(player: Player, events: EventBus): void {
    void player;
    const keys = Object.keys(this.def.attacks);
    if (keys.length === 0) return;
    let key = keys[0];
    if (keys.length > 1) {
      const vary = Math.random() < this.def.behaviour.variationChance;
      key = vary ? keys[1] : keys[0];
    }
    const track = this.def.attacks[key];
    this.currentTrack = track;
    this.attackName = key;
    this.lastAttackKind = 'enemy';
    this.actionTime = 0;
    this.setState('attackWindup');
    this.ai = 'attack';
    this.pendingAttackKey = key;
    this.tipReady = false;
    this.events = events;
    this.combat?.beginAttack(this, track);
    const p = this.rawPosition;
    this.events?.emit('attackSwing', { x: p.x, y: p.y + 1.2, z: p.z, power: key === 'overhead' || key === 'slam' ? 1.4 : 1, faction: 'enemy' });
  }

  public attackName = '';
  public combat: CombatSystem | null = null;
  protected pendingAttackKey = '';

  protected advanceAttack(dt: number, combat: CombatSystem, events: EventBus): void {
    const t = this.currentTrack;
    if (!t) { this.setState('idle'); this.ai = 'recover'; return; }
    const w = t.windup, a = t.active, r = t.recovery;
    if (this.actionTime < w) {
      this.setState('attackWindup');
      // small committed forward drift so range reads honestly
      const f = this.facing;
      this.integrate(dt, f.x * t.lungeSpeed * 0.3, f.z * t.lungeSpeed * 0.3, this.phys);
    } else if (this.actionTime < w + a) {
      if (this.state !== 'attackActive') {
        this.setState('attackActive');
      }
      const f = this.facing;
      this.integrate(dt, f.x * t.lungeSpeed, f.z * t.lungeSpeed, this.phys);
    } else if (this.actionTime < w + a + r) {
      this.setState('attackRecovery');
      this.integrate(dt, 0, 0, this.phys);
    } else {
      combat.endAttack(this);
      this.currentTrack = null;
      this.attackCooldown = this.def.attackCooldown * (this.phaseCooldownMul ?? 1);
      this.releaseGroup();
      this.setState('idle');
      this.ai = 'recover';
      void events;
    }
  }

  public phaseCooldownMul = 1;

  // -------------------------------------------------------------- movement
  protected integrate(dt: number, wishX: number, wishZ: number, phys: PhysicsWorld): void {
    const accel = 16;
    const dvx = wishX - this.velX, dvz = wishZ - this.velZ;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 1e-5) {
      const k = Math.min(1, accel * dt / dl);
      this.velX += dvx * k;
      this.velZ += dvz * k;
    }
    this.vy = Math.max(MAX_FALL, this.vy + GRAVITY * dt);
    const edx = this.velX * dt, edz = this.velZ * dt;
    const res = phys.moveCharacter(this.body, edx, this.slopeFollow(edx, this.vy * dt, edz), edz);
    this.rememberSlope(res);
    this.grounded = res.grounded;
    if (res.grounded) {
      if (this.vy < 0) this.vy = 0;
      const p = this.rawPosition;
      if (p.y > this.home.y - 0.2) this.lastSafe.set(p.x, p.y, p.z);
    } else if (res.dy > 0.001) this.vy = 0;
    this.velX = res.dx / dt;
    this.velZ = res.dz / dt;
  }

  /** Area attacks that the boss telegraphs; enemies never use them. */
  get dodgeWindow(): number { return DODGE.invulnEnd - DODGE.invulnStart; }
}
