/**
 * Shared actor: physics capsule + articulated rig + combat state fields.
 * Positions are read from Rapier every frame; the visual root is a child of a group
 * whose transform is written from the (optionally interpolated) physics transform.
 */
import * as THREE from 'three';
import type { PhysicsWorld, CharacterBody } from '../physics/Physics';
import { LAYER, MASK_ACTOR, grp } from '../physics/Physics';
import type { Rig } from '../render/HumanoidRig';
import { HumanoidAnimator, type AnimContext, type PoseRequest } from '../render/Animators';
import type { ActorId, ActorKind, CombatState, DamageKind, DamageResult, DefenderInfo, Faction } from '../core/Types';
import { PLAYER, type AttackTrack } from '../config/Balance';
import { clamp, wrapAngle } from '../core/MathX';

export interface ActorInit {
  id: ActorId;
  kind: ActorKind;
  faction: Faction;
  x: number; y: number; z: number;
  yaw: number;
  radius: number;
  halfHeight: number;
  height: number;
  maxHealth: number;
  poise: number;
}

export class Actor {
  public state: CombatState = 'idle';
  public stateTime = 0;
  /** time since the current committed action (attack/dodge/heal) began; survives state phase changes */
  public actionTime = 0;
  public yaw: number;
  public alive = true;
  public health: number;
  public maxHealth: number;
  public poise: number;
  public maxPoise: number;
  public poiseDecay = 0;
  public invulnTimer = 0;
  public grounded = false;
  public vy = 0;
  public lastSafe: THREE.Vector3;
  public visual: THREE.Group;
  public animator: HumanoidAnimator;
  public attackId = -1;
  public attackIndex = 0;
  public currentTrack: AttackTrack | null = null;
  public lastAttackKind: DamageKind = 'light';
  public hitFlash = 0;
  public readonly prevTip = new THREE.Vector3();
  public readonly prevMid = new THREE.Vector3();
  public tipReady = false;
  /** interpolated render transform (physics position is authoritative) */
  public renderPos = new THREE.Vector3();
  public renderYaw: number;

  constructor(
    public readonly id: ActorId,
    public readonly kind: ActorKind,
    public readonly faction: Faction,
    public readonly phys: PhysicsWorld,
    public body: CharacterBody,
    public rig: Rig,
    init: ActorInit,
  ) {
    this.yaw = init.yaw;
    this.renderYaw = init.yaw;
    this.health = init.maxHealth;
    this.maxHealth = init.maxHealth;
    this.poise = init.poise;
    this.maxPoise = init.poise;
    this.lastSafe = new THREE.Vector3(init.x, init.y, init.z);
    this.visual = new THREE.Group();
    this.visual.name = `actor_${kind}_${id}`;
    this.visual.add(rig.root);
    this.animator = new HumanoidAnimator(rig);
    this.renderPos.set(init.x, init.y, init.z);
    this.syncVisual(1);
  }

  get position(): THREE.Vector3 {
    const p = this.phys.characterPosition(this.body);
    return TMP.set(p.x, p.y, p.z);
  }

  get rawPosition(): { x: number; y: number; z: number } {
    return this.phys.characterPosition(this.body);
  }

