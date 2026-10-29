/**
 * Keyboard + mouse input. Pointer Lock is only requested from a user gesture.
 * Held keys are cleared on blur and on pointer-lock loss; combat input is ignored
 * while any menu is open (the game sets `inputBlocked`).
 */

export type KeyId =
  | 'forward' | 'back' | 'left' | 'right'
  | 'lightAttack' | 'guard' | 'sprint' | 'dodge' | 'heavy'
  | 'interact' | 'heal' | 'lockOn' | 'cycleNext' | 'cyclePrev'
  | 'pause' | 'help' | 'up' | 'down';

const KEY_MAP: Record<string, KeyId> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'dodge',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyQ: 'heavy',
  KeyE: 'interact',
  KeyR: 'heal',
  Tab: 'lockOn',
  KeyF: 'cycleNext', KeyG: 'cyclePrev',
  Escape: 'pause',
  KeyH: 'help',
  KeyJ: 'up', KeyK: 'down',
};

const PREVENT_DEFAULT = new Set(['Space', 'Tab', 'KeyE', 'KeyR', 'KeyQ', 'KeyF', 'KeyG', 'KeyH', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class InputState {
  private held = new Set<KeyId>();
  private edgeAt = new Map<KeyId, number>();
  private mouseButtons = new Set<number>();
  private mouseEdgeAt = new Map<number, number>();
  public mouseDX = 0;
  public mouseDY = 0;
  public wheel = 0;
  public pointerLocked = false;
  public inputBlocked = true;
  public sensitivity = 1;
  public invertY = false;
  private canvas: HTMLCanvasElement;
  private disposers: Array<() => void> = [];
  public onPointerLockLost: (() => void) | null = null;
  /** Menu-level keys fire synchronously so pause/help stay responsive even at 1 fps. */
  public onGlobalKey: ((id: 'pause' | 'help') => void) | null = null;
  public wantsLock = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bind();
  }

  private bind(): void {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      const id = KEY_MAP[e.code];
      if (!id) return;
      if (id === 'pause' || id === 'help') {
        this.edgeAt.set(id, performance.now());
        this.onGlobalKey?.(id);
        return; // live in every state
      }
      if (this.inputBlocked) return;
      this.held.add(id);
      this.edgeAt.set(id, performance.now());
    };
    const up = (e: KeyboardEvent) => {
      const id = KEY_MAP[e.code];
      if (!id) return;
      this.held.delete(id);
    };
    const kd = (e: KeyboardEvent) => down(e);
    const ku = (e: KeyboardEvent) => up(e);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.disposers.push(() => window.removeEventListener('keydown', kd));
    this.disposers.push(() => window.removeEventListener('keyup', ku));

    const blur = () => this.clearAll();
    window.addEventListener('blur', blur);
    this.disposers.push(() => window.removeEventListener('blur', blur));

    const ctx = (e: Event) => { if (!this.inputBlocked) e.preventDefault(); };
    this.canvas.addEventListener('contextmenu', ctx);
    this.disposers.push(() => this.canvas.removeEventListener('contextmenu', ctx));

    const wheel = (e: WheelEvent) => {
      if (this.inputBlocked) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    };
    window.addEventListener('wheel', wheel, { passive: false });
    this.disposers.push(() => window.removeEventListener('wheel', wheel));

    const mousedown = (e: MouseEvent) => {
      if (this.inputBlocked) return;
      if (!this.pointerLocked) { this.requestLock(); return; }
      this.mouseButtons.add(e.button);
      this.mouseEdgeAt.set(e.button, performance.now());
    };
    const mouseup = (e: MouseEvent) => { this.mouseButtons.delete(e.button); };
    this.canvas.addEventListener('mousedown', mousedown);
    window.addEventListener('mouseup', mouseup);
    this.disposers.push(() => this.canvas.removeEventListener('mousedown', mousedown));
    this.disposers.push(() => window.removeEventListener('mouseup', mouseup));

    const mm = (e: MouseEvent) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    document.addEventListener('mousemove', mm);
    this.disposers.push(() => document.removeEventListener('mousemove', mm));

    const plc = () => {
      const locked = document.pointerLockElement === this.canvas;
      const was = this.pointerLocked;
      this.pointerLocked = locked;
      if (!locked && was) {
        this.clearAll();
        this.onPointerLockLost?.();
      }
    };
    document.addEventListener('pointerlockchange', plc);
    this.disposers.push(() => document.removeEventListener('pointerlockchange', plc));
  }

  requestLock(): void {
    this.wantsLock = true;
    const p = this.canvas.requestPointerLock?.() as unknown;
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch(() => { /* user gesture required; retried on next click */ });
    }
  }

  exitLock(): void {
    this.wantsLock = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  clearAll(): void {
    this.held.clear();
    this.edgeAt.clear();
    this.mouseButtons.clear();
    this.mouseEdgeAt.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
  }

  isHeld(id: KeyId): boolean { return this.held.has(id); }

  /** Consume a press edge exactly once (short input buffer is handled by the caller). */
  takeEdge(id: KeyId): boolean {
    const t = this.edgeAt.get(id);
    if (t === undefined) return false;
    this.edgeAt.delete(id);
    return performance.now() - t < 250;
  }

  peekEdge(id: KeyId): boolean { return this.edgeAt.has(id); }

  takeMouseButton(button: number): boolean {
    const t = this.mouseEdgeAt.get(button);
    if (t === undefined) return false;
    this.mouseEdgeAt.delete(button);
    return performance.now() - t < 250;
  }

  mouseHeld(button: number): boolean { return this.mouseButtons.has(button); }

  /** Camera deltas, scaled by sensitivity, with invert-Y applied. Cleared each render frame. */
  takeLook(): { dx: number; dy: number } {
    const dx = this.mouseDX * 0.0022 * this.sensitivity;
    const dy = this.mouseDY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Drop buffered presses that were never consumed, so stale inputs cannot fire later. */
  endFrame(): void {
    const now = performance.now();
    for (const [k, t] of this.edgeAt) if (now - t > 150 && k !== 'pause' && k !== 'help') this.edgeAt.delete(k);
    for (const [k, t] of this.mouseEdgeAt) if (now - t > 150) this.mouseEdgeAt.delete(k);
  }

  /**
   * Test hook: synthesise one frame of input without DOM events.
   * 'attack' maps to mouse button 0 and 'guard' to mouse button 2, matching the real bindings.
   */
  setScripted(keys: string[]): void {
    this.held.clear();
    this.mouseButtons.clear();
    const now = performance.now();
    for (const k of keys) {
      if (k === 'attack') { this.mouseButtons.add(0); this.mouseEdgeAt.set(0, now); }
      else if (k === 'guard') { this.mouseButtons.add(2); }
      else if (['interact', 'heal', 'dodge', 'heavy', 'lockOn', 'pause', 'help'].includes(k)) this.edgeAt.set(k as KeyId, now);
      else this.held.add(k as KeyId);
    }
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
