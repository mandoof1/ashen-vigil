/** Graphics presets + user settings. Quality must never change combat timing, AI or collision. */

export type PresetName = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';
export type AAName = 'smaa' | 'fxaa' | 'msaa' | 'none';

export interface QualitySettings {
  preset: PresetName;
  renderScale: number;        // 0.5 .. 1.0 of display pixels
  adaptiveResolution: boolean;
  shadows: ShadowQuality;
  shadowDistance: number;     // metres of shadow-camera extent around the player
  bloom: boolean;
  aa: AAName;
  particles: number;          // 0..1 multiplier on every particle budget
  decorationDensity: number;  // 0..1 fraction of instanced clutter drawn
  vegetationRange: number;    // metres
  lodDistance: number;        // metres at which props switch to the cheap LOD
  anisotropy: number;         // texture anisotropic filtering samples (capped by device)
  fogDensity: number;         // 0..1 multiplier on authored fog
  bakedAO: boolean;
  perfOverlay: boolean;
}

export const DEFAULT_QUALITY: QualitySettings = {
  preset: 'high',
  renderScale: 1,
  adaptiveResolution: false,
  shadows: 'high',
  shadowDistance: 46,
  bloom: true,
  aa: 'smaa',
  particles: 1,
  decorationDensity: 1,
  vegetationRange: 60,
  lodDistance: 26,
  anisotropy: 8,
  fogDensity: 1,
  bakedAO: true,
  perfOverlay: false,
};

export const PRESETS: Record<Exclude<PresetName, 'custom'>, QualitySettings> = {
  low: {
    preset: 'low', renderScale: 0.7, adaptiveResolution: false, shadows: 'low', shadowDistance: 26,
    bloom: false, aa: 'fxaa', particles: 0.35, decorationDensity: 0.45, vegetationRange: 26,
    lodDistance: 14, anisotropy: 2, fogDensity: 0.85, bakedAO: true, perfOverlay: false,
  },
  medium: {
    preset: 'medium', renderScale: 0.85, adaptiveResolution: false, shadows: 'medium', shadowDistance: 34,
    bloom: true, aa: 'fxaa', particles: 0.6, decorationDensity: 0.7, vegetationRange: 40,
    lodDistance: 20, anisotropy: 4, fogDensity: 1, bakedAO: true, perfOverlay: false,
  },
  high: { ...DEFAULT_QUALITY },
  ultra: {
    preset: 'ultra', renderScale: 1, adaptiveResolution: false, shadows: 'high', shadowDistance: 58,
    bloom: true, aa: 'smaa', particles: 1, decorationDensity: 1, vegetationRange: 85,
    lodDistance: 40, anisotropy: 16, fogDensity: 1, bakedAO: true, perfOverlay: false,
  },
};

export interface UserSettings {
  mouseSensitivity: number; // 0.2 .. 3
  invertY: boolean;
  shakeAmount: number;      // 0..1
  reducedMotion: boolean;
  showDamageNumbers: boolean;
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  mouseSensitivity: 1,
  invertY: false,
  shakeAmount: 0.6,
  reducedMotion: false,
  showDamageNumbers: true,
  masterVolume: 0.7,
  sfxVolume: 0.8,
  ambienceVolume: 0.7,
  muted: false,
};

/** Merge partial settings, clamping every value into a legal range. */
export function clampQuality(q: QualitySettings): QualitySettings {
  return {
    ...q,
    renderScale: clamp01to(q.renderScale, 0.5, 1),
    shadowDistance: clamp01to(q.shadowDistance, 12, 80),
    particles: clamp01to(q.particles, 0, 1),
    decorationDensity: clamp01to(q.decorationDensity, 0, 1),
    vegetationRange: clamp01to(q.vegetationRange, 8, 120),
    lodDistance: clamp01to(q.lodDistance, 6, 80),
    anisotropy: clamp01to(q.anisotropy, 1, 16),
    fogDensity: clamp01to(q.fogDensity, 0, 1.4),
  };
}

function clamp01to(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}
