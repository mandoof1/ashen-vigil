/**
 * Procedural animation for the articulated rigs. Every pose is a set of joint Euler
 * targets; the animator slerps toward them at a state-dependent rate, so transitions
 * are always smooth (no pose snapping) and no animation asset is required.
 */
import * as THREE from 'three';
import type { Rig } from './HumanoidRig';
import type { CombatState } from '../core/Types';
import { clamp, DEG, lerp, smoothstep } from '../core/MathX';

export interface PoseSpec {
  joints: Record<string, [number, number, number]>;
  rootY: number;
  rootPitch: number;
}

export interface AnimContext {
  speed: number;        // current planar speed m/s
  maxSpeed: number;
  phase: number;        // 0..1 progress through the current action
  turnRate: number;     // rad/s applied this frame (for lean-into-turn)
  time: number;
  healthFraction: number;
  guarding: boolean;
  lockOn: boolean;
}

const BASE: Record<string, [number, number, number]> = {
  hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  shoulderL: [0.06, 0, 0.14], shoulderR: [0.06, 0, -0.14],
  upperArmL: [0.18, 0, 0.1], foreArmL: [-0.55, 0, 0], handL: [0, 0, 0],
  upperArmR: [0.18, 0, -0.1], foreArmR: [-0.55, 0, 0], handR: [0, 0, 0],
  thighL: [0.04, 0, 0.02], shinL: [-0.08, 0, 0], footL: [0.04, 0, 0],
  thighR: [0.04, 0, -0.02], shinR: [-0.08, 0, 0], footR: [0.04, 0, 0],
  cloak0: [0.1, 0, 0], cloak1: [0.12, 0, 0], cloak2: [0.12, 0, 0], cloak3: [0.12, 0, 0],
  weapon: [0, 0, 0], shield: [0, 0, 0],
};

function spec(partial: Partial<PoseSpec['joints']>, rootY = 0, rootPitch = 0): PoseSpec {
  return { joints: partial as PoseSpec['joints'], rootY, rootPitch };
}

function mix(a: PoseSpec, b: PoseSpec, t: number): PoseSpec {
  const out: Record<string, [number, number, number]> = {};
  const names = new Set([...Object.keys(a.joints), ...Object.keys(b.joints)]);
  for (const n of names) {
    const av = a.joints[n] ?? [0, 0, 0];
    const bv = b.joints[n] ?? [0, 0, 0];
    out[n] = [lerp(av[0], bv[0], t), lerp(av[1], bv[1], t), lerp(av[2], bv[2], t)];
  }
  return { joints: out, rootY: lerp(a.rootY, b.rootY, t), rootPitch: lerp(a.rootPitch, b.rootPitch, t) };
}

/** Ready stance: weapon up, shield forward, weight low. */
function readyPose(t: number, ctx: AnimContext): PoseSpec {
  void ctx;
  const breathe = Math.sin(t * 1.9) * 0.03;
  const bob = Math.sin(t * 1.9 * 2) * 0.012;
  return spec({
    hips: [0.04, 0, 0], spine: [-0.06 + breathe, 0.06, 0], chest: [0, 0.12, 0],
    shoulderL: [-0.5, 0, 0.35], upperArmL: [-0.35, 0.35, 0.35], foreArmL: [-1.15, 0.2, 0], handL: [0, 0, 0],
    shoulderR: [0.1, 0, -0.3], upperArmR: [0.5, -0.35, -0.35], foreArmR: [-1.15, -0.25, 0],
    weapon: [-0.35, -0.25, 0.15],
    thighL: [0.12, 0, 0.05], shinL: [-0.3, 0, 0], footL: [0.18, 0, 0],
    thighR: [-0.1, 0, -0.05], shinR: [-0.22, 0, 0], footR: [0.16, 0, 0],
    cloak0: [0.16, 0, 0], cloak1: [0.14, 0, 0], cloak2: [0.12, 0, 0], cloak3: [0.1, 0, 0],
  }, bob);
}

