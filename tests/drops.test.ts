import { describe, it, expect } from 'vitest';
import { applyDeathToDrop, isSafeDropSite, resolveDropPosition, deathMessage } from '../src/core/Drops';
import { MAP_BOUNDS } from '../src/world/LevelData';
import { WORLD } from '../src/config/Balance';

const cp = { x: 0, y: 3, z: 14 };

describe('ember drops', () => {
  it('drops embers exactly where the player died when the site is legal', () => {
    const d = resolveDropPosition(120, { x: -7, y: 0, z: -6 }, null, cp, MAP_BOUNDS);
    expect(d).toEqual({ embers: 120, x: -7, y: 0, z: -6, collected: false });
  });

  it('carrying nothing produces no drop', () => {
    expect(resolveDropPosition(0, { x: 1, y: 0, z: 1 }, null, cp, MAP_BOUNDS)).toBeNull();
  });

  it('a death in the void falls back to the last grounded position', () => {
    const d = resolveDropPosition(50, { x: 5, y: WORLD.voidY - 4, z: -40 }, { x: 4, y: 5, z: -38 }, cp, MAP_BOUNDS);
    expect(d?.y).toBe(5);
    expect(d?.x).toBe(4);
  });

  it('a death outside the map falls back to the checkpoint', () => {
    const d = resolveDropPosition(30, { x: 9999, y: 0, z: 9999 }, null, cp, MAP_BOUNDS);
    expect(d).toEqual({ embers: 30, x: cp.x, y: cp.y, z: cp.z, collected: false });
  });

  it('no drop at all when there is nowhere legal to put it', () => {
    expect(resolveDropPosition(10, { x: 1e6, y: -999, z: 0 }, null, null, MAP_BOUNDS)).toBeNull();
  });

  it('second death forfeits the uncollected pile and reports the loss', () => {
    const first = resolveDropPosition(100, { x: 3, y: 0, z: 3 }, null, cp, MAP_BOUNDS)!;
    const res = applyDeathToDrop(first, 40, { x: -2, y: 0, z: -2 }, null, cp, MAP_BOUNDS);
    expect(res.lost).toBe(100);
    expect(res.drop?.embers).toBe(40);
    expect(deathMessage(res.lost)).toContain('100');
  });

  it('a recovered pile is not counted as a loss', () => {
    const first = { embers: 100, x: 3, y: 0, z: 3, collected: true };
    const res = applyDeathToDrop(first, 40, { x: -2, y: 0, z: -2 }, null, cp, MAP_BOUNDS);
    expect(res.lost).toBe(0);
    expect(deathMessage(0)).toContain('wait');
  });

  it('drop sites are rejected when out of bounds or below the void', () => {
    expect(isSafeDropSite({ x: 0, y: 0, z: 0 }, MAP_BOUNDS)).toBe(true);
    expect(isSafeDropSite({ x: MAP_BOUNDS.maxX + 1, y: 0, z: 0 }, MAP_BOUNDS)).toBe(false);
    expect(isSafeDropSite({ x: 0, y: WORLD.voidY - 1, z: 0 }, MAP_BOUNDS)).toBe(false);
    expect(isSafeDropSite({ x: NaN, y: 0, z: 0 }, MAP_BOUNDS)).toBe(false);
  });
});
