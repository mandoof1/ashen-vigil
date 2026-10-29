/**
 * Browser-local saves. Versioned + validated; corrupt or foreign JSON can never crash
 * the game and is never executed. Storage may be unavailable (private mode) — that is
 * handled as a non-fatal "memory only" mode.
 */
import { SAVE_KEY, SAVE_VERSION, createNewSave, parseSaveJSON, serialiseSave, type SaveValidation } from '../core/SaveFormat';
import { RESPAWN_IDS } from '../world/LevelData';

const LEGAL = { checkpointIds: RESPAWN_IDS };
import type { SaveData } from '../core/Types';

export interface StorageStatus {
  available: boolean;
  reason: string;
}

export class SaveSystem {
  public status: StorageStatus = { available: true, reason: '' };
  private memory: string | null = null;

  constructor() {
    this.status = this.probe();
  }

  private probe(): StorageStatus {
    try {
      const k = '__ashen_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return { available: true, reason: '' };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : 'localStorage blocked' };
    }
  }

  private readRaw(): string | null {
    if (!this.status.available) return this.memory;
    try {
      return window.localStorage.getItem(SAVE_KEY);
    } catch {
      this.status.available = false;
      return this.memory;
    }
  }

  private writeRaw(v: string): void {
    this.memory = v;
    if (!this.status.available) return;
    try {
      window.localStorage.setItem(SAVE_KEY, v);
    } catch (e) {
      this.status.available = false;
      this.status.reason = e instanceof Error ? e.message : 'write failed';
    }
  }

  hasSave(): boolean {
    const raw = this.readRaw();
    if (!raw) return false;
    return parseSaveJSON(raw, LEGAL).ok;
  }

  rawSize(): number {
    return this.readRaw()?.length ?? 0;
  }

  load(): { ok: boolean; data: SaveData | null; reason?: string; version?: number } {
    const raw = this.readRaw();
    if (!raw) return { ok: false, data: null, reason: 'no save' };
    const v: SaveValidation = parseSaveJSON(raw, LEGAL);
    if (!v.ok) return { ok: false, data: null, reason: v.reason };
    return { ok: true, data: v.data, version: v.data.version };
  }

  save(data: SaveData): void {
    data.updatedAt = Date.now();
    data.version = SAVE_VERSION;
    this.writeRaw(serialiseSave(data));
  }

  create(settings: Record<string, unknown>, quality: Record<string, unknown>): SaveData {
    const s = createNewSave(settings, quality);
    this.save(s);
    return s;
  }

  clear(): void {
    this.memory = null;
    if (!this.status.available) return;
    try { window.localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }

  exportJSON(data: SaveData): string {
    return serialiseSave(data);
  }

  importJSON(text: string): SaveValidation {
    const v = parseSaveJSON(text, LEGAL);
    if (v.ok) this.save(v.data);
    return v;
  }
}
