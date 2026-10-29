import { describe, it, expect } from 'vitest';
import { SAVE_VERSION, createNewSave, parseSaveJSON, serialiseSave, validateSave } from '../src/core/SaveFormat';

describe('save format (versioned + validated)', () => {
  it('round-trips a fresh save', () => {
    const s = createNewSave({ mouseSensitivity: 1.4 }, { preset: 'high' });
    s.embers = 421;
    s.shortcuts['gate_courtyard'] = true;
    s.drop = { embers: 90, x: 1, y: 0, z: -4, collected: false };
    const back = parseSaveJSON(serialiseSave(s));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.data.embers).toBe(421);
      expect(back.data.shortcuts['gate_courtyard']).toBe(true);
      expect(back.data.drop?.embers).toBe(90);
      expect(back.data.version).toBe(SAVE_VERSION);
    }
  });

  it('rejects malformed JSON instead of throwing', () => {
    expect(parseSaveJSON('{not json').ok).toBe(false);
    expect(parseSaveJSON('').ok).toBe(false);
    expect(parseSaveJSON('null').ok).toBe(false);
    expect(parseSaveJSON('[]').ok).toBe(false);
  });

  it('rejects saves from a future version rather than guessing', () => {
    const r = validateSave({ version: SAVE_VERSION + 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('newer');
  });

  it('rejects a save with no version', () => {
    expect(validateSave({ embers: 10 }).ok).toBe(false);
  });

  it('fills missing fields with defaults', () => {
    const r = validateSave({ version: SAVE_VERSION });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.embers).toBe(0);
      expect(r.data.upgrades).toEqual({ health: 0, stamina: 0, damage: 0 });
      expect(r.data.checkpointId).toBe('cp_approach');
      expect(r.data.stats.bellRung).toBe(false);
    }
  });

  it('coerces hostile values instead of trusting them', () => {
    const r = validateSave({
      version: SAVE_VERSION,
      embers: '9999',
      upgrades: { health: 999, stamina: -4, damage: 2.7 },
      shortcuts: { gate_courtyard: 'yes', other: true },
      drop: { embers: 5, x: 'abc', y: 0, z: 0 },
      checkpointId: 'x'.repeat(500),
      stats: { deaths: -3, kills: 1e12, bellRung: 'true' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.embers).toBe(0);                       // string is not a number -> default
      expect(r.data.upgrades.health).toBeLessThanOrEqual(5); // clamped to the track cap
      expect(r.data.upgrades.stamina).toBe(0);
      expect(r.data.upgrades.damage).toBe(2);
      expect(r.data.shortcuts['gate_courtyard']).toBe(false); // only literal true counts
      expect(r.data.drop).toBeNull();                        // non-finite coordinate -> no drop
      expect(r.data.checkpointId).toBe('cp_approach');       // over-long string rejected
      expect(r.data.stats.deaths).toBe(0);
      expect(r.data.stats.bellRung).toBe(false);
    }
  });

  it('an old but readable version migrates forward', () => {
    const r = validateSave({ version: 1, embers: 7 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.version).toBe(SAVE_VERSION);
  });

  it('serialised saves contain no executable surprises', () => {
    const text = serialiseSave(createNewSave({}, {}));
    expect(text.startsWith('{')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
