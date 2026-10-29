/**
 * The player: deliberate melee combat with explicit states and centralised
 * cancellation rules. All costs go through StaminaPool, so nothing can go negative
 * and no input-mashing can bypass a cost.
 */
import * as THREE from 'three';
import { Actor, type ActorInit } from '../entities/Actor';
import type { PhysicsWorld, CharacterBody } from '../physics/Physics';
import type { Rig } from '../render/HumanoidRig';
import { StaminaPool } from '../core/Stamina';
import { COMBAT, DODGE, PLAYER, STAMINA } from '../config/Balance';
import type { DamageResult, UpgradeLevels } from '../core/Types';import { InputState } from '../input/Input';
import { angleDiff, clamp, norm2, wrapAngle } from '../core/MathX';
import type { EventBus } from '../core/Events';
import type { CombatSystem } from '../combat/Combat';
import { statValue } from '../core/Progression';

export interface PlayerStats {
  maxHealth: number;
  maxStamina: number;
  damage: number;
  maxFlasks: number;
}

export interface PlayerInit extends ActorInit {
  upgrades: UpgradeLevels;
  embers: number;
  maxFlasks: number;
}

export type AttackKind = 'light' | 'heavy';

interface BufferedInput { kind: AttackKind | 'dodge' | 'heal'; age: number }

export class Player extends Actor {
  public stamina: StaminaPool;
  public maxFlasks: number;
  public flasks: number;
  public weaponDamage: number;
  public embers = 0;
  public upgrades: UpgradeLevels;
  public comboIndex = 0;
  public comboTimer = 0;
  public guardBroken = false;
  public dodgeDir = new THREE.Vector3();
  public speed = 0;
  public turnRate = 0;
  public lockedTargetId = -1;
  private buffered: BufferedInput | null = null;
  public justDied = false;
  public interactLock = false;
  public sprinting = false;
  public movedSinceCheckpoint = false;

  constructor(phys: PhysicsWorld, body: CharacterBody, rig: Rig, init: PlayerInit) {
    super(init.id, init.kind, 'player', phys, body, rig, init);
    this.upgrades = init.upgrades;
    this.embers = init.embers;
    this.maxHealth = statValue('health', init.upgrades.health);
    this.health = this.maxHealth;
    this.maxFlasks = init.maxFlasks;
    this.flasks = this.maxFlasks;
    this.weaponDamage = statValue('damage', init.upgrades.damage);
    this.stamina = new StaminaPool(statValue('stamina', init.upgrades.stamina));
    this.shieldedFront = false;
  }

  get stats(): PlayerStats {
    return {
      maxHealth: this.maxHealth,
      maxStamina: this.stamina.max,
      damage: this.weaponDamage,
      maxFlasks: this.maxFlasks,
    };
  }

  applyUpgrades(upgrades: UpgradeLevels): void {
    this.upgrades = upgrades;
    this.maxHealth = statValue('health', upgrades.health);
    this.health = this.maxHealth;
    this.weaponDamage = statValue('damage', upgrades.damage);
    this.stamina.setMax(statValue('stamina', upgrades.stamina));
    this.stamina.restore();
  }

  protected override staminaCurrent(): number { return this.stamina.current; }
  public override maxStamina(): number { return this.stamina.max; }

  // ------------------------------------------------------------ state rules
  private get busyState(): boolean {
    return this.state === 'attackWindup' || this.state === 'attackActive' || this.state === 'attackRecovery'
      || this.state === 'dodge' || this.state === 'heal' || this.state === 'stagger'
      || this.state === 'guardBreak' || this.state === 'dead' || this.state === 'interact' || this.state === 'transition';
  }

