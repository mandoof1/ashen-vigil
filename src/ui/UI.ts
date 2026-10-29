/**
 * Interface layer. All artwork here is original CSS/SVG; fonts are system stacks.
 * Menus own the pointer; while any menu is open the game blocks combat input so a
 * menu click can never become an attack.
 */
import type { QualitySettings, UserSettings, PresetName, ShadowQuality, AAName } from '../config/Quality';
import { UPGRADE_ORDER, upgradeCost, statValue, upgradeLabel, maxLevel, type UpgradeKind } from '../core/Progression';
import type { UpgradeLevels } from '../core/Types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing UI element #${id}`);
  return el as T;
};
const $opt = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

export interface RestPanelData {
  embers: number;
  upgrades: UpgradeLevels;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  flasks: number;
  maxFlasks: number;
  canRest: boolean;
  restBlockedReason: string;
}

export type UIAction =
  | 'continue' | 'newgame' | 'resume' | 'quit' | 'settings' | 'settings-close'
  | 'controls' | 'controls-close' | 'rest' | 'rest-close' | 'respawn'
  | 'victory-continue' | 'victory-menu' | 'confirm-yes' | 'confirm-no'
  | { buy: UpgradeKind };

export class UI {
  private hud = $('hud');
  private hpFill = $('hp-fill');
  private hpGhost = $('hp-ghost');
  private hpText = $('hp-text');
  private stFill = $('st-fill');
  private stText = $('st-text');
  private flaskPips = $('flask-pips');
  private emberCount = $('ember-count');
  private emberLost = $('ember-lost');
  private emberReadout = $('ember-readout');
  private enemyHealth = $('enemy-health');
  private enemyName = $('enemy-name');
  private enemyFill = $('enemy-fill');
  private bossFrame = $('boss-frame');
  private bossName = $('boss-name');
  private bossFill = $('boss-fill');
  private lockReticle = $('lockon-reticle');
  private prompt = $('interact-prompt');
  private promptText = $('interact-text');
  private toasts = $('toast-stack');
  private loreCard = $('lore-card');
  private loreTitle = $('lore-title');
  private loreBody = $('lore-body');
  private tutorialEl = $('tutorial');
  private tutorialKey = $('tutorial-key');
  private tutorialText = $('tutorial-text');
  private perf = $('perf');
  private fade = $('fade') as HTMLDivElement;
  private screens: Record<string, HTMLElement> = {
    main: $('menu-main'),
    pause: $('menu-pause'),
    settings: $('panel-settings'),
    controls: $('panel-controls'),
    rest: $('panel-rest'),
    death: $('death-screen'),
    victory: $('victory-screen'),
    confirm: $('panel-confirm'),
    loading: $('loading'),
    compat: $('compat'),
  };
  private visibleScreens = new Set<string>();
  private lastEmbers = 0;
  private loreTimer = 0;
  private tutorialTimer = 0;
  private pendingTutorial: { key: string; text: string } | null = null;
  public actionHandler: (a: UIAction) => void = () => { };
  public settingsHandler: (q: Partial<QualitySettings>, s: Partial<UserSettings>) => void = () => { };
  private confirmYes: (() => void) | null = null;
  private confirmNo: (() => void) | null = null;
  private damageLayer: HTMLDivElement;

  constructor() {
    this.damageLayer = document.createElement('div');
    this.damageLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:21;overflow:hidden';
    document.getElementById('app')!.appendChild(this.damageLayer);
    this.wire();
    this.buildControlsList();
  }

