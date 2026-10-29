/**
 * Third-person orbit camera with volume-aware obstruction recovery, lock-on framing,
 * look-ahead and damped follow. Never snaps violently; never leaves the player.
 */
import * as THREE from 'three';
import { CAMERA } from '../config/Balance';
import { approachRate, clamp, damp, DEG, wrapAngle } from '../core/MathX';
import type { PhysicsWorld } from '../physics/Physics';
import { MASK_WORLD } from '../physics/Physics';

export interface CameraTarget {
  x: number; y: number; z: number;
  yaw: number;
  speed: number;
  sprinting: boolean;
  eyeHeight: number;
}

export interface LockInfo {
  x: number; y: number; z: number;
  height: number;
  distance: number;
}

export class CameraRig {
  public yaw = 0;
  public pitch = 0.12;
  private radius: number = CAMERA.distance;
  private targetRadius: number = CAMERA.distance;
  private blockedHold = 0;
  private focus = new THREE.Vector3();
  private shake = new THREE.Vector3();
  private shakeAmount = 0;
  private fov: number = CAMERA.fov;
  private pin: { px: number; py: number; pz: number; lx: number; ly: number; lz: number } | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private lastDir = new THREE.Vector3(0, 0, -1);
  private readonly viewVec = new THREE.Vector3();

  constructor(public camera: THREE.PerspectiveCamera, initialYaw: number) {
    this.yaw = initialYaw;
  }

  /** Screenshot hook: hold the camera at an explicit position aimed at an explicit point. */
  pinCamera(px: number, py: number, pz: number, lx: number, ly: number, lz: number): void {
    this.pin = { px, py, pz, lx, ly, lz };
  }

  clearCameraPin(): void { this.pin = null; }

  addLook(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch -= dy;
    this.pitch = clamp(this.pitch, CAMERA.pitchMin, CAMERA.pitchMax);
    this.yaw = wrapAngle(this.yaw);
  }

  addShake(amount: number): void {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + amount);
  }

  setShakeScale(scale: number): void { this.shakeAmount *= scale; }

  update(
    dt: number,
    target: CameraTarget,
    phys: PhysicsWorld,
    lock: LockInfo | null,
    opts: { shakeScale: number; reducedMotion: boolean },
  ): void {
    if (this.pin) {
      this.camera.position.set(this.pin.px, this.pin.py, this.pin.pz);
      this.camera.lookAt(this.pin.lx, this.pin.ly, this.pin.lz);
      return;
    }

    // ---- desired focus point
    const focusY = target.y + target.eyeHeight;
    let fx = target.x, fy = focusY, fz = target.z;
    if (lock) {
      // bias the framing between the player and the target so both stay readable
      fx = target.x * 0.62 + lock.x * 0.38;
      fz = target.z * 0.62 + lock.z * 0.38;
      fy = focusY * 0.6 + (lock.y + lock.height * 0.55) * 0.4;
      this.targetRadius = clamp(lock.distance * 0.72 + 2.6, CAMERA.lockDistance * 0.8, CAMERA.lockDistance + 2.4);
    } else {
      this.targetRadius = CAMERA.distance;
    }

    // ---- look-ahead: nudge the focus forward along the facing so the world reads earlier
    if (!opts.reducedMotion) {
      const la = CAMERA.lookAhead * clamp(target.speed / 6, 0, 1);
      fx += -Math.sin(target.yaw) * la;
      fz += -Math.cos(target.yaw) * la;
    }

    this.focus.set(fx, fy, fz);

    // ---- orbit position
    const cp = Math.cos(this.pitch);
    const dir = this.tmp.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
    this.lastDir.copy(dir);

    this.radius = damp(this.radius, this.targetRadius, 0.09, dt);

    // ---- obstruction probe: probe a small volume instead of a single ray, so the camera
    //      slides along walls instead of stuttering on corners.
    let want = this.targetRadius;
    const shoulder = this.tmp2.set(fx, fy + 0.25, fz);
    const hit = phys.raycast(shoulder.x, shoulder.y, shoulder.z, dir.x, dir.y, dir.z, want + CAMERA.minRadius, MASK_WORLD);
    if (hit && hit.toi > 0.05) {
      want = Math.max(CAMERA.minRadius, hit.toi - CAMERA.probeRadius);
      this.blockedHold = CAMERA.recoveryAfterBlock;
    }
    // secondary probe slightly higher, to avoid the camera dipping into floors
    const hit2 = phys.raycast(shoulder.x, shoulder.y + 0.45, shoulder.z, dir.x, dir.y, dir.z, want + CAMERA.minRadius, MASK_WORLD);
    if (hit2 && hit2.toi > 0.05) want = Math.min(want, Math.max(CAMERA.minRadius, hit2.toi - CAMERA.probeRadius));

    if (this.blockedHold > 0) {
      this.blockedHold -= dt;
      this.radius = Math.min(this.radius, want);
    } else {
      this.radius = approachRate(this.radius, Math.min(this.targetRadius, want), CAMERA.radiusDamping, dt);
    }
    this.radius = clamp(this.radius, CAMERA.minRadius, CAMERA.distance + 3);

    let cx = fx + dir.x * this.radius;
    let cy = fy + dir.y * this.radius;
    let cz = fz + dir.z * this.radius;

    // never let the camera pass through the floor
    const ground = phys.groundBelow(cx, cy + 3, cz, 8);
    if (ground.hit) cy = Math.max(cy, ground.y + 0.45);
    cy = Math.max(cy, fy - 1.1);

    // ---- shake (scaled by user setting, decays fast, never affects simulation)
    if (this.shakeAmount > 0.001 && !opts.reducedMotion) {
      const s = this.shakeAmount * 0.16 * opts.shakeScale;
      const t = performance.now() * 0.001;
      this.shake.set(Math.sin(t * 61) * s, Math.sin(t * 47 + 1.3) * s * 0.8, Math.sin(t * 53 + 2.1) * s);
      this.shakeAmount = damp(this.shakeAmount, 0, 0.045, dt);
    } else {
      this.shakeAmount = 0;
      this.shake.set(0, 0, 0);
    }

    this.camera.position.set(cx + this.shake.x, cy + this.shake.y, cz + this.shake.z);
    this.camera.lookAt(this.focus.x + this.shake.x * 0.4, this.focus.y + this.shake.y * 0.4, this.focus.z + this.shake.z * 0.4);

    // ---- subtle FOV push while sprinting
    const wantFov = CAMERA.fov + (target.sprinting ? CAMERA.fovSprintAdd : 0);
    this.fov = damp(this.fov, wantFov, 0.12, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Snap behind the player (used on respawn / after a teleport so no swing is visible). */
  snapBehind(targetYaw: number, pitch = 0.14): void {
    this.yaw = targetYaw;
    this.pitch = clamp(pitch, CAMERA.pitchMin, CAMERA.pitchMax);
    this.radius = this.targetRadius;
    this.blockedHold = 0;
  }

  get currentRadius(): number { return this.radius; }
  /** The direction the camera is looking (from camera toward the focus point). */
  get viewDirection(): THREE.Vector3 { return this.viewVec.set(-this.lastDir.x, -this.lastDir.y, -this.lastDir.z); }
}

export const CAMERA_DEG = DEG;