  /**
   * Cancellation rules for attacks. A swing that is still winding up cannot be restarted by
   * mashing the same button (that would make the windup indefinite); a follow-up is only
   * accepted from the active/recovery phase, or from the input buffer when the swing ends.
   */
  private canAttack(): boolean {
    if (this.state === 'dead' || this.state === 'stagger' || this.state === 'guardBreak' || this.state === 'heal'
      || this.state === 'interact' || this.state === 'dodge' || this.state === 'transition') return false;
    if (this.state === 'attackWindup') return false;
    if (this.state === 'attackActive') {
      const t = this.currentTrack;
      if (!t || this.lastAttackKind !== 'light' || this.comboIndex >= 2) return false;
      return this.actionTime >= t.windup + t.active * 0.5;
    }
    return true;
  }

  private canDodge(): boolean {
    if (this.state === 'dead' || this.state === 'stagger' || this.state === 'guardBreak' || this.state === 'dodge'
      || this.state === 'interact' || this.state === 'transition') return false;
    if (this.state === 'heal') return this.actionTime < PLAYER.flaskCancelWindow;
    if (this.state === 'attackWindup' || this.state === 'attackActive' || this.state === 'attackRecovery') {
      const t = this.currentTrack;
      if (!t) return true;
      return this.actionTime <= t.cancelIntoDodge || t.cancelIntoDodge > 10;
    }
    return true;
  }

  private canHeal(): boolean {
    return !this.busyState && this.alive && this.flasks > 0 && this.health < this.maxHealth;
  }

  private buffer(kind: AttackKind | 'dodge' | 'heal'): void {
    this.buffered = { kind, age: 0 };
  }

  private clearBuffer(): void { this.buffered = null; }

  // -------------------------------------------------------------- attacks
  beginAttack(kind: AttackKind, index: number): boolean {
    const track = kind === 'heavy' ? COMBAT.heavy : COMBAT.lightChain[Math.min(2, index)];
    if (!this.stamina.spend(track.staminaCost)) {
      this.events?.emit('ui', { message: 'Not enough stamina', kind: 'bad' });
      return false;
    }
    this.currentTrack = track;
    this.lastAttackKind = kind;
    this.attackIndex = kind === 'heavy' ? 3 : index;
    this.comboIndex = kind === 'heavy' ? 0 : index;
    this.comboTimer = 0;
    this.actionTime = 0;
    this.setState('attackWindup');
    this.pendingAttackKind = kind;
    // the swing gets a unique instance id so hit de-duplication works per swing
    if (this.combat) this.attackId = this.combat.beginAttack(this, track);
    return true;
  }

  public events: EventBus | null = null;
  public combat: CombatSystem | null = null;
  public pendingAttackKind: AttackKind = 'light';

  private advanceAttackPhase(): void {
    const t = this.currentTrack;
    if (!t) { this.setState('idle'); return; }
    const w = t.windup, a = t.active, r = t.recovery;
    if (this.actionTime < w) this.setState('attackWindup');
    else if (this.actionTime < w + a) this.setState('attackActive');
    else if (this.actionTime < w + a + r) this.setState('attackRecovery');
    else {
      this.currentTrack = null;
      this.comboTimer = COMBAT.comboWindowAfterRecovery;
      // buffered follow-up
      if (this.buffered && this.buffered.age < COMBAT.comboInputBuffer) {
        const b = this.buffered;
        this.clearBuffer();
        if (b.kind === 'light') this.beginAttack('light', Math.min(2, this.comboIndex + 1));
        else if (b.kind === 'heavy') this.beginAttack('heavy', 0);
        else if (b.kind === 'dodge') this.beginDodge();
        else if (b.kind === 'heal') this.beginHeal();
        return;
      }
      this.setState('idle');
    }
  }

  beginDodge(): boolean {
    if (!this.canDodge()) return false;
    if (!this.stamina.spend(DODGE.cost)) {
      this.events?.emit('ui', { message: 'Not enough stamina', kind: 'bad' });
      return false;
    }
    this.currentTrack = null;
    this.actionTime = 0;
    this.setState('dodge');
    this.events?.emit('dodge', { x: this.rawPosition.x, y: this.rawPosition.y, z: this.rawPosition.z });
    return true;
  }