  // ------------------------------------------------------------------ wiring
  private wire(): void {
    const act = (a: UIAction) => this.actionHandler(a);
    $('btn-continue').addEventListener('click', () => act('continue'));
    $('btn-new').addEventListener('click', () => act('newgame'));
    $('btn-controls-main').addEventListener('click', () => act('controls'));
    $('btn-settings-main').addEventListener('click', () => act('settings'));
    $('btn-resume').addEventListener('click', () => act('resume'));
    $('btn-settings-pause').addEventListener('click', () => act('settings'));
    $('btn-controls-pause').addEventListener('click', () => act('controls'));
    $('btn-quit').addEventListener('click', () => act('quit'));
    $('btn-settings-close').addEventListener('click', () => act('settings-close'));
    $('btn-controls-close').addEventListener('click', () => act('controls-close'));
    $('btn-rest').addEventListener('click', () => act('rest'));
    $('btn-rest-close').addEventListener('click', () => act('rest-close'));
    $('btn-respawn').addEventListener('click', () => act('respawn'));
    $('btn-victory-continue').addEventListener('click', () => act('victory-continue'));
    $('btn-victory-menu').addEventListener('click', () => act('victory-menu'));
    $('btn-confirm-yes').addEventListener('click', () => { this.confirmYes?.(); this.hide('confirm'); });
    $('btn-confirm-no').addEventListener('click', () => { this.confirmNo?.(); this.hide('confirm'); });
    this.bindSettingsInputs();
  }

  private bindSettingsInputs(): void {
    const num = (id: string, fn: (v: number) => void) => {
      const el = $opt<HTMLInputElement>(id);
      el?.addEventListener('input', () => fn(parseFloat(el.value)));
    };
    const bool = (id: string, fn: (v: boolean) => void) => {
      const el = $opt<HTMLInputElement>(id);
      el?.addEventListener('change', () => fn(el.checked));
    };
    const sel = (id: string, fn: (v: string) => void) => {
      const el = $opt<HTMLSelectElement>(id);
      el?.addEventListener('change', () => fn(el.value));
    };
    num('set-scale', (v) => { this.setText('set-scale-val', `${Math.round(v)}%`); this.settingsHandler({ renderScale: v / 100 }, {}); });
    sel('set-preset', (v) => this.settingsHandler({ preset: v as PresetName }, {}));
    sel('set-shadows', (v) => this.settingsHandler({ shadows: v as ShadowQuality }, {}));
    bool('set-bloom', (v) => this.settingsHandler({ bloom: v }, {}));
    sel('set-aa', (v) => this.settingsHandler({ aa: v as AAName }, {}));
    bool('set-adaptive', (v) => this.settingsHandler({ adaptiveResolution: v }, {}));
    bool('set-perf', (v) => this.settingsHandler({ perfOverlay: v }, {}));
    num('set-sens', (v) => { this.setText('set-sens-val', v.toFixed(2)); this.settingsHandler({}, { mouseSensitivity: v }); });
    bool('set-invert', (v) => this.settingsHandler({}, { invertY: v }));
    num('set-shake', (v) => { this.setText('set-shake-val', `${Math.round(v)}%`); this.settingsHandler({}, { shakeAmount: v / 100 }); });
    bool('set-reduced', (v) => this.settingsHandler({}, { reducedMotion: v }));
    bool('set-dmg', (v) => this.settingsHandler({}, { showDamageNumbers: v }));
    num('set-vol', (v) => { this.setText('set-vol-val', `${Math.round(v)}%`); this.settingsHandler({}, { masterVolume: v / 100 }); });
    num('set-sfx', (v) => { this.setText('set-sfx-val', `${Math.round(v)}%`); this.settingsHandler({}, { sfxVolume: v / 100 }); });
    num('set-amb', (v) => { this.setText('set-amb-val', `${Math.round(v)}%`); this.settingsHandler({}, { ambienceVolume: v / 100 }); });
    bool('set-mute', (v) => this.settingsHandler({}, { muted: v }));
    $('set-fullscreen').addEventListener('click', () => {
      const c = document.getElementById('game')!;
      if (!document.fullscreenElement) void c.requestFullscreen?.().catch(() => { });
      else void document.exitFullscreen?.();
    });
    $('set-export').addEventListener('click', () => this.onExport());
    const importEl = $opt<HTMLInputElement>('set-import');
    importEl?.addEventListener('change', () => {
      const file = importEl.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.onImport(String(reader.result ?? ''));
      reader.onerror = () => this.toast('Import failed: unreadable file', 'bad');
      reader.readAsText(file);
    });
  }

  onExport: () => void = () => { };
  onImport: (text: string) => void = () => { };