function locomotionPose(ctx: AnimContext): PoseSpec {
  const f = clamp(ctx.speed / Math.max(0.01, ctx.maxSpeed), 0, 1);
  const freq = 2.6 + f * 5.4;
  const t = ctx.time * freq;
  const amp = 0.28 + f * 0.62;
  const arm = 0.2 + f * 0.5;
  const lean = 0.04 + f * 0.22;
  const bob = Math.abs(Math.sin(t)) * (0.02 + f * 0.05);
  const cloakSway = -f * 0.5 + Math.sin(t - 0.8) * 0.08;
  const leanZ = clamp(ctx.turnRate * 0.16, -0.3, 0.3);
  return spec({
    hips: [lean * 0.5, 0, leanZ],
    spine: [-lean, 0, leanZ * 0.6], chest: [-lean * 0.5, 0.1 - ctx.turnRate * 0.05, leanZ * 0.5],
    thighL: [Math.sin(t) * amp + 0.05, 0, 0.05], shinL: [-Math.max(0, -Math.sin(t - 0.6)) * amp * 1.5 - 0.15, 0, 0], footL: [Math.max(0, Math.sin(t + 0.5)) * 0.3, 0, 0],
    thighR: [Math.sin(t + Math.PI) * amp + 0.05, 0, -0.05], shinR: [-Math.max(0, -Math.sin(t + Math.PI - 0.6)) * amp * 1.5 - 0.15, 0, 0], footR: [Math.max(0, Math.sin(t + Math.PI + 0.5)) * 0.3, 0, 0],
    upperArmL: [-0.35 + Math.sin(t + Math.PI) * arm, 0.3, 0.3], foreArmL: [-1.05 - Math.abs(Math.sin(t)) * 0.2, 0.2, 0],
    upperArmR: [0.5 + Math.sin(t) * arm, -0.35, -0.3], foreArmR: [-1.1 - Math.abs(Math.sin(t + 1)) * 0.2, -0.25, 0],
    shoulderL: [-0.4 - Math.sin(t) * 0.12, 0, 0.3],
    cloak0: [0.16 - cloakSway, 0, 0], cloak1: [0.14 - cloakSway, 0, 0], cloak2: [0.12 - cloakSway, 0, 0], cloak3: [0.1 - cloakSway, 0, 0],
  }, bob);
}

function guardPose(ctx: AnimContext): PoseSpec {
  const t = ctx.time;
  const tremor = ctx.healthFraction < 0.35 ? Math.sin(t * 22) * 0.02 : 0;
  return spec({
    hips: [0.06, 0, -0.1], spine: [-0.1, -0.22, -0.06], chest: [0.02, -0.3, 0],
    shoulderL: [-0.75, 0.15, 0.55], upperArmL: [-0.5, 0.85, 0.5], foreArmL: [-1.25, 0.35, 0.1],
    shield: [-0.15, 0.5, 0.1],
    shoulderR: [0.05, 0, -0.42], upperArmR: [0.35, -0.5, -0.5], foreArmR: [-1.35, -0.3, 0],
    weapon: [-0.25, -0.5, 0.3],
    thighL: [0.18, 0, 0.06], shinL: [-0.42, 0, 0], footL: [0.24, 0, 0],
    thighR: [-0.16, 0, -0.06], shinR: [-0.3, 0, 0], footR: [0.2, 0, 0],
    head: [0.05, 0.12, tremor],
  });
}

function guardImpactPose(p: number): PoseSpec {
  const k = Math.sin(clamp(p, 0, 1) * Math.PI);
  const g = guardPose({ ...zeroCtx, time: p });
  return mix(g, spec({
    spine: [0.16, -0.3, 0], chest: [0.12, -0.36, 0], head: [0.24, -0.2, 0],
    shoulderL: [-0.55, 0.1, 0.5], upperArmL: [-0.2, 0.8, 0.4], foreArmL: [-1.0, 0.3, 0],
    hips: [0.12, 0, -0.1],
  }), k);
}

