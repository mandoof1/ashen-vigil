import type { ActorId, HitRecord } from './Types';

/**
 * Attack instance bookkeeping: unique swing ids + per-swing hit de-duplication.
 * A swing may only damage a given target once (unless the attack def opts in).
 */
export class HitRegistry {
  private nextId = 1;
  private hits = new Map<number, Set<ActorId>>();
  private limits = new Map<number, number>();
  private alive = new Set<number>();
  private history: HitRecord[] = [];

  beginAttack(maxHitsPerTarget = 1): number {
    const id = this.nextId++;
    this.hits.set(id, new Set());
    this.limits.set(id, Math.max(1, maxHitsPerTarget));
    this.alive.add(id);
    return id;
  }

  endAttack(id: number): void {
    this.alive.delete(id);
    this.hits.delete(id);
    this.limits.delete(id);
  }

  isActive(id: number): boolean {
    return this.alive.has(id);
  }

  /** Record a hit. Returns false when this swing has already hit this target. */
  tryRecord(attackId: number, target: ActorId): boolean {
    if (!this.alive.has(attackId)) return false;
    let set = this.hits.get(attackId);
    if (!set) {
      set = new Set();
      this.hits.set(attackId, set);
    }
    if (set.has(target)) return false;
    set.add(target);
    this.history.push({ attackId, target });
    if (this.history.length > 512) this.history.shift();
    return true;
  }

  hitsFor(attackId: number): number {
    return this.hits.get(attackId)?.size ?? 0;
  }

  get nextAttackId(): number {
    return this.nextId;
  }

  /** Debug/test helper: every (attack,target) pair recorded so far. */
  get recorded(): readonly HitRecord[] {
    return this.history;
  }

  clear(): void {
    this.hits.clear();
    this.limits.clear();
    this.alive.clear();
  }
}
