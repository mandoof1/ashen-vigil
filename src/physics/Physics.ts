/**
 * Physics layer — Rapier is the single authority for actor positions.
 *
 * Collision groups (membership << 16 | filter):
 *   WORLD    solid static geometry (floors, walls, ramps, pillars)
 *   BLOCKER  openable solid geometry (the shortcut gate) — queried together with WORLD
 *   ACTOR    character capsules (player, enemies, boss)
 *   TRIGGER  sensors: volumes that report overlap but never block movement
 *   INTERACT sensors: interaction volumes (checkpoint, gate lever, bell, pickups)
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, Vector } from '@dimforge/rapier3d-compat';
import { SIM } from '../config/Balance';

export const LAYER = {
  WORLD: 0x0001,
  ACTOR: 0x0002,
  TRIGGER: 0x0004,
  INTERACT: 0x0008,
  BLOCKER: 0x0010,
  BARRIER: 0x0020, // one-way fight boundary: blocks actors, never occludes sight or navigation
} as const;

export const MASK_WORLD = LAYER.WORLD | LAYER.BLOCKER;
export const MASK_ACTOR = LAYER.ACTOR;
export const MASK_BARRIER = LAYER.BARRIER;
export const MASK_SENSORS = LAYER.TRIGGER | LAYER.INTERACT;

export function grp(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export interface GroundInfo {
  hit: boolean;
  distance: number;
  y: number;
  normalY: number;
}

export interface RayHit {
  toi: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  handle: number;
}

export interface CharacterBody {
  body: RigidBody;
  collider: Collider;
  controller: RAPIER.KinematicCharacterController;
  radius: number;
  halfHeight: number;
}

export interface MoveResult {
  dx: number; dy: number; dz: number;
  grounded: boolean;
  blocked: boolean;
  /** normal of the first blocking contact, if any (used for wall-slide and camera probes) */
  normalX: number; normalY: number; normalZ: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private flags: typeof RAPIER.QueryFilterFlags;
  private tmp: { x: number; y: number; z: number };
  public stepCount = 0;

  private constructor(world: RAPIER.World) {
    this.world = world;
    this.flags = RAPIER.QueryFilterFlags;
    this.tmp = { x: 0, y: 0, z: 0 };
    world.timestep = SIM.fixedDt;
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: SIM.gravity, z: 0 });
    return new PhysicsWorld(world);
  }

  static get version(): string {
    return RAPIER.version();
  }

  step(): void {
    this.world.step();
    this.stepCount++;
  }

  // ---------------------------------------------------------------- statics
  private add(desc: RAPIER.ColliderDesc): Collider {
    return this.world.createCollider(desc);
  }

  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0): Collider {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(grp(LAYER.WORLD, MASK_WORLD | MASK_ACTOR))
      .setFriction(0.9);
    if (yaw !== 0) d.setRotation(quatFromYaw(yaw));
    return this.add(d);
  }

  /** A ramp collider; `pitch` is rotation about the world X axis (radians, +ve rises toward -Z). */
  ramp(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, pitch: number, yaw = 0): Collider {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(grp(LAYER.WORLD, MASK_WORLD | MASK_ACTOR))
      .setFriction(0.9);
    const qy = quatFromYaw(yaw);
    const qp = quatFromPitch(pitch);
    d.setRotation(quatMul(qy, qp));
    return this.add(d);
  }

  cylinder(cx: number, cy: number, cz: number, halfHeight: number, radius: number): Collider {
    return this.add(RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(grp(LAYER.WORLD, MASK_WORLD | MASK_ACTOR))
      .setFriction(0.9));
  }

  capsule(cx: number, cy: number, cz: number, halfHeight: number, radius: number): Collider {
    return this.add(RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(grp(LAYER.WORLD, MASK_WORLD | MASK_ACTOR)));
  }

  /** Fight-boundary wall: stops actors, invisible to line-of-sight and navigation probes. */
  barrierBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Collider {
    return this.add(RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(grp(LAYER.BARRIER, MASK_ACTOR)));
  }

  /** Sensor volume used for triggers / interactions. Never blocks movement. */
  sensorBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, layer: number = LAYER.TRIGGER): Collider {
    return this.add(RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setSensor(true)
      .setCollisionGroups(grp(layer, MASK_ACTOR)));
  }

  sensorCylinder(cx: number, cy: number, cz: number, halfHeight: number, radius: number, layer: number = LAYER.INTERACT): Collider {
    return this.add(RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(cx, cy, cz)
      .setSensor(true)
      .setCollisionGroups(grp(layer, MASK_ACTOR)));
  }

  remove(collider: Collider): void {
    try {
      this.world.removeCollider(collider, false);
    } catch { /* already removed */ }
  }

  // ------------------------------------------------------------- characters
  createCharacter(x: number, y: number, z: number, radius: number, halfHeight: number, offsetUp = radius + halfHeight): CharacterBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setTranslation(0, offsetUp, 0)
        .setCollisionGroups(grp(LAYER.ACTOR, MASK_WORLD | MASK_ACTOR))
        .setFriction(0.4),
      body,
    );
    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(0.55, 0.34, true);
    controller.enableSnapToGround(0.4);
    controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((44 * Math.PI) / 180);
    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setUp({ x: 0, y: 1, z: 0 });
    return { body, collider, controller, radius, halfHeight };
  }

  /**
   * Move a character capsule with the Rapier character controller.
   * `vy` is the vertical velocity the caller wants (gravity / jump), horizontal is `dx,dz`.
   */
  moveCharacter(ch: CharacterBody, dx: number, dy: number, dz: number): MoveResult {
    const own = ch.collider.handle;
    ch.controller.computeColliderMovement(
      ch.collider,
      { x: dx, y: dy, z: dz },
      this.flags.EXCLUDE_SENSORS,
      grp(LAYER.ACTOR, MASK_WORLD | MASK_ACTOR | MASK_BARRIER),
      (c: Collider) => c.handle !== own,
    );
    const mv = ch.controller.computedMovement(this.tmp);
    const grounded = ch.controller.computedGrounded();
    let nx = 0, ny = 0, nz = 0, blocked = false;
    const n = ch.controller.numComputedCollisions();
    if (n > 0) {
      const c = ch.controller.computedCollision(0);
      if (c) {
        blocked = true;
        nx = c.normal1.x; ny = c.normal1.y; nz = c.normal1.z;
      }
    }
    const t = ch.body.translation();
    ch.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    return { dx: mv.x, dy: mv.y, dz: mv.z, grounded, blocked, normalX: nx, normalY: ny, normalZ: nz };
  }

  setCharacterPosition(ch: CharacterBody, x: number, y: number, z: number): void {
    ch.body.setTranslation({ x, y, z }, true);
    ch.body.setNextKinematicTranslation({ x, y, z });
  }

  characterPosition(ch: CharacterBody): { x: number; y: number; z: number } {
    const t = ch.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  // -------------------------------------------------------------- queries
  raycast(fromX: number, fromY: number, fromZ: number, dirX: number, dirY: number, dirZ: number, maxToi: number, mask: number, excludeCollider?: Collider): RayHit | null {
    const len = Math.hypot(dirX, dirY, dirZ);
    if (len < 1e-6) return null;
    const ray = new RAPIER.Ray({ x: fromX, y: fromY, z: fromZ }, { x: dirX / len, y: dirY / len, z: dirZ / len });
    const hit = this.world.castRayAndGetNormal(
      ray, maxToi, true,
      this.flags.EXCLUDE_SENSORS,
      grp(0xffff, mask),
      excludeCollider,
    );
    if (!hit) return null;
    return {
      toi: hit.timeOfImpact,
      x: fromX + (dirX / len) * hit.timeOfImpact,
      y: fromY + (dirY / len) * hit.timeOfImpact,
      z: fromZ + (dirZ / len) * hit.timeOfImpact,
      nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z,
      handle: hit.collider.handle,
    };
  }

  /** True when solid geometry blocks the straight line between two points. */
  lineBlocked(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask = MASK_WORLD): boolean {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) return false;
    const hit = this.raycast(x0, y0, z0, dx, dy, dz, dist - 0.05, mask);
    return hit !== null;
  }

  /** Probe the ground below a point. Returns the surface Y (or NaN when nothing is found). */
  groundBelow(x: number, y: number, z: number, maxDist = 3, mask = MASK_WORLD): GroundInfo {
    const hit = this.raycast(x, y, z, 0, -1, 0, maxDist, mask);
    if (!hit) return { hit: false, distance: maxDist, y: NaN, normalY: 0 };
    return { hit: true, distance: hit.toi, y: hit.y, normalY: hit.ny };
  }

  /** Overlap test with a sphere; `cb` receives collider handles. */
  overlapSphere(x: number, y: number, z: number, radius: number, mask: number, cb: (handle: number, collider: Collider) => boolean): void {
    this.world.intersectionsWithShape(
      { x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(radius),
      (c: Collider) => cb(c.handle, c),
      this.flags.EXCLUDE_SENSORS,
      grp(0xffff, mask),
    );
  }

  /** True when a small sphere at this point intersects solid world geometry (used by tests + edge checks). */
  solidAt(x: number, y: number, z: number, radius = 0.12): boolean {
    let hit = false;
    this.overlapSphere(x, y, z, radius, MASK_WORLD, () => { hit = true; return false; });
    return hit;
  }

  overlapCapsule(x: number, y: number, z: number, halfHeight: number, radius: number, mask: number, cb: (handle: number, collider: Collider) => boolean): void {
    this.world.intersectionsWithShape(
      { x, y: y + halfHeight + radius, z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(halfHeight, radius),
      (c: Collider) => cb(c.handle, c),
      this.flags.EXCLUDE_SENSORS,
      grp(0xffff, mask),
    );
  }

  /**
   * Swept-sphere hit query from A to B. Used for weapon swings so a fast blade can never
   * tunnel through a target between two rendered frames.
   */
  sweepSphere(ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number, mask: number, cb: (handle: number, collider: Collider) => boolean): void {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-5) {
      this.overlapSphere(ax, ay, az, radius, mask, cb);
      return;
    }
    // Sample along the sweep: intersectionsWithShape is exact per sample and cheap for small radii.
    const steps = Math.max(2, Math.min(12, Math.ceil(dist / (radius * 1.5))));
    const seen = new Set<number>();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.overlapSphere(ax + dx * t, ay + dy * t, az + dz * t, radius, mask, (h, c) => {
        if (seen.has(h)) return true;
        seen.add(h);
        return cb(h, c);
      });
    }
  }

  /** Overlap of a sensor volume with actor colliders. */
  actorsInVolume(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, cb: (handle: number) => boolean): void {
    this.world.intersectionsWithShape(
      { x: cx, y: cy, z: cz }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Cuboid(hx, hy, hz),
      (c: Collider) => cb(c.handle),
      this.flags.EXCLUDE_SENSORS,
      grp(0xffff, MASK_ACTOR),
    );
  }
}

// ------------------------------------------------------------------ quaternions
interface Quat { x: number; y: number; z: number; w: number }

export function quatFromYaw(yaw: number): Quat {
  const h = yaw * 0.5;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}

export function quatFromPitch(pitch: number): Quat {
  const h = pitch * 0.5;
  return { x: Math.sin(h), y: 0, z: 0, w: Math.cos(h) };
}

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export type { Collider, Vector };