/** three-hit light combo: horizontal cut, reverse cut, finishing downward arc */
function lightAttackPose(index: number, p: number, windup: number, active: number, recovery: number): PoseSpec {
  const w = clamp(p / Math.max(1e-4, windup), 0, 1);
  const a = clamp((p - windup) / Math.max(1e-4, active), 0, 1);
  const r = clamp((p - windup - active) / Math.max(1e-4, recovery), 0, 1);
  const ready = readyPose(p, zeroCtx);
  const windupPose = index === 2
    ? spec({
      spine: [-0.05, 0.55, 0], chest: [-0.25, 0.6, 0], head: [0.1, -0.2, 0],
      upperArmR: [1.5, -0.5, -0.5], foreArmR: [-1.5, -0.2, 0], weapon: [-2.5, -0.4, 0.2],
      shoulderR: [-0.5, 0, -0.5], hips: [0.02, -0.35, 0],
    })
    : spec({
      spine: [0.02, -0.5, 0], chest: [0.05, -0.62, 0], head: [-0.05, 0.25, 0],
      upperArmR: [0.2, 1.35, -0.4], foreArmR: [-1.15, 0.3, 0], weapon: [-0.4, 1.9, 0.5],
      shoulderR: [0.1, 0.4, -0.35], hips: [0.02, 0.35, 0],
    });
  const strikePose = index === 2
    ? spec({
      spine: [-0.3, -0.45, 0], chest: [-0.5, -0.5, 0], head: [-0.2, 0.2, 0],
      upperArmR: [-0.9, -0.9, -0.6], foreArmR: [-0.35, -0.3, 0], weapon: [0.9, -1.2, -0.4],
      shoulderR: [0.4, 0, -0.4], hips: [-0.1, -0.2, 0],
      thighL: [0.3, 0, 0.06], shinL: [-0.5, 0, 0], thighR: [-0.2, 0, -0.06],
    })
    : spec({
      spine: [0.0, 0.55, 0], chest: [0.02, 0.7, 0], head: [0.02, -0.3, 0],
      upperArmR: [0.35, -1.5, -0.35], foreArmR: [-0.75, -0.4, 0], weapon: [-0.3, -2.2, 0.1],
      shoulderR: [0.2, -0.3, -0.4], hips: [0.02, -0.4, 0],
      thighL: [0.22, 0, 0.05], thighR: [-0.16, 0, -0.05],
    });
  const stage1 = mix(ready, windupPose, smoothstep(0, 1, w));
  const stage2 = mix(stage1, strikePose, smoothstep(0, 1, a));
  return mix(stage2, ready, smoothstep(0, 1, r) * 0.85);
}

function heavyAttackPose(p: number, windup: number, active: number, recovery: number): PoseSpec {
  const w = clamp(p / Math.max(1e-4, windup), 0, 1);
  const a = clamp((p - windup) / Math.max(1e-4, active), 0, 1);
  const r = clamp((p - windup - active) / Math.max(1e-4, recovery), 0, 1);
  const ready = readyPose(p, zeroCtx);
  const up = spec({
    spine: [-0.28, 0.25, 0], chest: [-0.5, 0.3, 0], head: [-0.18, -0.1, 0],
    upperArmR: [2.1, -0.35, -0.45], foreArmR: [-1.15, -0.15, 0], weapon: [-2.9, -0.3, 0.1],
    shoulderR: [-0.7, 0, -0.45], upperArmL: [-0.4, 0.5, 0.4], foreArmL: [-1.1, 0.25, 0],
    hips: [-0.06, -0.2, 0], thighL: [0.1, 0, 0.05], thighR: [-0.14, 0, -0.05],
  });
  const down = spec({
    spine: [0.42, -0.2, 0], chest: [0.55, -0.25, 0], head: [0.3, 0.15, 0],
    upperArmR: [-1.35, -0.5, -0.4], foreArmR: [-0.15, -0.2, 0], weapon: [1.5, -0.6, 0],
    shoulderR: [0.5, 0, -0.4], hips: [0.2, -0.15, 0],
    thighL: [0.34, 0, 0.06], shinL: [-0.62, 0, 0], footL: [0.28, 0, 0],
    thighR: [-0.24, 0, -0.06], shinR: [-0.34, 0, 0],
  });
  const s1 = mix(ready, up, smoothstep(0, 1, w));
  const s2 = mix(s1, down, smoothstep(0, 1, a));
  return mix(s2, ready, smoothstep(0, 1, r) * 0.8);
}

function dodgePose(p: number): PoseSpec {
  const t = clamp(p, 0, 1);
  const spin = t * Math.PI * 2;
  const tuck = Math.sin(Math.min(1, t * 1.35) * Math.PI);
  return spec({
    hips: [0, 0, spin * 0.15],
    spine: [1.15 * tuck, 0, 0], chest: [0.35 * tuck, 0, 0], head: [-0.5 * tuck, 0, 0],
    upperArmL: [0.4, 0, 0.6], foreArmL: [-1.6, 0.2, 0],
    upperArmR: [0.4, 0, -0.6], foreArmR: [-1.6, -0.2, 0], weapon: [-0.6, -0.4, 0],
    thighL: [-1.25 * tuck, 0, 0.1], shinL: [-1.5 * tuck, 0, 0], footL: [0.6 * tuck, 0, 0],
    thighR: [-1.05 * tuck, 0, -0.1], shinR: [-1.35 * tuck, 0, 0], footR: [0.55 * tuck, 0, 0],
  }, -0.42 * tuck, spin * 0.85);
}

