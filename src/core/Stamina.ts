import { STAMINA } from '../config/Balance';

export interface StaminaTickContext {
  guarding: boolean;
  sprinting: boolean;
  busy: boolean; // attacking, dodging, healing, staggered: regeneration is suppressed
}

/**
 * Stamina pool. Pure logic (unit tested).
 * - never negative
 * - actions are refused when the cost cannot be paid (no debt, no input-mashing bypass)
 * - regeneration only starts after `regenDelayAfterUse`, and is reduced/suppressed by context
 */
export class StaminaPool {
  private _max: number;
  private _current: number;
  private _regenTimer = 0;
  /** set when stamina hit zero while blocking; the owner must play the guard-break state */
  public breakPending = false;

  constructor(max: number) {
    this._max = Math.max(1, max);
    this._current = this._max;
  }

  get max(): number { return this._max; }
  get current(): number { return this._current; }
  get fraction(): number { return this._current / this._max; }
  get regenPending(): boolean { return this._regenTimer > 0; }
  get canAct(): boolean { return this._regenTimer <= 0; }

  setMax(max: number, keepFraction = false): void {
    const f = keepFraction ? this.fraction : 1;
    this._max = Math.max(1, max);
    this._current = Math.min(this._max, this._max * f);
  }

  set(value: number): void {
    this._current = Math.min(this._max, Math.max(0, value));
  }

  restore(): void {
    this._current = this._max;
    this._regenTimer = 0;
    this.breakPending = false;
  }

  /** Attempt to pay a cost. Returns false (and changes nothing) when it cannot be afforded. */
  spend(cost: number): boolean {
    if (!(cost > 0)) return true;
    if (this._current + 1e-9 < cost) return false;
    this._current -= cost;
    this._regenTimer = STAMINA.regenDelayAfterUse;
    return true;
  }

  /** Unconditional drain (sprint, held guard, chip damage). Clamps at zero. */
  drain(amount: number): void {
    if (!(amount > 0)) return;
    this._current = Math.max(0, this._current - amount);
    this._regenTimer = STAMINA.regenDelayAfterUse;
  }

  /** Drain used by a blocked hit; flags a guard break when it empties the pool. */
  drainFromBlock(amount: number): boolean {
    if (!(amount > 0)) return this._current <= 0;
    this._current = Math.max(0, this._current - amount);
    this._regenTimer = STAMINA.regenDelayAfterUse;
    if (this._current <= 1e-6) {
      this.breakPending = true;
      return true;
    }
    return false;
  }

  /** Advance regeneration. Returns the amount regenerated (for tests / debug). */
  tick(dt: number, ctx: StaminaTickContext): number {
    if (this._regenTimer > 0) {
      this._regenTimer = Math.max(0, this._regenTimer - dt);
      return 0;
    }
    if (this._current >= this._max) return 0;
    let rate: number = STAMINA.regenRate;
    if (ctx.busy || ctx.sprinting) return 0;
    if (ctx.guarding) rate = STAMINA.regenRateGuarding;
    const before = this._current;
    this._current = Math.min(this._max, this._current + rate * dt);
    return this._current - before;
  }
}
