/**
 * Fully procedural Web Audio: no audio files are bundled, so there is nothing to
 * hotlink and nothing to license. The context is created on the first user gesture.
 * Positional cues use PannerNode with distance attenuation.
 */
import type { UserSettings } from '../config/Quality';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windNodes: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private started = false;
  private settings: UserSettings;
  private activeVoices = 0;
  private lastVoiceReset = 0;

  constructor(settings: UserSettings) {
    this.settings = settings;
  }

  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running'; }
  get contextState(): string { return this.ctx?.state ?? 'none'; }

  async start(): Promise<void> {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    this.master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.started = true;
    await ctx.resume();
    this.applyVolumes();
    this.startWind();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.master || !this.sfxBus || !this.ambBus) return;
    const m = this.settings.muted ? 0 : this.settings.masterVolume;
    this.master.gain.value = m;
    this.sfxBus.gain.value = this.settings.sfxVolume;
    this.ambBus.gain.value = this.settings.ambienceVolume * 0.6;
  }

  setSettings(s: UserSettings): void {
    this.settings = s;
    this.applyVolumes();
  }

  private voice(): boolean {
    const now = performance.now();
    if (now - this.lastVoiceReset > 250) { this.activeVoices = 0; this.lastVoiceReset = now; }
    if (this.activeVoices > 22) return false;
    this.activeVoices++;
    return true;
  }

  private panner(x: number, y: number, z: number): PannerNode | null {
    if (!this.ctx) return null;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 3;
    p.maxDistance = 60;
    p.rolloffFactor = 1.1;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    return p;
  }

  private route(pos: { x: number; y: number; z: number } | null): { input: AudioNode; cleanup: () => void } {
    if (!this.ctx || !this.sfxBus) return { input: this.sfxBus ?? this.master!, cleanup: () => { } };
    if (!pos) return { input: this.sfxBus, cleanup: () => { } };
    const p = this.panner(pos.x, pos.y, pos.z);
    if (!p) return { input: this.sfxBus, cleanup: () => { } };
    p.connect(this.sfxBus);
    return { input: p, cleanup: () => { } };
  }

  private tone(opts: {
    freq: number; freqEnd?: number; type?: OscillatorType; gain: number; attack: number; decay: number;
    pos?: { x: number; y: number; z: number } | null; detune?: number;
  }): void {
    if (!this.ctx || !this.voice()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, opts.freq), t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t + opts.decay);
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
    const r = this.route(opts.pos ?? null);
    osc.connect(g); g.connect(r.input);
    osc.start(t); osc.stop(t + opts.decay + 0.05);
  }

  private burst(opts: {
    gain: number; decay: number; type: BiquadFilterType; freq: number; freqEnd?: number; q?: number;
    pos?: { x: number; y: number; z: number } | null; playback?: number;
  }): void {
    if (!this.ctx || !this.noise || !this.voice()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    if (opts.playback) src.playbackRate.value = opts.playback;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), t + opts.decay);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
    const r = this.route(opts.pos ?? null);
    src.connect(f); f.connect(g); g.connect(r.input);
    src.start(t); src.stop(t + opts.decay + 0.05);
  }

  // ------------------------------------------------------------------ cues
  swing(power: number, pos: { x: number; y: number; z: number } | null): void {
    this.burst({ gain: 0.16 * power, decay: 0.22, type: 'bandpass', freq: 1500 * power, freqEnd: 320, q: 1.4, pos });
    this.tone({ freq: 260 * power, freqEnd: 90, type: 'triangle', gain: 0.05, attack: 0.01, decay: 0.18, pos });
  }

  hit(pos: { x: number; y: number; z: number } | null, heavy: boolean): void {
    this.burst({ gain: heavy ? 0.34 : 0.22, decay: heavy ? 0.3 : 0.18, type: 'lowpass', freq: heavy ? 900 : 1600, freqEnd: 200, pos });
    this.tone({ freq: heavy ? 120 : 190, freqEnd: 55, type: 'square', gain: heavy ? 0.12 : 0.07, attack: 0.005, decay: heavy ? 0.24 : 0.14, pos });
  }

  block(pos: { x: number; y: number; z: number } | null): void {
    this.burst({ gain: 0.2, decay: 0.16, type: 'highpass', freq: 2600, freqEnd: 1200, pos });
    this.tone({ freq: 1750, freqEnd: 900, type: 'triangle', gain: 0.09, attack: 0.004, decay: 0.2, pos });
    this.tone({ freq: 2380, freqEnd: 1100, type: 'sine', gain: 0.05, attack: 0.004, decay: 0.26, pos, detune: 22 });
  }

  guardBreak(pos: { x: number; y: number; z: number } | null): void {
    this.burst({ gain: 0.3, decay: 0.5, type: 'bandpass', freq: 900, freqEnd: 180, q: 2.2, pos });
    this.tone({ freq: 420, freqEnd: 70, type: 'sawtooth', gain: 0.14, attack: 0.005, decay: 0.5, pos });
  }

  dodge(pos: { x: number; y: number; z: number } | null): void {
    this.burst({ gain: 0.11, decay: 0.3, type: 'bandpass', freq: 700, freqEnd: 240, q: 0.8, pos });
  }

  heal(pos: { x: number; y: number; z: number } | null): void {
    this.tone({ freq: 520, freqEnd: 880, type: 'sine', gain: 0.1, attack: 0.02, decay: 0.5, pos });
    this.tone({ freq: 780, freqEnd: 1320, type: 'sine', gain: 0.06, attack: 0.03, decay: 0.6, pos, detune: 8 });
    this.burst({ gain: 0.05, decay: 0.3, type: 'highpass', freq: 3000, pos });
  }

  footstep(pos: { x: number; y: number; z: number } | null, sprint: boolean): void {
    this.burst({ gain: sprint ? 0.075 : 0.05, decay: 0.1, type: 'lowpass', freq: sprint ? 900 : 700, freqEnd: 200, pos });
  }

  armorRustle(pos: { x: number; y: number; z: number } | null): void {
    this.burst({ gain: 0.035, decay: 0.14, type: 'highpass', freq: 3200, freqEnd: 1600, pos });
  }

  enemyCue(pos: { x: number; y: number; z: number } | null, low = false): void {
    this.tone({ freq: low ? 90 : 150, freqEnd: low ? 46 : 70, type: 'sawtooth', gain: 0.12, attack: 0.05, decay: low ? 0.9 : 0.5, pos });
    this.burst({ gain: 0.06, decay: 0.5, type: 'lowpass', freq: 500, freqEnd: 160, pos });
  }

  death(pos: { x: number; y: number; z: number } | null): void {
    this.burst({ gain: 0.24, decay: 0.6, type: 'lowpass', freq: 1200, freqEnd: 120, pos });
    this.tone({ freq: 220, freqEnd: 48, type: 'triangle', gain: 0.1, attack: 0.01, decay: 0.7, pos });
  }

  pickup(pos: { x: number; y: number; z: number } | null): void {
    this.tone({ freq: 880, freqEnd: 1320, type: 'sine', gain: 0.09, attack: 0.005, decay: 0.35, pos });
    this.tone({ freq: 1320, freqEnd: 1760, type: 'sine', gain: 0.05, attack: 0.005, decay: 0.4, pos });
  }

  ui(kind: 'click' | 'confirm' | 'back' | 'deny'): void {
    const map = { click: 660, confirm: 880, back: 420, deny: 220 } as const;
    this.tone({ freq: map[kind], freqEnd: kind === 'deny' ? 160 : map[kind] * 1.3, type: 'sine', gain: 0.05, attack: 0.004, decay: 0.14, pos: null });
  }

  checkpoint(activate: boolean): void {
    if (!this.ctx || !this.ambBus) return;
    if (activate) {
      this.tone({ freq: 196, freqEnd: 392, type: 'sine', gain: 0.12, attack: 0.05, decay: 1.6, pos: null });
      this.tone({ freq: 294, freqEnd: 588, type: 'sine', gain: 0.07, attack: 0.08, decay: 1.8, pos: null });
      this.burst({ gain: 0.06, decay: 1.2, type: 'lowpass', freq: 700, freqEnd: 240, pos: null });
    }
  }

  bell(power = 1): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const partials = [1, 1.62, 2.11, 2.73, 3.41, 4.02];
    const base = 138;
    for (let i = 0; i < partials.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * partials[i];
      const g = ctx.createGain();
      const amp = (0.22 / (i + 1.2)) * power;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5 + i * 0.6);
      osc.connect(g); g.connect(this.sfxBus);
      osc.start(t); osc.stop(t + 6.6 + i * 0.6);
    }
    this.burst({ gain: 0.12 * power, decay: 1.4, type: 'lowpass', freq: 900, freqEnd: 120, pos: null });
  }

  bossStinger(): void {
    this.tone({ freq: 70, freqEnd: 42, type: 'sawtooth', gain: 0.16, attack: 0.4, decay: 2.6, pos: null });
    this.tone({ freq: 104, freqEnd: 62, type: 'triangle', gain: 0.1, attack: 0.5, decay: 2.8, pos: null });
    this.burst({ gain: 0.1, decay: 2.2, type: 'lowpass', freq: 420, freqEnd: 90, pos: null });
  }

  gate(): void {
    this.burst({ gain: 0.22, decay: 1.1, type: 'lowpass', freq: 800, freqEnd: 140, pos: null });
    this.tone({ freq: 140, freqEnd: 60, type: 'square', gain: 0.08, attack: 0.02, decay: 1.0, pos: null });
  }

  private startWind(): void {
    if (!this.ctx || !this.noise || !this.ambBus || this.windNodes) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.35;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    src.connect(filter); filter.connect(gain); gain.connect(this.ambBus);
    src.start();
    // slow gusts
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.09;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();
    this.windNodes = { src, gain, filter };
  }

  dispose(): void {
    try { this.windNodes?.src.stop(); } catch { /* already stopped */ }
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