function staggerPose(p: number): PoseSpec {
  const k = Math.sin(clamp(p, 0, 1) * Math.PI);
  return mix(readyPose(p, zeroCtx), spec({
    spine: [0.35, 0.1, 0], chest: [0.3, 0.15, 0], head: [0.5, 0.1, 0],
    upperArmL: [0.6, 0.3, 0.5], foreArmL: [-0.6, 0.2, 0],
    upperArmR: [0.7, -0.3, -0.4], foreArmR: [-0.4, -0.2, 0], weapon: [0.4, -0.3, 0],
    thighL: [0.2, 0, 0.08], shinL: [-0.5, 0, 0], thighR: [-0.25, 0, -0.08], shinR: [-0.35, 0, 0],
    hips: [0.1, 0, 0],
  }), k);
}

function guardBreakPose(p: number): PoseSpec {
  const k = smoothstep(0, 0.35, clamp(p, 0, 1));
  return mix(readyPose(p, zeroCtx), spec({
    spine: [0.4, -0.2, 0], chest: [0.35, -0.3, 0], head: [0.5, -0.15, 0],
    upperArmL: [0.9, 0.6, 0.7], foreArmL: [-0.5, 0.3, 0], shield: [-0.4, 0.9, 0.2],
    upperArmR: [1.0, -0.5, -0.6], foreArmR: [-0.35, -0.2, 0], weapon: [0.6, -0.5, 0],
    thighL: [0.3, 0, 0.1], shinL: [-0.6, 0, 0], thighR: [-0.3, 0, -0.1], shinR: [-0.4, 0, 0],
  }), k);
}

function healPose(p: number): PoseSpec {
  const lift = smoothstep(0, 0.35, p);
  const drink = smoothstep(0.45, 0.7, p) - smoothstep(0.75, 1, p);
  return mix(readyPose(p * 4, zeroCtx), spec({
    spine: [-0.05, 0.1, 0], chest: [0.05, 0.15, 0], head: [-0.12 * drink, 0.05, 0],
    upperArmR: [-1.5 * lift, -0.35, -0.35], foreArmR: [-1.5, -0.3, 0],
    handR: [-0.3, 0, 0], weapon: [-0.2, -0.2, 0],
    shoulderR: [0.1, 0, -0.25],
    upperArmL: [-0.4, 0.4, 0.4], foreArmL: [-1.2, 0.25, 0],
  }), 0.9);
}

function deathPose(p: number): PoseSpec {
  const settle = smoothstep(0.55, 1, clamp(p, 0, 1));
  const fall = spec({
    hips: [0, 0.3, 0], spine: [0.55, 0.2, 0.15], chest: [0.35, 0.2, 0.1], head: [0.6, 0.3, 0.1],
    upperArmL: [0.5, 0.5, 0.9], foreArmL: [-0.4, 0.2, 0],
    upperArmR: [0.9, -0.6, -0.8], foreArmR: [-0.25, -0.2, 0], weapon: [0.9, -0.4, 0.2],
    thighL: [0.7, 0.2, 0.2], shinL: [-1.1, 0, 0], footL: [0.5, 0, 0],
    thighR: [0.2, -0.1, -0.2], shinR: [-0.6, 0, 0], footR: [0.3, 0, 0],
    shoulderL: [0.3, 0, 0.6], shoulderR: [0.4, 0, -0.5],
  }, -0.62, 0.5);
  const flat = spec({
    hips: [0, 0.4, 0.2], spine: [0.75, 0.25, 0.25], chest: [0.4, 0.2, 0.15], head: [0.7, 0.35, 0.15],
    upperArmL: [0.3, 0.9, 1.25], foreArmL: [-0.2, 0.2, 0],
    upperArmR: [0.6, -0.8, -1.1], foreArmR: [-0.15, -0.2, 0], weapon: [1.2, -0.4, 0.3],
    thighL: [0.35, 0.25, 0.25], shinL: [-0.5, 0, 0], footL: [0.3, 0, 0],
    thighR: [0.1, -0.15, -0.25], shinR: [-0.3, 0, 0], footR: [0.2, 0, 0],
    shoulderL: [0.3, 0, 0.6], shoulderR: [0.4, 0, -0.5],
  }, -0.86, 0.75);
  return mix(fall, flat, settle);
}

function interactPose(p: number): PoseSpec {
  const reach = Math.sin(clamp(p, 0, 1) * Math.PI);
  return mix(readyPose(p * 3, zeroCtx), spec({
    spine: [-0.05, -0.15, 0], chest: [0, -0.2, 0], head: [-0.1, -0.15, 0],
    upperArmR: [-1.25 * reach, -0.2, -0.25], foreArmR: [-0.35, -0.1, 0],
    upperArmL: [-0.4, 0.4, 0.4], foreArmL: [-1.15, 0.25, 0],
  }), 0.85);
}