  get facing(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  get healthFraction(): number { return this.maxHealth > 0 ? clamp(this.health / this.maxHealth, 0, 1) : 0; }

  setState(next: CombatState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
  }

  tickTimers(dt: number): void {
    this.stateTime += dt;
    this.actionTime += dt;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    if (this.poiseDecay > 0) {
      this.poiseDecay -= dt;
      if (this.poiseDecay <= 0) this.poise = Math.min(this.maxPoise, this.poise);
    }
  }

  addPoiseDamage(amount: number): void {
    this.poise = Math.max(0, this.poise - amount);
    this.poiseDecay = 1.6;
  }

  defenderInfo(): DefenderInfo {
    const f = this.facing;
    return {
      faction: this.faction,
      facingX: f.x, facingZ: f.z,
      guarding: this.state === 'guard' || this.state === 'guardImpact',
      guardArcDeg: this.faction === 'player' ? 110 : 90,
      stamina: this.staminaCurrent(),
      maxStamina: this.maxStamina(),
      invulnerable: this.invulnTimer > 0 || !this.alive,
      health: this.health,
      poise: this.poise,
      maxPoise: this.maxPoise,
      staggerThresholdReached: this.poise <= 0,
      shieldedFront: this.shieldedFront,
    };
  }

  /** Normal of the walkable surface the character controller last reported. */
  protected slopeN: { x: number; y: number; z: number } | null = null;

  /**
   * A character standing on a walkable slope has to be commanded *along* that slope.
   * Commanding plain gravity instead makes the controller project gravity and forward motion
   * together, which cancels most of the forward motion and turns a staircase into a crawl.
   */
  protected slopeFollow(dx: number, dy: number, dz: number): number {
    const n = this.slopeN;
    if (!this.grounded || !n || n.y < 0.2) return dy;
    const tangent = -(dx * n.x + dz * n.z) / n.y;
    return tangent > 0 ? Math.max(dy, tangent) : Math.min(dy, tangent);
  }

  protected rememberSlope(res: { blocked: boolean; grounded: boolean; normalX: number; normalY: number; normalZ: number }): void {
    if (res.blocked && res.normalY > 0.5) this.slopeN = { x: res.normalX, y: res.normalY, z: res.normalZ };
    else if (!res.blocked) this.slopeN = null;
  }

  protected shieldedFront = false;
  public shieldBreakTimer = 0;
  protected staminaCurrent(): number { return this.maxStamina(); }
  public maxStamina(): number { return 100; }

  applyDamage(result: DamageResult): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - result.damage);
    if (result.damage > 0) {
      this.invulnTimer = this.faction === 'player' ? PLAYER.invulnAfterHit : 0.05;
      this.hitFlash = 1;
    }
    if (result.poiseDamage > 0) this.addPoiseDamage(result.poiseDamage);
    // one rule everywhere: an empty health bar ends the actor, whatever produced the damage
    if (this.health <= 0 && this.alive) this.kill();
  }

  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.setState('dead');
    this.attackId = -1;
  }

  teleport(x: number, y: number, z: number, yaw: number): void {
    this.phys.setCharacterPosition(this.body, x, y, z);
    this.yaw = yaw;
    this.renderYaw = yaw;
    this.vy = 0;
    this.lastSafe.set(x, y, z);
    this.renderPos.set(x, y, z);
    this.tipReady = false;
    this.syncVisual(1);
  }

  /** Write the visual root from the physics transform (with optional interpolation). */
  syncVisual(alpha: number): void {
    const p = this.body.body.translation();
    if (alpha >= 1) {
      this.renderPos.set(p.x, p.y, p.z);
      this.renderYaw = this.yaw;
    } else {
      // render interpolation between the previous and current fixed-step transforms
      this.renderPos.lerp(TMP2.set(p.x, p.y, p.z), alpha);
      this.renderYaw = this.renderYaw + wrapAngle(this.yaw - this.renderYaw) * alpha;
    }
    this.visual.position.copy(this.renderPos);
    this.visual.rotation.y = this.renderYaw;
  }

  /** Update the pose and refresh world matrices so hit queries use the rendered blade. */
  updatePose(req: PoseRequest, dt: number): void {
    this.animator.update(req, dt);
    this.visual.updateMatrixWorld(true);
    const tip = this.rig.weaponTip.getWorldPosition(TMP3);
    const mid = this.rig.weaponMid.getWorldPosition(TMP4);
    if (!this.tipReady) {
      this.prevTip.copy(tip);
      this.prevMid.copy(mid);
      this.tipReady = true;
    }
  }

  weaponTipWorld(out: THREE.Vector3): THREE.Vector3 { return this.rig.weaponTip.getWorldPosition(out); }
  weaponMidWorld(out: THREE.Vector3): THREE.Vector3 { return this.rig.weaponMid.getWorldPosition(out); }

  animContext(speed: number, maxSpeed: number, turnRate: number, time: number): AnimContext {
    return { speed, maxSpeed, phase: this.stateTime, turnRate, time, healthFraction: this.healthFraction, guarding: this.state === 'guard', lockOn: false };
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.visual);
    this.rig.dispose();
    try { this.phys.world.removeRigidBody(this.body.body); } catch { /* already gone */ }
  }

  /** Register the actor handle so queries can map colliders back to actors. */
  actorColliderHandle(): number { return this.body.collider.handle; }
}

export function actorGroups(): number { return grp(LAYER.ACTOR, MASK_ACTOR); }

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const TMP3 = new THREE.Vector3();
const TMP4 = new THREE.Vector3();