  beginHeal(): boolean {
    if (!this.canHeal()) return false;
    // Charge is consumed at cast start (documented, consistent rule).
    this.flasks -= 1;
    this.currentTrack = null;
    this.actionTime = 0;
    this.setState('heal');
    return true;
  }

  finishHeal(): void {
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + PLAYER.flaskHeal);
    this.events?.emit('heal', { x: this.rawPosition.x, y: this.rawPosition.y, z: this.rawPosition.z, amount: this.health - before });
  }

  beginGuard(): void {
    if (this.busyState && this.state !== 'guard') return;
    if (this.stamina.current <= 0) return;
    this.setState('guard');
  }

  endGuard(): void {
    if (this.state === 'guard' || this.state === 'guardImpact') this.setState('idle');
  }

  onGuardBroken(): void {
    this.guardBroken = true;
    this.setState('guardBreak');
  }

  override applyDamage(result: DamageResult): void {
    super.applyDamage(result);
    if (result.chip > 0) this.stamina.drainFromBlock(result.chip);
    if (result.guardBroken) this.onGuardBroken();
    else if (result.damage > 0 && (this.state === 'guard' || this.state === 'guardImpact')) this.setState('guardImpact');
    if (result.staggered && this.alive && this.state !== 'guardBreak') {
      this.currentTrack = null;
      this.setState('stagger');
    }
    this.events?.emit('playerDamaged', { amount: result.damage, blocked: result.blocked });
  }

  // ---------------------------------------------------------------- update
  update(
    dt: number,
    input: InputState,
    camYaw: number,
    phys: PhysicsWorld,
    events: EventBus,
    lockDir: { x: number; z: number } | null,
  ): void {
    this.events = events;
    if (!this.alive) {
      this.setState('dead');
      this.integrateMovement(dt, input, camYaw, phys, true);
      this.tickTimers(dt);
      return;
    }

    // ---- edge input -> intent
    const wantLight = input.takeMouseButton(0);
    const wantHeavy = input.takeEdge('heavy');
    const wantDodge = input.takeEdge('dodge');
    const wantHeal = input.takeEdge('heal');
    const guardHeld = input.mouseHeld(2) || input.isHeld('guard');

    if (wantLight) this.buffer('light');
    else if (wantHeavy) this.buffer('heavy');
    if (wantDodge) this.buffer('dodge');
    if (wantHeal) this.buffer('heal');
    if (this.buffered) {
      this.buffered.age += dt;
      const window = this.buffered.kind === 'dodge' ? DODGE.bufferWindow : COMBAT.comboInputBuffer;
      if (this.buffered.age > window) this.clearBuffer();
    }

    // ---- state resolution
    if (this.state === 'attackWindup' || this.state === 'attackActive' || this.state === 'attackRecovery') {
      this.advanceAttackPhase();
    } else if (this.state === 'dodge') {
      if (this.actionTime >= DODGE.duration) {
        this.setState('idle');
        if (this.buffered && this.buffered.age < COMBAT.comboInputBuffer) {
          const b = this.buffered; this.clearBuffer();
          if (b.kind === 'light') this.beginAttack('light', 0);
          else if (b.kind === 'heavy') this.beginAttack('heavy', 0);
          else if (b.kind === 'heal') this.beginHeal();
        }
      }
    } else if (this.state === 'heal') {
      if (this.actionTime >= PLAYER.flaskCast) {
        this.finishHeal();
        this.setState('idle');
      }
    } else if (this.state === 'stagger') {
      if (this.stateTime >= PLAYER.staggerLock) this.setState('idle');
    } else if (this.state === 'guardBreak') {
      if (this.stateTime >= PLAYER.guardBreakLock) {
        this.guardBroken = false;
        this.stamina.set(this.stamina.max * 0.35);
        this.setState('idle');
      }
    } else if (this.state === 'interact') {
      if (this.stateTime >= 0.7) { this.interactLock = false; this.setState('idle'); }
    } else if (this.state === 'transition') {
      if (this.stateTime >= 1.2) this.setState('idle');
    } else if (guardHeld) {
      if (this.state !== 'guard' && this.state !== 'guardImpact') this.beginGuard();
      else if (this.state === 'guardImpact' && this.stateTime > 0.22) this.setState('guard');
    } else {
      if (this.state === 'guard' || this.state === 'guardImpact') this.endGuard();
    }

    // ---- fresh presses that are allowed right now
    if (this.buffered && this.buffered.age < 0.06) {
      const b = this.buffered;
      if (b.kind === 'light' && this.canAttack()) {
        this.clearBuffer();
        const next = this.comboTimer > 0 ? Math.min(2, this.comboIndex + 1) : 0;
        this.beginAttack('light', next);
      } else if (b.kind === 'heavy' && this.canAttack()) {
        this.clearBuffer();
        this.beginAttack('heavy', 0);
      } else if (b.kind === 'dodge' && this.canDodge()) {
        this.clearBuffer();
        this.beginDodge();
      } else if (b.kind === 'heal' && this.canHeal()) {
        this.clearBuffer();
        this.beginHeal();
      }
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboIndex = 0;
    }

    // ---- stamina
    const guarding = this.state === 'guard' || this.state === 'guardImpact';
    if (guarding) this.stamina.drain(STAMINA.guardHoldDrain * dt);
    this.stamina.tick(dt, { guarding, sprinting: this.sprinting, busy: this.busyState });
    if (this.stamina.current <= 0 && guarding) this.onGuardBroken();

    this.integrateMovement(dt, input, camYaw, phys, false, lockDir, guardHeld);
    this.tickTimers(dt);
  }

  private integrateMovement(dt: number, input: InputState, camYaw: number, phys: PhysicsWorld, dead: boolean, lockDir?: { x: number; z: number } | null, guardHeld = false): void {
    let wishX = 0, wishZ = 0;
    if (!dead) {
      let ix = 0, iz = 0;
      // camera basis: facing is (-sin yaw, -cos yaw); forward input pushes along it
      if (input.isHeld('forward')) iz += 1;
      if (input.isHeld('back')) iz -= 1;
      if (input.isHeld('left')) ix -= 1;
      if (input.isHeld('right')) ix += 1;
      const n = norm2(ix, iz);
      if (n.len > 0) {
        // camera-relative basis
        const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
        const rightX = -fwdZ, rightZ = fwdX;
        wishX = fwdX * n.z + rightX * n.x;
        wishZ = fwdZ * n.z + rightZ * n.x;
        const wn = norm2(wishX, wishZ);
        wishX = wn.x; wishZ = wn.z;
      }
    }

    // speed selection
    const wantSprint = input.isHeld('sprint') && !guardHeld && this.stamina.current > 1 && !this.busyState;
    this.sprinting = wantSprint && norm2(wishX, wishZ).len > 0.1 && this.state !== 'guard';
    if (this.sprinting) this.stamina.drain(STAMINA.sprintDrain * dt);

    let targetSpeed = 0;
    if (this.sprinting) targetSpeed = PLAYER.sprintSpeed;
    else if (norm2(wishX, wishZ).len > 0.1) targetSpeed = guardHeld ? PLAYER.walkSpeed * 0.72 : PLAYER.runSpeed;

    // attack / dodge movement rules
    let lungeX = 0, lungeZ = 0;
    if (this.state === 'attackWindup' || this.state === 'attackActive' || this.state === 'attackRecovery') {
      targetSpeed *= this.currentTrack?.moveSpeedMul ?? 0.3;
      // a committed step into the swing: it closes the distance the blade can actually touch,
      // and it gives light and heavy swings different weight
      const ls = this.currentTrack?.lungeSpeed ?? 0;
      const mul = this.state === 'attackActive' ? 1 : this.state === 'attackWindup' ? 0.35 : 0;
      lungeX = this.facing.x * ls * mul;
      lungeZ = this.facing.z * ls * mul;
    } else if (this.state === 'dodge') {
      targetSpeed = 0;
    } else if (this.state === 'guard') {
      targetSpeed = Math.min(targetSpeed, PLAYER.walkSpeed);
    } else if (this.state === 'heal' || this.state === 'stagger' || this.state === 'guardBreak' || this.state === 'interact') {
      targetSpeed = 0;
    }

    // dodge momentum
    if (this.state === 'dodge') {
      const t = clamp(this.stateTime / DODGE.duration, 0, 1);
      const falloff = t < 0.25 ? 1 : 1 - (t - 0.25) / 0.75;
      const boost = DODGE.speed * falloff;
      wishX = this.dodgeDir.x; wishZ = this.dodgeDir.z;
      targetSpeed = boost;
    }

    const accel = this.grounded ? PLAYER.accel : PLAYER.accel * PLAYER.airControl;
    const desiredVX = wishX * targetSpeed + lungeX;
    const desiredVZ = wishZ * targetSpeed + lungeZ;
    const rate = (targetSpeed > this.speed ? accel : PLAYER.decel) * dt;
    const curX = this.velX, curZ = this.velZ;
    const dvx = desiredVX - curX, dvz = desiredVZ - curZ;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 1e-5) {
      const k = Math.min(1, rate / dl);
      this.velX += dvx * k;
      this.velZ += dvz * k;
    }

    // gravity
    this.vy = Math.max(SIM_GRAV, this.vy + GRAVITY * dt);

    const dx = this.velX * dt;
    const dz = this.velZ * dt;
    const dy = this.slopeFollow(dx, this.vy * dt, dz);
    const res = phys.moveCharacter(this.body, dx, dy, dz);
    this.rememberSlope(res);
    this.grounded = res.grounded;
    if (res.grounded) {
      if (this.vy < 0) this.vy = 0;
      this.lastSafe.set(this.rawPosition.x, this.rawPosition.y, this.rawPosition.z);
    } else if (res.dy > 0.001) {
      this.vy = 0;
    }
    this.velX = res.dx / dt;
    this.velZ = res.dz / dt;
    this.speed = Math.hypot(this.velX, this.velZ);
    if (res.blocked && res.normalY > 0.5) this.vy = Math.max(this.vy, 0);

    // facing
    let wantYaw = this.yaw;
    if (lockDir) {
      wantYaw = Math.atan2(-lockDir.x, -lockDir.z);
    } else if (this.state === 'attackWindup' || this.state === 'attackActive' || this.state === 'attackRecovery') {
      wantYaw = this.yaw;
    } else if (this.speed > 0.4) {
      wantYaw = Math.atan2(-this.velX, -this.velZ);
    }
    const prevYaw = this.yaw;
    const diff = angleDiff(this.yaw, wantYaw);
    const maxTurn = (this.state === 'attackActive' ? 2.2 : PLAYER.turnSpeed) * dt;
    this.yaw = wrapAngle(this.yaw + clamp(diff, -maxTurn, maxTurn));
    this.turnRate = dt > 0 ? wrapAngle(this.yaw - prevYaw) / dt : 0;

    // locomotion state (only when not in a committed action)
    if (!this.busyState) {
      if (!this.grounded && this.state !== 'guard') this.setState('air');
      else if (this.state === 'guard' || this.state === 'guardImpact') { /* keep */ }
      else if (this.speed > 0.35) this.setState(this.sprinting ? 'sprint' : this.speed > PLAYER.walkSpeed + 0.6 ? 'run' : 'walk');
      else this.setState('idle');
    }
  }

  public velX = 0;
  public velZ = 0;
}

const GRAVITY = -24;
const SIM_GRAV = -32;
