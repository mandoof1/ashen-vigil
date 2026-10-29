import { describe, it, expect } from 'vitest';
import { StaminaPool } from '../src/core/Stamina';
import { STAMINA } from '../src/config/Balance';

describe('StaminaPool', () => {
  it('starts full and never exceeds max', () => {
    const s = new StaminaPool(100);
    expect(s.current).toBe(100);
    s.restore();
    s.tick(10, { guarding: false, sprinting: false, busy: false });
    expect(s.current).toBe(100);
  });

  it('refuses a cost it cannot pay and changes nothing', () => {
    const s = new StaminaPool(50);
    expect(s.spend(60)).toBe(false);
    expect(s.current).toBe(50);
  });

  it('pays a cost it can afford', () => {
    const s = new StaminaPool(50);
    expect(s.spend(20)).toBe(true);
    expect(s.current).toBeCloseTo(30);
  });

  it('never goes negative under repeated drains', () => {
    const s = new StaminaPool(10);
    for (let i = 0; i < 50; i++) s.drain(3);
    expect(s.current).toBe(0);
    expect(s.spend(1)).toBe(false);
  });

  it('blocks regeneration inside the post-use delay, then regenerates', () => {
    const s = new StaminaPool(100);
    s.spend(40);
    expect(s.tick(0.1, { guarding: false, sprinting: false, busy: false })).toBe(0);
    const waited = STAMINA.regenDelayAfterUse + 0.001;
    s.tick(waited, { guarding: false, sprinting: false, busy: false });
    const gained = s.tick(1, { guarding: false, sprinting: false, busy: false });
    expect(gained).toBeGreaterThan(0);
    expect(s.current).toBeGreaterThan(60);
  });

  it('suppresses regeneration while sprinting or busy', () => {
    const s = new StaminaPool(100);
    s.spend(40);
    s.tick(STAMINA.regenDelayAfterUse + 1, { guarding: false, sprinting: false, busy: false });
    s.set(50);
    expect(s.tick(1, { guarding: false, sprinting: true, busy: false })).toBe(0);
    expect(s.tick(1, { guarding: false, sprinting: false, busy: true })).toBe(0);
    expect(s.current).toBe(50);
  });

  it('regenerates more slowly while guarding', () => {
    const a = new StaminaPool(100); a.set(50);
    const b = new StaminaPool(100); b.set(50);
    const idle = a.tick(1, { guarding: false, sprinting: false, busy: false });
    const guard = b.tick(1, { guarding: true, sprinting: false, busy: false });
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(idle);
  });

  it('flags a guard break exactly when blocking drains the pool dry', () => {
    const s = new StaminaPool(30);
    expect(s.drainFromBlock(10)).toBe(false);
    expect(s.current).toBeCloseTo(20);
    expect(s.drainFromBlock(25)).toBe(true);
    expect(s.current).toBe(0);
    expect(s.breakPending).toBe(true);
  });

  it('setMax keeps the pool legal', () => {
    const s = new StaminaPool(100);
    s.set(80);
    s.setMax(50);
    expect(s.current).toBeLessThanOrEqual(50);
    s.setMax(200);
    expect(s.current).toBeLessThanOrEqual(200);
  });

  it('is deterministic across different step sizes (frame-rate independent total regen)', () => {
    const mk = () => { const s = new StaminaPool(100); s.spend(60); return s; };
    const run = (steps: number, dt: number) => {
      const s = mk();
      for (let i = 0; i < steps; i++) s.tick(dt, { guarding: false, sprinting: false, busy: false });
      return s.current;
    };
    const a = run(120, 1 / 60);
    const b = run(240, 1 / 120);
    expect(Math.abs(a - b)).toBeLessThan(0.6);
  });
});