  private buildControlsList(): void {
    const rows: Array<[string, string[]]> = [
      ['Move', ['W', 'A', 'S', 'D']],
      ['Camera', ['Mouse']],
      ['Light attack (3-hit combo)', ['Left Mouse']],
      ['Guard', ['Right Mouse']],
      ['Heavy attack', ['Q']],
      ['Dodge', ['Space']],
      ['Sprint', ['Shift']],
      ['Heal', ['R']],
      ['Interact', ['E']],
      ['Lock-on', ['Tab']],
      ['Cycle targets', ['F', 'G', 'Mouse wheel']],
      ['Pause / release mouse', ['Esc']],
      ['Controls', ['H']],
    ];
    const host = $('controls-list');
    host.innerHTML = '';
    for (const [label, keys] of rows) {
      const row = document.createElement('div');
      row.className = 'ctrl-row';
      const text = document.createElement('span');
      text.textContent = label;
      const keysEl = document.createElement('span');
      keysEl.className = 'ctrl-keys';
      for (const k of keys) {
        const kb = document.createElement('span');
        kb.className = 'key';
        kb.textContent = k;
        keysEl.appendChild(kb);
      }
      row.appendChild(text);
      row.appendChild(keysEl);
      host.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- screens
  show(name: string): void {
    this.visibleScreens.add(name);
    this.screens[name].classList.remove('hidden');
    const focusEl = this.screens[name].querySelector<HTMLElement>('[data-autofocus]');
    focusEl?.focus();
    document.body.classList.add('menu-open');
  }

  hide(name: string): void {
    this.visibleScreens.delete(name);
    this.screens[name].classList.add('hidden');
    if (this.visibleScreens.size === 0) document.body.classList.remove('menu-open');
  }

  isOpen(): boolean { return this.visibleScreens.size > 0; }
  isOpenNamed(name: string): boolean { return this.visibleScreens.has(name); }
  isPlaying(): boolean { return this.visibleScreens.size === 0; }

  setScreenVisible(name: string, v: boolean): void { v ? this.show(name) : this.hide(name); }

  setLoading(pct: number, text: string): void {
    $('load-fill').style.width = `${Math.round(pct * 100)}%`;
    $('load-text').textContent = text;
  }

  setSaveNote(text: string): void { $('save-note').textContent = text; }
  setContinueEnabled(v: boolean): void { ($('btn-continue') as HTMLButtonElement).disabled = !v; }

  confirm(title: string, body: string, yes: () => void, no: () => void): void {
    $('confirm-title').textContent = title;
    $('confirm-body').textContent = body;
    this.confirmYes = yes;
    this.confirmNo = no;
    this.show('confirm');
  }

  fadeTo(on: boolean): void {
    this.fade.classList.toggle('on', on);
  }

  // -------------------------------------------------------------------- hud
  setHudVisible(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
    document.body.classList.toggle('playing', v);
  }

  setVitals(hp: number, hpMax: number, st: number, stMax: number, flasks: number, flaskMax: number, embers: number, lost: number): void {
    const hpPct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
    this.hpFill.style.width = `${hpPct}%`;
    this.hpGhost.style.width = `${hpPct}%`;
    this.hpText.textContent = `${Math.ceil(hp)} / ${hpMax}`;
    const stPct = Math.max(0, Math.min(100, (st / stMax) * 100));
    this.stFill.style.width = `${stPct}%`;
    this.stText.textContent = `${Math.floor(st)} / ${stMax}`;
    const hpBar = this.hpFill.parentElement as HTMLElement;
    hpBar.classList.toggle('low', hp / hpMax < 0.25);
    const stBar = this.stFill.parentElement as HTMLElement;
    stBar.classList.toggle('breaking', st / stMax < 0.18);

    if (this.flaskPips.childElementCount !== flaskMax) {
      this.flaskPips.innerHTML = '';
      for (let i = 0; i < flaskMax; i++) {
        const p = document.createElement('span');
        p.className = 'pip';
        this.flaskPips.appendChild(p);
      }
    }
    [...this.flaskPips.children].forEach((c, i) => c.classList.toggle('full', i < flasks));

    if (embers !== this.lastEmbers) {
      this.emberCount.textContent = `${embers}`;
      if (embers > this.lastEmbers) {
        this.emberReadout.classList.remove('gain');
        void this.emberReadout.offsetWidth;
        this.emberReadout.classList.add('gain');
      }
      this.lastEmbers = embers;
    }
    this.emberLost.textContent = lost > 0 ? `(${lost} lost)` : '';
  }

  setEnemyHealth(name: string | null, frac: number): void {
    if (!name) { this.enemyHealth.classList.add('hidden'); return; }
    this.enemyHealth.classList.remove('hidden');
    this.enemyName.textContent = name;
    this.enemyFill.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
  }

  setBossHealth(name: string | null, frac: number, phase2: boolean): void {
    if (!name) { this.bossFrame.classList.add('hidden'); return; }
    this.bossFrame.classList.remove('hidden');
    this.bossName.textContent = name;
    this.bossFill.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
    this.bossFill.classList.toggle('phase2', phase2);
  }

  setLockOn(visible: boolean): void { this.lockReticle.classList.toggle('hidden', !visible); }

  setPrompt(text: string | null, key = 'E'): void {
    if (!text) { this.prompt.classList.add('hidden'); return; }
    this.prompt.classList.remove('hidden');
    (this.prompt.firstElementChild as HTMLElement).textContent = key;
    this.promptText.textContent = text;
  }

  toast(message: string, kind: 'good' | 'bad' | 'info' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast${kind === 'bad' ? ' bad' : ''}`;
    el.textContent = message;
    this.toasts.appendChild(el);
    window.setTimeout(() => el.remove(), 3200);
    while (this.toasts.childElementCount > 4) this.toasts.firstChild?.remove();
  }

  showLore(title: string, body: string): void {
    this.loreTitle.textContent = title;
    this.loreBody.textContent = body;
    this.loreCard.classList.remove('hidden');
    this.loreTimer = 9;
  }

  tickLore(dt: number): void {
    if (this.loreTimer > 0) {
      this.loreTimer -= dt;
      if (this.loreTimer <= 0) this.loreCard.classList.add('hidden');
    }
    if (this.tutorialTimer > 0) {
      this.tutorialTimer -= dt;
      if (this.tutorialTimer <= 0) this.tutorialEl.classList.add('hidden');
    }
  }

  tutorial(key: string, text: string, seconds = 7): void {
    this.pendingTutorial = { key, text };
    this.tutorialKey.textContent = key;
    this.tutorialText.textContent = text;
    this.tutorialEl.classList.remove('hidden');
    this.tutorialTimer = seconds;
  }

  hideTutorial(): void {
    this.tutorialEl.classList.add('hidden');
    this.tutorialTimer = 0;
  }

  get lastTutorial(): { key: string; text: string } | null { return this.pendingTutorial; }

  damageNumber(x: number, y: number, amount: number, kind: 'player' | 'chip' | 'good'): void {
    const el = document.createElement('div');
    el.className = `dmg-num ${kind}`;
    el.textContent = kind === 'chip' ? `${amount}` : `${Math.round(amount)}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.damageLayer.appendChild(el);
    window.setTimeout(() => el.remove(), 950);
    while (this.damageLayer.childElementCount > 24) this.damageLayer.firstChild?.remove();
  }

  setPerf(lines: string | null): void {
    if (!lines) { this.perf.classList.add('hidden'); return; }
    this.perf.classList.remove('hidden');
    this.perf.textContent = lines;
  }

  setRenderSize(text: string): void { this.setText('set-render-size', text); }
  setSaveState(text: string): void { this.setText('set-save-state', text); }
  setText(id: string, text: string): void {
    const el = $opt<HTMLElement>(id);
    if (el) el.textContent = text;
  }

  syncSettings(q: QualitySettings, s: UserSettings): void {
    const set = (id: string, v: string | number | boolean) => {
      const el = $opt<HTMLInputElement | HTMLSelectElement>(id);
      if (!el) return;
      if (el instanceof HTMLSelectElement) el.value = String(v);
      else if (el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = String(v);
    };
    set('set-preset', q.preset);
    set('set-scale', Math.round(q.renderScale * 100));
    this.setText('set-scale-val', `${Math.round(q.renderScale * 100)}%`);
    set('set-shadows', q.shadows);
    set('set-bloom', q.bloom);
    set('set-aa', q.aa);
    set('set-adaptive', q.adaptiveResolution);
    set('set-perf', q.perfOverlay);
    set('set-sens', s.mouseSensitivity);
    this.setText('set-sens-val', s.mouseSensitivity.toFixed(2));
    set('set-invert', s.invertY);
    set('set-shake', Math.round(s.shakeAmount * 100));
    this.setText('set-shake-val', `${Math.round(s.shakeAmount * 100)}%`);
    set('set-reduced', s.reducedMotion);
    set('set-dmg', s.showDamageNumbers);
    set('set-vol', Math.round(s.masterVolume * 100));
    this.setText('set-vol-val', `${Math.round(s.masterVolume * 100)}%`);
    set('set-sfx', Math.round(s.sfxVolume * 100));
    this.setText('set-sfx-val', `${Math.round(s.sfxVolume * 100)}%`);
    set('set-amb', Math.round(s.ambienceVolume * 100));
    this.setText('set-amb-val', `${Math.round(s.ambienceVolume * 100)}%`);
    set('set-mute', s.muted);
  }

  // ------------------------------------------------------------ rest panel
  renderRest(data: RestPanelData): void {
    void data;
    const sum = $('rest-summary');
    sum.innerHTML = '';
    const bits = [
      ['Embers', data.embers],
      ['Vitality', `${Math.ceil(data.health)} / ${data.maxHealth}`],
      ['Stamina', `${Math.floor(data.stamina)} / ${data.maxStamina}`],
      ['Emberflask', `${data.flasks} / ${data.maxFlasks}`],
    ];
    for (const [k, v] of bits) {
      const el = document.createElement('span');
      el.innerHTML = `${k}: <b>${v}</b>`;
      sum.appendChild(el);
    }
    const list = $('upgrade-list');
    list.innerHTML = '';
    for (const kind of UPGRADE_ORDER) {
      const level = data.upgrades[kind];
      const cost = upgradeCost(kind, level);
      const cur = statValue(kind, level);
      const next = cost === null ? cur : statValue(kind, level + 1);
      const { name, desc } = upgradeLabel(kind);
      const row = document.createElement('div');
      row.className = 'upgrade';
      const left = document.createElement('div');
      left.innerHTML = `<div class="up-name">${name} <span style="opacity:.6;font-size:11px">Lv ${level}/${maxLevel(kind)}</span></div><div class="up-desc">${desc}</div>`;
      const right = document.createElement('div');
      right.className = 'up-right';
      const flow = document.createElement('div');
      flow.className = 'up-flow';
      flow.innerHTML = `${cur} <span class="next">→ ${next}</span>`;
      right.appendChild(flow);
      if (cost === null) {
        const m = document.createElement('span');
        m.className = 'up-max';
        m.textContent = 'MAXED';
        right.appendChild(m);
      } else {
        const c = document.createElement('span');
        c.className = `up-cost${data.embers < cost ? ' cant' : ''}`;
        c.textContent = `${cost} embers`;
        right.appendChild(c);
        const b = document.createElement('button');
        b.className = 'btn tiny buy';
        b.textContent = 'Buy';
        b.disabled = data.embers < cost;
        b.addEventListener('click', () => this.actionHandler({ buy: kind }));
        right.appendChild(b);
      }
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    }
    const restBtn = $('btn-rest') as HTMLButtonElement;
    restBtn.disabled = !data.canRest;
    $('rest-note').textContent = data.canRest
      ? 'Resting restores vitality and emberflask charges, sets your vigil, and returns fallen guardians to their posts. The Warden stays fallen.'
      : data.restBlockedReason;
  }

  showVictory(lines: string[], credits: string[]): void {
    const host = $('victory-lines');
    host.innerHTML = '';
    for (const l of lines) {
      const p = document.createElement('div');
      p.textContent = l;
      p.style.marginBottom = '10px';
      host.appendChild(p);
    }
    $('credits').innerHTML = credits.map((c) => `${c}`).join('<br>');
    this.show('victory');
  }

  setDeathMessage(text: string): void { $('death-sub').textContent = text; }

  showCompat(reason: string): void {
    $('compat-body').textContent = reason;
    this.show('compat');
    this.hide('loading');
  }
}
