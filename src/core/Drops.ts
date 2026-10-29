import { DEATH, WORLD } from '../config/Balance';
import type { DropState } from './Types';

export interface Vec3Like { x: number; y: number; z: number }

/** A position is only a legal drop site when it is grounded, above the void and inside the map. */
export function isSafeDropSite(p: Vec3Like, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
  return (
    Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) &&
    p.y > WORLD.voidY + 1 &&
    p.x >= bounds.minX && p.x <= bounds.maxX &&
    p.z >= bounds.minZ && p.z <= bounds.maxZ
  );
}

/**
 * Decide where carried embers land.
 * Prefers the death site; falls back to the last safe grounded position, then the checkpoint.
 */
export function resolveDropPosition(
  carried: number,
  death: Vec3Like,
  lastSafe: Vec3Like | null,
  checkpoint: Vec3Like | null,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): DropState | null {
  if (carried <= 0) return null;
  const chosen = isSafeDropSite(death, bounds) ? death : (lastSafe ?? checkpoint);
  if (!chosen) return null;
  const site = isSafeDropSite(chosen, bounds) ? chosen : checkpoint;
  if (!site) return null;
  return { embers: carried, x: site.x, y: site.y, z: site.z, collected: false };
}

/**
 * Consistent second-death rule: an unrecovered drop is forfeited and replaced by the new one.
 * Returns the embers permanently lost by that rule.
 */
export function applyDeathToDrop(
  existing: DropState | null,
  carried: number,
  death: Vec3Like,
  lastSafe: Vec3Like | null,
  checkpoint: Vec3Like | null,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): { drop: DropState | null; lost: number } {
  const lost = existing && !existing.collected ? existing.embers : 0;
  const drop = resolveDropPosition(carried, death, lastSafe, checkpoint, bounds);
  return { drop, lost };
}

export function deathMessage(lost: number): string {
  return lost > 0
    ? `Your embers scattered. ${lost} were lost to the ash.`
    : 'Your embers wait where you fell.';
}

export const DEATH_ANIM = DEATH.animDuration;
