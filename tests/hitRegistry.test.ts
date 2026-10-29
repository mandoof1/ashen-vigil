import { describe, it, expect } from 'vitest';
import { HitRegistry } from '../src/core/HitRegistry';

describe('HitRegistry (per-swing hit de-duplication)', () => {
  it('assigns a unique id to every swing', () => {
    const r = new HitRegistry();
    const a = r.beginAttack();
    const b = r.beginAttack();
    expect(a).not.toBe(b);
  });

  it('a swing hits a given target only once', () => {
    const r = new HitRegistry();
    const atk = r.beginAttack();
    expect(r.tryRecord(atk, 7)).toBe(true);
    expect(r.tryRecord(atk, 7)).toBe(false);
    expect(r.tryRecord(atk, 7)).toBe(false);
    expect(r.hitsFor(atk)).toBe(1);
  });

  it('the same swing can hit different targets', () => {
    const r = new HitRegistry();
    const atk = r.beginAttack();
    expect(r.tryRecord(atk, 1)).toBe(true);
    expect(r.tryRecord(atk, 2)).toBe(true);
    expect(r.hitsFor(atk)).toBe(2);
  });

  it('a new swing may hit the same target again', () => {
    const r = new HitRegistry();
    const a = r.beginAttack();
    r.tryRecord(a, 5);
    r.endAttack(a);
    const b = r.beginAttack();
    expect(r.tryRecord(b, 5)).toBe(true);
  });

  it('hits recorded against a finished swing are rejected', () => {
    const r = new HitRegistry();
    const a = r.beginAttack();
    r.endAttack(a);
    expect(r.isActive(a)).toBe(false);
    expect(r.tryRecord(a, 3)).toBe(false);
  });

  it('history is bounded so long sessions cannot leak memory', () => {
    const r = new HitRegistry();
    for (let i = 0; i < 2000; i++) {
      const a = r.beginAttack();
      r.tryRecord(a, i);
      r.endAttack(a);
    }
    expect(r.recorded.length).toBeLessThanOrEqual(512);
  });
});