function bossIntroPose(p: number): PoseSpec {
  const raise = smoothstep(0.1, 0.7, p);
  return mix(readyPose(p * 2, zeroCtx), spec({
    spine: [-0.18, 0, 0], chest: [-0.22, 0, 0], head: [-0.3, 0, 0],
    upperArmR: [2.3 * raise, -0.4, -0.5], foreArmR: [-0.9, -0.2, 0], weapon: [-2.6 * raise, -0.3, 0],
    shoulderR: [-0.6 * raise, 0, -0.5],
    upperArmL: [2.1 * raise, 0.4, 0.5], foreArmL: [-0.9, 0.25, 0],
    thighL: [0.1, 0, 0.06], thighR: [-0.14, 0, -0.06],
  }), 0.95);
}

const zeroCtx: AnimContext = { speed: 0, maxSpeed: 1, phase: 0, turnRate: 0, time: 0, healthFraction: 1, guarding: false, lockOn: false };

export interface PoseRequest {
  state: CombatState;
  /** Normalised 0..1 progress through the current state, for the generic poses. */
  phase: number;
  windup?: number;
  active?: number;
  recovery?: number;
  /** Seconds since the action started. Attack poses need this: they are timed in seconds. */
  actionTime?: number;
  attackIndex?: number;
  ctx: AnimContext;
}

export class HumanoidAnimator {
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private current: PoseSpec = readyPose(0, zeroCtx);
  private blendRate = 12;

  constructor(private rig: Rig) { }

  private targetFor(req: PoseRequest): { pose: PoseSpec; rate: number } {
    const { state, phase, ctx } = req;
    switch (state) {
      case 'idle': return { pose: readyPose(ctx.time, ctx), rate: 7 };
      case 'walk': case 'run': case 'sprint': case 'air': return { pose: locomotionPose(ctx), rate: 11 };
      case 'guard': return { pose: guardPose(ctx), rate: 13 };
      case 'guardImpact': return { pose: guardImpactPose(phase), rate: 26 };
      case 'attackWindup': case 'attackActive': case 'attackRecovery': {
        // attack poses are timed in seconds against the track, so they need the raw action
        // clock: feeding them the normalised phase compresses the swing and the blade is still
        // cocked overhead when the hit window opens
        const w = req.windup ?? 0.2, a = req.active ?? 0.2, rc = req.recovery ?? 0.3;
        const t = req.actionTime ?? req.phase * (w + a + rc);
        if (req.attackIndex === 3) return { pose: heavyAttackPose(t, w, a, rc), rate: 22 };
        return { pose: lightAttackPose(req.attackIndex ?? 0, t, w, a, rc), rate: 24 };
      }
      case 'dodge': return { pose: dodgePose(phase), rate: 26 };
      case 'stagger': return { pose: staggerPose(phase), rate: 20 };
      case 'guardBreak': return { pose: guardBreakPose(phase), rate: 18 };
      case 'heal': return { pose: healPose(phase), rate: 12 };
      case 'dead': return { pose: deathPose(phase), rate: 9 };
      case 'interact': return { pose: interactPose(phase), rate: 12 };
      case 'transition': return { pose: bossIntroPose(phase), rate: 8 };
      default: return { pose: readyPose(ctx.time, ctx), rate: 8 };
    }
  }

  /** Apply a pose target with slerp blending. `rootY`/`rootPitch` are applied to the rig root. */
  update(req: PoseRequest, dt: number): void {
    const { pose, rate } = this.targetFor(req);
    this.blendRate = rate;
    const alpha = 1 - Math.exp(-this.blendRate * Math.min(dt, 0.1));
    for (const [name, joint] of this.rig.joints) {
      const target = pose.joints[name] ?? BASE[name];
      if (!target) continue;
      this.tmpE.set(target[0], target[1], target[2], 'YXZ');
      this.tmpQ.setFromEuler(this.tmpE);
      joint.quaternion.slerp(this.tmpQ, alpha);
    }
    // unlisted joints fall back to base
    for (const [name, joint] of this.rig.joints) {
      if (pose.joints[name]) continue;
      const base = BASE[name];
      if (!base) continue;
      this.tmpE.set(base[0], base[1], base[2], 'YXZ');
      this.tmpQ.setFromEuler(this.tmpE);
      joint.quaternion.slerp(this.tmpQ, alpha);
    }
    this.current = pose;
    const ry = pose.rootY, rp = pose.rootPitch;
    this.rig.root.position.y = lerp(this.rig.root.position.y, ry, alpha);
    this.rig.root.rotation.x = lerp(this.rig.root.rotation.x, rp, alpha);
  }

  get lastPose(): PoseSpec { return this.current; }
}

export const DEG_TO_RAD = DEG;
