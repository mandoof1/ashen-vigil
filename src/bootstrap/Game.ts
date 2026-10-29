/**
 * Game orchestrator: owns the fixed-step simulation order, world state, saves,
 * interactions, and the UI/audio glue.
 *
 * Simulation order per fixed step:
 *   input -> player transitions -> player movement -> physics step -> AI think + move
 *   -> pose update -> attack queries + damage -> death/stagger -> interactions
 *   -> checkpoints/pickups/triggers -> UI
 * Rendering interpolates actor transforms and never changes simulation speed.
 */
import * as THREE from 'three';
import { Graphics, type Emitter } from '../render/Graphics';
import { buildMaterials, type MaterialLibrary } from '../render/Materials';
import { PhysicsWorld } from '../physics/Physics';
import { NavigationGraph } from '../world/Navigation';
import { LevelBuilder } from '../world/LevelBuilder';
import { CheckpointFlame, EmberDrop, PickupObject, Portcullis } from '../world/WorldObjects';
import { ARENA, BOSS_SPAWN, BOSS_TRIGGER, BELL, CHECKPOINTS, GATE, MAP_BOUNDS, PICKUPS, RESPAWN_IDS, SPAWNS, SPAWN_START, type CheckpointDef } from '../world/LevelData';
import { InputState } from '../input/Input';
import { CameraRig, type LockInfo } from '../camera/CameraRig';
import { CombatSystem } from '../combat/Combat';
import { Effects } from '../fx/Effects';
import { AudioEngine } from '../audio/Audio';
import { UI, type UIAction } from '../ui/UI';
import { SaveSystem } from '../systems/Saves';
import { EventBus } from '../core/Events';
import type { SaveData } from '../core/Types';
import type { Actor } from '../entities/Actor';
import { Player } from '../entities/Player';
import { Enemy, type CombatGroup } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { createBoss, createEnemy, createPlayer } from '../entities/ActorFactory';
import { applyUpgrade, statValue, type UpgradeKind } from '../core/Progression';
import { DEFAULT_QUALITY, DEFAULT_SETTINGS, PRESETS, clampQuality, type QualitySettings, type UserSettings } from '../config/Quality';
import { BOSS as BOSSCFG, CAMERA, CHECKPOINT, COMBAT, DEATH, PLAYER, SIM, WORLD, WORLD_REWARDS } from '../config/Balance';
import { applyDeathToDrop, deathMessage } from '../core/Drops';
import { createNewSave } from '../core/SaveFormat';
import { clamp, wrapAngle } from '../core/MathX';

export type GameState = 'boot' | 'menu' | 'playing' | 'paused' | 'dead' | 'victory' | 'resting';

interface InteractionPoint {
  id: string;
  x: number; y: number; z: number;
  radius: number;
  prompt: string;
  enabled: () => boolean;
  action: () => void;
}

export interface DebugFlags { enabled: boolean; showVolumes: boolean }

export class Game {
  readonly canvas: HTMLCanvasElement;
  graphics!: Graphics;
  phys!: PhysicsWorld;
  input!: InputState;
  camera!: THREE.PerspectiveCamera;
  cam!: CameraRig;
  ui!: UI;
  audio!: AudioEngine;
  effects!: Effects;
  combat!: CombatSystem;
  nav!: NavigationGraph;
  saves = new SaveSystem();
  events = new EventBus();
  mats!: MaterialLibrary;

  quality: QualitySettings = { ...DEFAULT_QUALITY };
  settings: UserSettings = { ...DEFAULT_SETTINGS };

  state: GameState = 'boot';
  save!: SaveData;

  player!: Player;
  enemies: Enemy[] = [];
  boss!: Boss;
  private byCollider = new Map<number, Actor>();
  private groups = new Map<string, CombatGroup>();
  private checkpoints: Array<{ def: CheckpointDef; flame: CheckpointFlame }> = [];
  private pickups: PickupObject[] = [];
  private gate!: Portcullis;
  private emberDrop!: EmberDrop;
  private interactions: InteractionPoint[] = [];
  private emitters: Emitter[] = [];
  private barrier: THREE.Mesh | null = null;
  private barrierCollider: { remove(): void } | null = null;
  private levelBuilder!: LevelBuilder;
  private levelLODs: Array<{ hi: THREE.Object3D; lo: THREE.Object3D; center: THREE.Vector3; radius: number }> = [];
  private levelClusters: Array<{ object: THREE.Object3D; center: THREE.Vector3; radius: number; kind: string }> = [];

  private accumulator = 0;
  private lastTime = 0;
  private simTime = 0;
  private frameTimes: number[] = [];
  private perfTimer = 0;
  private hitStop = 0;
  private deathTimer = 0;
  private pendingDeathMessage = '';
  private bossFightActive = false;
  private bossDefeated = false;
  private bellRung = false;
  private currentCheckpoint = 'spawn';
  private respawnPoint = { x: SPAWN_START.x, y: SPAWN_START.y, z: SPAWN_START.z, yaw: SPAWN_START.yaw };
  private lockTarget: Actor | null = null;
  private lockCandidates: Actor[] = [];
  private tutorialFlags = new Set<string>();
  private distanceTravelled = 0;
  private firstCheckpointDone = false;
  private firstDeathDone = false;
  private debug: DebugFlags = { enabled: false, showVolumes: false };
  private disposers: Array<() => void> = [];
  private frameHandle = 0;
  private lastSafeGround = new THREE.Vector3(SPAWN_START.x, SPAWN_START.y, SPAWN_START.z);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  // ------------------------------------------------------------------- boot
  async boot(): Promise<void> {
    this.ui = new UI();
    this.ui.setLoading(0.05, 'Reading the old records…');
    this.loadSettingsFromStorage();
    this.graphics = new Graphics(this.canvas, this.quality);
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.25, 260);
    this.graphics.setCamera(this.camera);
    this.cam = new CameraRig(this.camera, SPAWN_START.yaw);
    this.input = new InputState(this.canvas);
    this.input.sensitivity = this.settings.mouseSensitivity;
    this.input.invertY = this.settings.invertY;
    this.audio = new AudioEngine(this.settings);
    this.effects = new Effects(this.graphics.scene);
    this.mats = buildMaterials(this.graphics.anisotropy);
    this.ui.setLoading(0.15, 'Forging physics…');
    this.phys = await PhysicsWorld.create();
    this.combat = new CombatSystem(this.phys, this.events, this.byCollider);
    this.nav = new NavigationGraph();

    this.ui.setLoading(0.3, 'Raising the sanctuary…');
    this.levelBuilder = new LevelBuilder(this.phys, this.mats);
    const built = this.levelBuilder.build();
    this.graphics.scene.add(built.group);
    this.levelLODs = built.lodPairs;
    this.levelClusters = built.clusters;
    this.emitters = this.levelBuilder.emitters.map((e) => ({ ...e }));

    this.ui.setLoading(0.55, 'Validating the paths…');
    // Rapier's query pipeline is refreshed by a step; nav validation queries the world,
    // so at least one step must happen before it.
    this.phys.step();
    this.nav.build(this.phys);
    this.phys.step();

    this.ui.setLoading(0.7, 'Lighting the vigil fires…');
    this.buildWorldObjects();
    this.buildActors();

    this.ui.setLoading(0.9, 'Restoring the keeper…');
    this.wireUI();
    this.resize();
    this.bindWindowEvents();
    this.prepareMenu();
    this.ui.setLoading(1, 'Ready');
    window.setTimeout(() => this.ui.hide('loading'), 220);
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.loop);
  }

  private loadSettingsFromStorage(): void {
    try {
      const raw = window.localStorage.getItem('ashen_vigil_settings');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { quality?: Partial<QualitySettings>; settings?: Partial<UserSettings> };
      if (parsed.quality) this.quality = clampQuality({ ...DEFAULT_QUALITY, ...parsed.quality });
      if (parsed.settings) this.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      if (this.quality.preset !== 'custom' && PRESETS[this.quality.preset]) {
        this.quality = clampQuality({ ...PRESETS[this.quality.preset], ...this.quality, preset: this.quality.preset });
      }
    } catch { /* first run or corrupt settings: defaults are fine */ }
  }

  private persistSettings(): void {
    try {
      window.localStorage.setItem('ashen_vigil_settings', JSON.stringify({ quality: this.quality, settings: this.settings }));
    } catch { /* settings persistence is best-effort */ }
  }

  private prepareMenu(): void {
    const has = this.saves.hasSave();
    this.ui.setContinueEnabled(has);
    const load = this.saves.load();
    this.ui.setSaveNote(
      this.saves.status.available
        ? (has && load.data ? `Vigil recorded — ${load.data.embers} embers, ${Object.keys(load.data.pickups).length} relic(s), ${load.data.stats.deaths} unmaking(s).` : 'No vigil recorded in this browser yet.')
        : `Browser storage unavailable (${this.saves.status.reason}). Progress lasts until you close the tab.`,
    );
    this.ui.setSaveState(this.saves.status.available ? (has ? 'present' : 'none') : 'memory only');
    this.ui.syncSettings(this.quality, this.settings);
    this.ui.show('main');
    this.state = 'menu';
    this.input.inputBlocked = true;
  }

  // ------------------------------------------------------------ world build
  private buildWorldObjects(): void {
    for (const def of CHECKPOINTS) {
      const flame = new CheckpointFlame(def, this.mats);
      this.graphics.scene.add(flame.group);
      this.checkpoints.push({ def, flame });
    }
    for (const def of PICKUPS) {
      const p = new PickupObject(def, this.mats);
      this.graphics.scene.add(p.group);
      this.pickups.push(p);
    }
    this.gate = new Portcullis(GATE.x, GATE.y, GATE.z, GATE.width, GATE.height, GATE.thickness, this.mats, this.phys, GATE.leverX, GATE.leverY, GATE.leverZ, GATE.yaw);
    this.graphics.scene.add(this.gate.group, this.gate.lever);
    this.emberDrop = new EmberDrop(this.mats);
    this.graphics.scene.add(this.emberDrop.group);

    // the bell itself is part of the level geometry; register its interaction point
    this.interactions.push({
      id: 'bell', x: BELL.x, y: BELL.y, z: BELL.z + 3, radius: 4.2,
      prompt: 'Ring the last bell',
      enabled: () => this.bossDefeated && !this.bellRung,
      action: () => this.ringBell(),
    });
    this.interactions.push({
      id: 'gate_lever', x: GATE.leverX, y: GATE.leverY, z: GATE.leverZ, radius: 2.6,
      prompt: `Raise the ${GATE.name}`,
      enabled: () => !this.save.shortcuts[GATE.id],
      action: () => this.openGate(),
    });
    for (const cp of this.checkpoints) {
      this.interactions.push({
        id: cp.def.id, x: cp.def.x, y: cp.def.y, z: cp.def.z, radius: 2.6,
        prompt: 'Rest at the Vigil Flame',
        enabled: () => true,
        action: () => this.openRest(cp.def),
      });
    }
    for (const p of this.pickups) {
      if (p.def.kind !== 'lore') continue;
      this.interactions.push({
        id: p.def.id, x: p.def.x, y: p.def.y, z: p.def.z, radius: 2.4,
        prompt: 'Read the inscription',
        enabled: () => !this.save.lore[p.def.id],
        action: () => this.readLore(p),
      });
    }
  }

  private buildActors(): void {
    this.player = createPlayer(this.phys, this.graphics.anisotropy, this.save?.upgrades ?? { health: 0, stamina: 0, damage: 0 }, this.save?.embers ?? 0, this.maxFlasks(), SPAWN_START.x, SPAWN_START.y, SPAWN_START.z, SPAWN_START.yaw);
    this.player.events = this.events;
    this.player.combat = this.combat;
    this.graphics.scene.add(this.player.visual);
    this.byCollider.set(this.player.body.collider.handle, this.player);

    let id = 2;
    for (const spawn of SPAWNS) {
      const e = createEnemy(this.phys, this.graphics.anisotropy, spawn, id++);
      e.events = this.events;
      e.combat = this.combat;
      this.graphics.scene.add(e.visual);
      this.enemies.push(e);
      this.byCollider.set(e.body.collider.handle, e);
    }
    this.boss = createBoss(this.phys, this.graphics.anisotropy, id++, BOSS_SPAWN.x, BOSS_SPAWN.y, BOSS_SPAWN.z);
    this.boss.events = this.events;
    this.boss.combat = this.combat;
    this.boss.arenaCenter.set(ARENA.cx, ARENA.cz);
    this.boss.arenaHalf = ARENA.half;
    this.graphics.scene.add(this.boss.visual);
    this.byCollider.set(this.boss.body.collider.handle, this.boss);
    this.groups.set('all', { active: 0, maxActive: 2 });
  }

  private maxFlasks(): number {
    return PLAYER.flaskCharges + (this.save?.pickups['p_flask'] ? WORLD_REWARDS.flaskUpgradeCharges : 0);
  }

  // -------------------------------------------------------------- game start
  startNewGame(): void {
    this.save = createNewSave({ ...this.settings }, { ...this.quality });
    this.saves.save(this.save);
    this.applyWorldFromSave(true);
    this.beginPlay();
  }

  continueGame(): void {
    const load = this.saves.load();
    if (!load.ok || !load.data) {
      this.startNewGame();
      return;
    }
    this.save = load.data;
    this.settings = { ...DEFAULT_SETTINGS, ...(this.save.settings as Partial<UserSettings>) };
    this.quality = clampQuality({ ...DEFAULT_QUALITY, ...(this.save.quality as Partial<QualitySettings>) });
    this.applyQuality();
    this.applyWorldFromSave(false);
    this.beginPlay();
  }

  /** Where the Warden-bearer wakes: the last Vigil Flame they rested at, or the gate they arrived through. */
  private respawnDef(): CheckpointDef {
    return CHECKPOINTS.find((c) => c.id === this.currentCheckpoint) ?? { id: 'spawn', name: 'The Fallen Gate', x: SPAWN_START.x, y: SPAWN_START.y, z: SPAWN_START.z };
  }

  private applyWorldFromSave(fresh: boolean): void {
    this.tutorialFlags = new Set(Object.keys(this.save.tutorialSeen ?? {}).filter((k) => this.save.tutorialSeen[k]));
    this.bossDefeated = !!this.save.bossesDefeated['warden'];
    this.bellRung = !!this.save.stats.bellRung;
    if (!RESPAWN_IDS.includes(this.save.checkpointId)) this.save.checkpointId = 'spawn';
    if (fresh) this.save.checkpointId = 'spawn';   // a new vigil begins at the fallen gate, not at a lit flame
    this.currentCheckpoint = this.save.checkpointId;
    const cp = this.respawnDef();
    this.respawnPoint = { x: cp.x, y: cp.y, z: cp.z, yaw: cp.id === 'spawn' ? SPAWN_START.yaw : 0 };

    for (const p of this.pickups) p.setCollected(!!this.save.pickups[p.def.id]);
    for (const c of this.checkpoints) c.flame.setActivated(c.def.id === this.currentCheckpoint);

    if (this.save.shortcuts[GATE.id]) this.applyGateOpen(false);

    if (fresh) {
      this.emberDrop.hide();
      this.save.drop = null;
    } else if (this.save.drop && !this.save.drop.collected) {
      this.emberDrop.show(this.save.drop.x, this.save.drop.y, this.save.drop.z);
    } else {
      this.emberDrop.hide();
    }

    this.player.applyUpgrades(this.save.upgrades);
    this.player.embers = this.save.embers;
    this.player.maxFlasks = this.maxFlasks();
    this.player.flasks = this.player.maxFlasks;
    this.player.health = this.player.maxHealth;
    this.player.stamina.restore();
    this.player.teleport(this.respawnPoint.x, this.respawnPoint.y, this.respawnPoint.z, this.respawnPoint.yaw);
    this.player.setState('idle');
    this.player.alive = true;
    this.lastSafeGround.set(this.respawnPoint.x, this.respawnPoint.y, this.respawnPoint.z);

    this.resetEnemies(true);
    if (this.bossDefeated) {
      this.boss.resetBoss(BOSS_SPAWN.x, BOSS_SPAWN.y, BOSS_SPAWN.z, 0);
      this.boss.startDeath();
      this.boss.dying = false;
      this.boss.defeated = true;
      this.boss.alive = false;
      this.boss.setState('dead');
      this.boss.health = 0;
    } else {
      this.boss.resetBoss(BOSS_SPAWN.x, BOSS_SPAWN.y, BOSS_SPAWN.z, 0);
      this.boss.visual.visible = false;
    }
    this.bossFightActive = false;
    this.removeBarrier();
    this.effects.reset();
    this.combat.clear();
    this.lockTarget = null;
    this.cam.snapBehind(this.player.yaw);
  }

  private beginPlay(): void {
    this.state = 'playing';
    this.ui.hide('main');
    this.ui.setHudVisible(true);
    this.input.inputBlocked = false;
    this.input.clearAll();
    void this.audio.start();
    this.audio.resume();
    this.input.requestLock();
    this.deathTimer = 0;
    this.ui.hide('death');
    this.ui.hide('victory');
    this.ui.tutorial('W A S D', 'Move through the fallen approach toward the sanctuary');
  }

  // ------------------------------------------------------------- world state
  private resetEnemies(fullReset: boolean): void {
    for (const e of this.enemies) {
      if (!e.alive || fullReset) {
        const spawn = SPAWNS.find((s) => s.id === this.enemySpawnId(e));
        e.resetFromWorld(Math.PI);
        e.visual.visible = true;
        void spawn;
      }
    }
    // corpses are bounded: the effects pool caps how many remain visible
    this.effects.clearCorpses();
    const g = this.groups.get('all');
    if (g) g.active = 0;
  }

  private enemySpawnId(e: Enemy): string {
    for (let i = 0; i < SPAWNS.length; i++) {
      const s = SPAWNS[i];
      if (s.type === e.kind && Math.abs((s.home?.[0] ?? s.x) - e.home.x) < 0.01 && Math.abs((s.home?.[1] ?? s.z) - e.home.z) < 0.01) return s.id;
    }
    return '';
  }

  private applyGateOpen(withSound: boolean): void {
    if (this.gate.opened) return;
    this.gate.open();
    // find and remove the gate collider so movement + navigation agree with the visuals
    const found = this.findGateCollider();
    if (found) this.phys.remove(found);
    // the query pipeline must see the removal before the navigation graph is re-validated
    this.phys.step();
    this.nav.build(this.phys);
    if (withSound) this.audio.gate();
  }

  private gateColliderHandle = -1;

  private findGateCollider(): import('../physics/Physics').Collider | null {
    if (this.gateColliderHandle >= 0) {
      try { return this.phys.world.getCollider(this.gateColliderHandle); } catch { return null; }
    }
    // the gate collider is the last blocker-shaped cuboid created near the gate
    let bestHandle = -1;
    let bestD = 1e9;
    this.phys.world.forEachCollider((c: import('../physics/Physics').Collider) => {
      const t = c.translation();
      const d = Math.abs(t.x - GATE.x) + Math.abs(t.y - (GATE.y + GATE.height / 2)) + Math.abs(t.z - GATE.z);
      if (d < bestD) { bestD = d; bestHandle = c.handle; }
    });
    if (bestHandle >= 0) this.gateColliderHandle = bestHandle;
    return this.findGateCollider();
  }

  private openGate(): void {
    this.applyGateOpen(true);
    this.save.shortcuts[GATE.id] = true;
    this.saves.save(this.save);
    this.ui.toast('The portcullis rises', 'good');
    this.effects.dustPuff(GATE.x, GATE.y, GATE.z, 2);
  }

  private readLore(p: PickupObject): void {
    if (!p.def.title || !p.def.text) return;
    this.save.lore[p.def.id] = true;
    this.saves.save(this.save);
    this.ui.showLore(p.def.title, p.def.text);
    this.audio.pickup({ x: p.def.x, y: p.def.y + 1, z: p.def.z });
  }

  // -------------------------------------------------------------- interaction
  private updateInteractions(): void {
    const p = this.player.rawPosition;
    let best: InteractionPoint | null = null;
    let bestD = Infinity;
    for (const it of this.interactions) {
      if (!it.enabled()) continue;
      const d = Math.hypot(it.x - p.x, it.y - p.y * 1.0, it.z - p.z);
      const dy = Math.abs(it.y - p.y);
      if (dy > 3.2) continue;
      const planar = Math.hypot(it.x - p.x, it.z - p.z);
      if (planar > it.radius) continue;
      if (d < bestD) { bestD = d; best = it; }
    }
    this.ui.setPrompt(best ? best.prompt : null);
    if (best && this.input.takeEdge('interact')) {
      best.action();
      return;
    }

    // proximity pickups
    for (const pk of this.pickups) {
      if (pk.collected || pk.def.kind === 'lore') continue;
      const d = Math.hypot(pk.def.x - p.x, pk.def.z - p.z);
      if (d < 1.9 && Math.abs(pk.def.y - p.y) < 2.4) this.collectPickup(pk);
    }

    // ember recovery
    if (this.emberDrop.visible) {
      const d = Math.hypot(this.emberDrop.group.position.x - p.x, this.emberDrop.group.position.z - p.z);
      if (d < 2.0 && Math.abs(this.emberDrop.group.position.y - p.y) < 2.6) this.recoverDrop();
    }

    // boss trigger
    if (!this.bossFightActive && !this.bossDefeated) {
      const d = Math.hypot(BOSS_TRIGGER.x - p.x, BOSS_TRIGGER.z - p.z);
      if (d < BOSS_TRIGGER.radius && Math.abs(BOSS_TRIGGER.y - p.y) < 4) this.startBossFight();
    }
  }

  private collectPickup(pk: PickupObject): void {
    pk.setCollected(true);
    this.save.pickups[pk.def.id] = true;
    if (pk.def.kind === 'embers') {
      const amount = pk.def.amount ?? WORLD_REWARDS.emberCache;
      this.player.embers += amount;
      this.ui.toast(`${amount} embers gathered`, 'good');
      this.effects.pickupBurst(pk.def.x, pk.def.y, pk.def.z);
    } else if (pk.def.kind === 'flask') {
      this.player.maxFlasks = this.maxFlasks();
      this.player.flasks = this.player.maxFlasks;
      this.ui.toast('Emberflask capacity increased', 'good');
      this.effects.pickupBurst(pk.def.x, pk.def.y + 0.6, pk.def.z, [1, 0.85, 0.5]);
    }
    this.saves.save(this.save);
    this.audio.pickup({ x: pk.def.x, y: pk.def.y + 0.5, z: pk.def.z });
  }

  private recoverDrop(): void {
    const drop = this.save.drop;
    this.emberDrop.hide();
    if (!drop || drop.collected) return;
    drop.collected = true;
    this.player.embers += drop.embers;
    this.save.embers = this.player.embers;
    this.save.drop = null;
    this.saves.save(this.save);
    this.ui.toast(`${drop.embers} embers recovered`, 'good');
    this.effects.pickupBurst(this.emberDrop.group.position.x, this.emberDrop.group.position.y, this.emberDrop.group.position.z);
    this.audio.pickup({ x: drop.x, y: drop.y, z: drop.z });
  }

  // ------------------------------------------------------------------ rest
  private openRest(def: CheckpointDef): void {
    const threat = this.nearbyThreat(def);
    const data = {
      embers: this.player.embers,
      upgrades: this.save.upgrades,
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      stamina: this.player.stamina.current,
      maxStamina: this.player.stamina.max,
      flasks: this.player.flasks,
      maxFlasks: this.player.maxFlasks,
      canRest: threat === '',
      restBlockedReason: threat,
    };
    this.ui.renderRest(data);
    this.ui.show('rest');
    this.state = 'resting';
    this.input.inputBlocked = true;
    this.input.exitLock();
    this.input.clearAll();
    for (const c of this.checkpoints) c.flame.setActivated(c.def.id === def.id);
    this.currentCheckpoint = def.id;
    this.save.checkpointId = def.id;
    this.respawnPoint = { x: def.x, y: def.y, z: def.z, yaw: 0 };
    this.saves.save(this.save);
    this.audio.checkpoint(true);
    if (!this.firstCheckpointDone) {
      this.firstCheckpointDone = true;
      this.markTutorial('checkpoint');
      this.ui.toast('A Vigil Flame answers', 'good');
    }
  }

  private nearbyThreat(def: CheckpointDef): string {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const p = e.rawPosition;
      const d = Math.hypot(p.x - def.x, p.z - def.z);
      if (d < CHECKPOINT.threatRange && (e.ai === 'pursue' || e.ai === 'attack' || e.ai === 'alert' || e.ai === 'reposition' || d < 7)) {
        return 'Guardians are close. Deal with them before resting.';
      }
    }
    if (this.bossFightActive) return 'The Warden is bound to the chamber. It cannot be rested away.';
    return '';
  }

  private doRest(): void {
    this.player.health = this.player.maxHealth;
    this.player.stamina.restore();
    this.player.flasks = this.player.maxFlasks;
    this.player.alive = true;
    this.resetEnemies(true);
    this.saves.save(this.save);
    this.ui.toast('The flame restores you', 'good');
    this.audio.checkpoint(true);
    this.closeRest();
  }

  private closeRest(): void {
    this.ui.hide('rest');
    this.state = 'playing';
    this.input.inputBlocked = false;
    this.input.clearAll();
    this.input.requestLock();
  }

  private buyUpgrade(kind: UpgradeKind): void {
    const wallet = { embers: this.player.embers, upgrades: this.save.upgrades };
    const res = applyUpgrade(wallet, kind);
    if (!res.ok) {
      this.audio.ui('deny');
      this.ui.toast(res.reason === 'maxed' ? 'This path is already complete' : 'Not enough embers', 'bad');
      return;
    }
    this.player.embers = wallet.embers;
    this.save.embers = wallet.embers;
    this.save.upgrades = wallet.upgrades;
    const hpBefore = this.player.maxHealth, stBefore = this.player.maxStamina();
    this.player.applyUpgrades(wallet.upgrades);
    this.player.health += this.player.maxHealth - hpBefore;
    this.player.stamina.set(this.player.stamina.current + (this.player.stamina.max - stBefore));
    this.saves.save(this.save);
    this.audio.ui('confirm');
    this.ui.toast(`${kind === 'health' ? 'Vitality' : kind === 'stamina' ? 'Stamina' : 'Weapon'} raised to ${kind === 'health' ? this.player.maxHealth : kind === 'stamina' ? this.player.stamina.max : this.player.weaponDamage}`, 'good');
    this.openRest(this.respawnDef());
  }

  // ------------------------------------------------------------------- boss
  private startBossFight(): void {
    this.bossFightActive = true;
    this.boss.visual.visible = true;
    this.boss.resetBoss(BOSS_SPAWN.x, BOSS_SPAWN.y, BOSS_SPAWN.z, Math.PI);
    this.boss.beginIntro();
    this.addBarrier();
    this.audio.bossStinger();
    this.ui.toast('The Bellbound Warden stirs', 'bad');
    this.markTutorial('lockon');
  }

  private addBarrier(): void {
    if (this.barrier) return;
    const geo = new THREE.PlaneGeometry(8, 10, 1, 1);
    this.barrier = new THREE.Mesh(geo, this.mats.barrier);
    this.barrier.position.set(BOSS_TRIGGER.x, BOSS_TRIGGER.y + 4, BOSS_TRIGGER.z - 0.6);
    this.graphics.scene.add(this.barrier);
    const col = this.phys.barrierBox(BOSS_TRIGGER.x, BOSS_TRIGGER.y + 4, BOSS_TRIGGER.z - 0.6, 4.2, 6, 0.4);
    this.barrierCollider = { remove: () => this.phys.remove(col) };
  }

  private removeBarrier(): void {
    if (this.barrier) {
      this.graphics.scene.remove(this.barrier);
      this.barrier.geometry.dispose();
      this.barrier = null;
    }
    this.barrierCollider?.remove();
    this.barrierCollider = null;
  }

  private onBossDefeated(): void {
    this.bossDefeated = true;
    this.bossFightActive = false;
    this.save.bossesDefeated['warden'] = true;
    this.player.embers += BOSSCFG.rewardEmbers;
    this.save.embers = this.player.embers;
    this.saves.save(this.save);
    this.removeBarrier();
    this.ui.setBossHealth(null, 0, false);
    this.ui.toast('The Warden is unbound', 'good');
    this.audio.bell(0.7);
    this.effects.deathBurst(this.boss.rawPosition.x, this.boss.rawPosition.y, this.boss.rawPosition.z);
  }

  private ringBell(): void {
    this.bellRung = true;
    this.save.stats.bellRung = true;
    this.saves.save(this.save);
    this.audio.bell(1);
    this.effects.pickupBurst(BELL.x, BELL.y + 3, BELL.z, [1, 0.8, 0.45]);
    this.effects.dustPuff(BELL.x, BELL.y, BELL.z, 3);
    this.ui.hideTutorial();
    this.state = 'victory';
    this.input.inputBlocked = true;
    this.input.exitLock();
    window.setTimeout(() => {
      this.ui.showVictory(
        [
          'The bell answers. The sound crosses the valley and does not stop.',
          'Where it passes, the hollow armour settles, and the watch is finally ended.',
          'You are the last keeper of Ashen Vigil, and the last bell has been rung.',
        ],
        [
          'ASHEN VIGIL: THE LAST BELL',
          'Original code, geometry, animation, lighting and audio — generated for this project.',
          `Deaths: ${this.save.stats.deaths} · Guardians fallen: ${this.save.stats.kills} · Embers carried: ${this.player.embers}`,
        ],
      );
    }, 1600);
  }

  // ------------------------------------------------------------------- death
  private onPlayerDeath(): void {
    this.save.stats.deaths++;
    const p = this.player.rawPosition;
    const cp = this.respawnDef();
    const carried = this.player.embers;
    const res = applyDeathToDrop(
      this.save.drop, carried,
      { x: p.x, y: p.y, z: p.z },
      { x: this.lastSafeGround.x, y: this.lastSafeGround.y, z: this.lastSafeGround.z },
      { x: cp.x, y: cp.y, z: cp.z },
      MAP_BOUNDS,
    );
    this.player.embers = 0;
    this.save.embers = 0;
    this.save.drop = res.drop;
    this.pendingDeathMessage = deathMessage(res.lost);
    if (res.drop) this.emberDrop.show(res.drop.x, res.drop.y, res.drop.z);
    else this.emberDrop.hide();
    this.saves.save(this.save);
    this.deathTimer = 0;
    this.state = 'dead';
    this.audio.death({ x: p.x, y: p.y, z: p.z });
    this.effects.deathBurst(p.x, p.y, p.z);
    if (!this.firstDeathDone) {
      this.firstDeathDone = true;
      this.markTutorial('death');
    }
  }

  private respawn(): void {
    this.ui.hide('death');
    this.state = 'playing';
    this.input.inputBlocked = false;
    this.input.clearAll();
    this.player.alive = true;
    this.player.health = this.player.maxHealth;
    this.player.stamina.restore();
    this.player.flasks = this.player.maxFlasks;
    this.player.setState('idle');
    this.player.actionTime = 0;
    this.player.invulnTimer = 0;
    this.player.currentTrack = null;
    this.player.attackId = -1;
    this.player.teleport(this.respawnPoint.x, this.respawnPoint.y, this.respawnPoint.z, this.respawnPoint.yaw);
    this.lastSafeGround.set(this.respawnPoint.x, this.respawnPoint.y, this.respawnPoint.z);
    this.cam.snapBehind(this.player.yaw);
    this.resetEnemies(true);
    if (!this.bossDefeated) {
      this.boss.resetBoss(BOSS_SPAWN.x, BOSS_SPAWN.y, BOSS_SPAWN.z, Math.PI);
      this.boss.visual.visible = false;
      this.bossFightActive = false;
      this.removeBarrier();
      this.ui.setBossHealth(null, 0, false);
    }
    this.combat.clear();
    this.effects.reset();
    this.lockTarget = null;
    this.input.requestLock();
    void this.audio.start();
    this.audio.resume();
  }

  // ------------------------------------------------------------- main loop
  private loop = (now: number): void => {
    this.frameHandle = requestAnimationFrame(this.loop);
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.25);
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();

    if (this.state === 'playing' || this.state === 'dead') {
      this.accumulator = Math.min(this.accumulator + dt, 0.25);
      let steps = 0;
      while (this.accumulator >= SIM_FIXED && steps < 5) {
        this.fixedUpdate(SIM_FIXED);
        this.accumulator -= SIM_FIXED;
        steps++;
      }
    } else {
      this.accumulator = 0;
    }

    this.render(dt);
    this.updatePerf(dt);
    this.input.endFrame();
  };

  /** Pause + the controls overlay are driven straight from the key event: they work in
   * every state and never wait for a simulation step (important when frames are slow). */
  private togglePauseKey(): void {
    if (performance.now() - this.lastToggle < 250) return;
    if (this.ui.isOpenNamed('controls')) { this.ui.hide('controls'); this.lastToggle = performance.now(); return; }
    if (this.ui.isOpenNamed('settings')) { this.ui.hide('settings'); this.lastToggle = performance.now(); return; }
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
    else if (this.state === 'resting') this.closeRest();
  }

  private toggleHelp(): void {
    if (this.state === 'menu' || this.state === 'boot' || this.state === 'victory') return;
    if (this.ui.isOpenNamed('controls')) this.ui.hide('controls');
    else this.ui.show('controls');
  }

  static readonly SIM_FIXED = SIM.fixedDt;

  private fixedUpdate(dt: number): void {
    this.simTime += dt;
    const group = this.groups.get('all')!;

    // 1. player intent + transitions
    const lockDir = this.lockTarget && this.lockTarget.alive
      ? (() => {
        const t = this.lockTarget!.rawPosition, p = this.player.rawPosition;
        const n = Math.hypot(t.x - p.x, t.z - p.z) || 1;
        return { x: (t.x - p.x) / n, z: (t.z - p.z) / n };
      })()
      : null;
    this.player.update(dt, this.input, this.cam.yaw, this.phys, this.events, lockDir);

    // 2. physics advances the authoritative positions
    this.phys.step();

    // 3. AI
    for (const e of this.enemies) {
      if (!e.alive && e.deathTime > 6) continue;
      e.update(dt, this.player, this.phys, this.nav, this.events, this.combat, group, false);
    }
    if (this.bossFightActive || this.boss.visual.visible) {
      this.boss.update(dt, this.player, this.phys, this.nav, this.events, this.combat, group, true);
    }

    // 4. poses (so hit queries use the rendered blade) — hit-stop freezes animation only
    const poseDt = this.hitStop > 0 ? 0 : dt;
    this.updateActorPose(this.player, dt, poseDt);
    for (const e of this.enemies) this.updateActorPose(e, dt, poseDt);
    if (this.boss.visual.visible) this.updateActorPose(this.boss, dt, poseDt);

    // 5. attacks + damage.
    // Hit queries read the blade's world transform, so the actor roots are snapped to the
    // authoritative physics position first: a swing can never be evaluated against a stale pose.
    this.player.syncVisual(1);
    for (const e of this.enemies) e.syncVisual(1);
    if (this.boss.visual.visible) this.boss.syncVisual(1);
    this.combat.tick(dt, this.byCollider.values());
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - dt);
    this.combat.endFrame(dt);

    // 6. deaths
    if (this.player.alive && this.player.health <= 0) {
      this.player.kill();
      this.onPlayerDeath();
    }
    for (const e of this.enemies) {
      if (!e.alive && e.deathTime === 0) {
        e.deathTime = dt;
        this.save.stats.kills++;
        this.player.embers += e.emberDrop;
        this.save.embers = this.player.embers;
        this.effects.deathBurst(e.rawPosition.x, e.rawPosition.y, e.rawPosition.z);
        this.audio.death({ x: e.rawPosition.x, y: e.rawPosition.y, z: e.rawPosition.z });
        this.saves.save(this.save);
      }
    }
    // safety net: any damage path that empties the bar must reach the death sequence,
    // even if it wrote health directly instead of going through applyDamage
    if (this.boss.alive && this.boss.health <= 0) { this.boss.alive = false; this.boss.startDeath(); }
    if (this.bossFightActive && this.boss.dying && !this.bossDefeated && this.boss.victoryTimer > 1.4) {
      this.onBossDefeated();
    }

    // 7. void death
    const pp = this.player.rawPosition;
    if (this.player.alive && pp.y < WORLD.voidY && !this.testDisableVoidDeath) {
      this.player.health = 0;
    }
    if (this.player.alive && this.player.grounded) this.lastSafeGround.set(pp.x, pp.y, pp.z);

    // 8. interactions / triggers
    if (this.state === 'playing') this.updateInteractions();

    // 9. lock-on
    this.updateLockOn(dt);

    // 10. tutorial
    this.updateTutorial();

    // 11. death screen timing
    if (this.state === 'dead') {
      this.deathTimer += dt;
      if (this.deathTimer > DEATH.messageDelay && !this.ui.isOpen()) {
        this.ui.setDeathMessage(this.pendingDeathMessage);
        this.ui.show('death');
        this.input.inputBlocked = true;
        this.input.exitLock();
        this.input.clearAll();
      }
    }

  }

  private updateActorPose(actor: Actor, dt: number, poseDt: number): void {
    const speed = actor instanceof Player ? actor.speed : (actor instanceof Enemy ? Math.hypot(actor.velX, actor.velZ) : 0);
    const maxSpeed = actor instanceof Player ? PLAYER.sprintSpeed : actor instanceof Enemy ? actor.def.runSpeed : BOSSCFG.def.runSpeed;
    const turnRate = actor instanceof Player ? actor.turnRate : 0;
    const isBoss = actor instanceof Boss;
    const track = actor.currentTrack;
    actor.updatePose({
      state: actor.state,
      phase: actor.actionTime / Math.max(0.001, track ? track.windup + track.active + track.recovery : 1),
      actionTime: actor.actionTime,
      windup: track?.windup,
      active: track?.active,
      recovery: track?.recovery,
      attackIndex: actor.attackIndex,
      ctx: actor.animContext(speed, maxSpeed, turnRate, this.simTime),
    }, poseDt);
    if (isBoss && (actor as Boss).introActive) {
      actor.animator.update({ state: 'transition', phase: (actor as Boss).introTimer / 2.4, ctx: actor.animContext(0, 1, 0, this.simTime) }, poseDt);
    }
    void dt;
  }

  private updateLockOn(dt: number): void {
    const p = this.player.rawPosition;
    this.lockCandidates = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const ep = e.rawPosition;
      if (Math.hypot(ep.x - p.x, ep.z - p.z) > 26) continue;
      this.lockCandidates.push(e);
    }
    if (this.bossFightActive && this.boss.alive) this.lockCandidates.push(this.boss);

    if (this.input.takeEdge('lockOn')) {
      this.lockTarget = this.lockTarget ? null : this.pickLockTarget();
      this.audio.ui('click');
    }
    const wheel = this.input.takeWheel();
    if (wheel !== 0 && this.lockCandidates.length > 0) {
      const idx = this.lockTarget ? this.lockCandidates.indexOf(this.lockTarget) : -1;
      const next = (idx + (wheel > 0 ? 1 : -1) + this.lockCandidates.length) % this.lockCandidates.length;
      this.lockTarget = this.lockCandidates[next];
    }
    if (this.input.takeEdge('cycleNext') || this.input.takeEdge('cyclePrev')) this.lockTarget = this.pickLockTarget();
    if (this.lockTarget && (!this.lockTarget.alive || Math.hypot(this.lockTarget.rawPosition.x - p.x, this.lockTarget.rawPosition.z - p.z) > 30)) {
      this.lockTarget = null;
    }
    this.ui.setLockOn(!!this.lockTarget);

    // enemy health readout for the current lock target
    const t = this.lockTarget;
    if (t && !(t instanceof Boss)) this.ui.setEnemyHealth((t as Enemy).def.name, t.healthFraction);
    else if (!this.bossFightActive) this.ui.setEnemyHealth(null, 0);
    if (this.bossFightActive) {
      this.ui.setBossHealth(this.boss.alive || this.boss.dying ? BOSSCFG.def.name : null, this.boss.healthFraction, this.boss.phase === 2);
    }
    void dt;
  }

  private pickLockTarget(): Actor | null {
    const p = this.player.rawPosition;
    const camDir = this.cam.viewDirection;
    let best: Actor | null = null;
    let bestScore = -Infinity;
    for (const c of this.lockCandidates) {
      const cp = c.rawPosition;
      const dx = cp.x - p.x, dz = cp.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = (dx / d) * camDir.x + (dz / d) * camDir.z;
      const score = dot * 2 - d * 0.04;
      if (dot > 0.1 && score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  private markTutorial(id: string): void {
    this.tutorialFlags.add(id);
    this.save.tutorialSeen[id] = true;
    this.saves.save(this.save);
  }

  private updateTutorial(): void {
    const p = this.player.rawPosition;
    this.distanceTravelled += Math.hypot(this.player.velX, this.player.velZ) * SIM_FIXED;
    const seen = (id: string) => this.tutorialFlags.has(id) || !!this.save.tutorialSeen[id];
    if (!seen('move') && this.distanceTravelled > 6) {
      this.markTutorial('move');
      this.ui.tutorial('Mouse', 'Move the mouse to look around. Esc releases the mouse and pauses.');
    } else if (seen('move') && !seen('combat') && this.distanceTravelled > 20) {
      this.markTutorial('combat');
      this.ui.tutorial('LMB', 'Light attack (three-hit combo) · Space to dodge · Shift to sprint');
    } else if (!seen('guard') && this.player.state === 'guard') {
      this.markTutorial('guard');
    } else if (!seen('heal') && this.player.flasks < this.player.maxFlasks) {
      this.markTutorial('heal');
      this.ui.tutorial('R', 'Drink the emberflask to restore vitality');
    } else if (!seen('boss') && p.z < -14 && p.x > -12 && p.x < 12) {
      this.markTutorial('boss');
      this.ui.tutorial('Tab', 'Lock on to the Warden. Its area attacks are shown on the floor — dodge out of them.');
    }
    void COMBAT;
  }

  // --------------------------------------------------------------- rendering
  private render(dt: number): void {
    const alpha = clamp(this.accumulator / Game.SIM_FIXED, 0, 1);
    this.player.syncVisual(this.state === 'playing' || this.state === 'dead' ? alpha : 1);
    for (const e of this.enemies) e.syncVisual(this.state === 'playing' ? alpha : 1);
    if (this.boss.visual.visible) this.boss.syncVisual(this.state === 'playing' ? alpha : 1);

    // camera
    const pp = this.player.renderPos;
    let lock: LockInfo | null = null;
    if (this.lockTarget && this.lockTarget.alive) {
      const t = this.lockTarget.visual.position;
      lock = { x: t.x, y: t.y, z: t.z, height: this.lockTarget.visual.scale.y * 1.6, distance: Math.hypot(t.x - pp.x, t.z - pp.z) };
    }
    this.cam.update(dt, {
      x: pp.x, y: pp.y, z: pp.z,
      yaw: this.player.renderYaw,
      speed: this.player.speed,
      sprinting: this.player.sprinting,
      eyeHeight: PLAYER.eyeHeight * 0.9,
    }, this.phys, lock, { shakeScale: this.settings.shakeAmount, reducedMotion: this.settings.reducedMotion });

    // world updates
    for (const c of this.checkpoints) this.emitterUpdate(c.flame.update(dt), c.def.id === this.currentCheckpoint ? 1.4 : 0.5);
    // the Warden carries its own light: the bell in its chest is the only warm thing in the chamber
    if (this.boss.visual.visible) {
      const b = this.boss.visual.position;
      this.emitterUpdate({ x: b.x, y: b.y + this.boss.def.height * 0.55, z: b.z, color: 0xff8a3d, intensity: this.boss.phase === 2 ? 26 : 14, range: 15 }, 1);
    }
    for (const p of this.pickups) p.update(dt);
    this.emitterUpdate(this.emberDrop.update(dt), this.emberDrop.visible ? 1 : 0);
    this.gate.update(dt);
    this.effects.update(dt, this.camera, pp);
    this.effects.setBudget(this.quality.particles);

    // LOD swap for the big instanced decoration sets
    for (const pair of this.levelLODs) {
      const d = Math.hypot(pair.center.x - pp.x, pair.center.z - pp.z);
      const useHi = d < this.quality.lodDistance * 2.2;
      pair.hi.visible = useHi && this.quality.decorationDensity > 0.15;
      pair.lo.visible = !useHi && this.quality.decorationDensity > 0.15;
    }
    for (const c of this.levelClusters) {
      const d = Math.hypot(c.center.x - pp.x, c.center.z - pp.z);
      if (c.kind === 'vegetation') c.object.visible = d < this.quality.vegetationRange;
    }

    // boss telegraphs
    const tele = this.boss.telegraph;
    if (tele && this.bossFightActive) {
      this.effects.setTelegraph(0, tele.x, tele.z, this.boss.renderPos.y, tele.radius, tele.t, tele.duration);
    } else {
      this.effects.setTelegraph(0, 0, 0, 0, 0, 0, 1);
    }

    // flame flicker drives the point-light budget
    this.graphics.assignPointLights(this.emitters);
    this.graphics.updateShadowFocus(pp, this.camera);

    // hud
    if (this.state !== 'menu') {
      this.ui.setVitals(
        this.player.health, this.player.maxHealth,
        this.player.stamina.current, this.player.stamina.max,
        this.player.flasks, this.player.maxFlasks,
        this.player.embers, 0,
      );
      this.ui.tickLore(dt);
    }

    this.graphics.render();
  }

  private emitterUpdate(e: { x: number; y: number; z: number; color: number; intensity: number; range: number }, mul: number): void {
    const found = this.emitters.find((s) => Math.abs(s.x - e.x) < 0.01 && Math.abs(s.z - e.z) < 0.01);
    if (found) { found.intensity = e.intensity * mul; found.y = e.y; }
    else this.emitters.push({ ...e, intensity: e.intensity * mul });
  }

  // -------------------------------------------------------------------- perf
  private updatePerf(dt: number): void {
    this.perfTimer -= dt;
    const avg = this.frameTimes.length
      ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length * 1000
      : 0;
    if (this.graphics.adaptResolution(avg)) {
      this.resize();
    }
    if (this.perfTimer > 0) return;
    this.perfTimer = 0.5;
    if (!this.quality.perfOverlay) { this.ui.setPerf(null); return; }
    const stats = this.graphics.stats;
    const fps = avg > 0 ? 1000 / avg : 0;
    this.ui.setPerf([
      `fps        ${fps.toFixed(1)}`,
      `frame      ${avg.toFixed(2)} ms`,
      `render     ${this.graphics.renderWidth}x${this.graphics.renderHeight}`,
      `display    ${this.graphics.displayWidth}x${this.graphics.displayHeight}`,
      `scale      ${Math.round(this.graphics.renderScale * this.graphics.currentAdaptiveScale * 100)}%${this.graphics.adaptiveActive ? ' (adaptive)' : ''}`,
      `draw calls ${stats.drawCalls}`,
      `triangles  ${stats.triangles}`,
      `programs   ${stats.programs}`,
      `preset     ${this.quality.preset}`,
      `physics    rapier ${PhysicsWorld.version}`,
    ].join('\n'));
  }

  // ------------------------------------------------------------------ resize
  resize = (): void => {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.graphics.resize(w, h, dpr);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.ui.setRenderSize(`${this.graphics.renderWidth} x ${this.graphics.renderHeight}`);
  };

  private bindWindowEvents(): void {
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.disposers.push(() => window.removeEventListener('resize', onResize));
    const onVis = () => {
      if (document.hidden && this.state === 'playing') this.pause();
    };
    document.addEventListener('visibilitychange', onVis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVis));
    this.input.onGlobalKey = (id) => { if (id === 'pause') this.togglePauseKey(); else this.toggleHelp(); };
    this.input.onPointerLockLost = () => {
      // Escape both releases the pointer lock and produces a pause edge; only one of them may toggle.
      if (performance.now() - this.lastToggle < 250) return;
      if (this.state === 'playing' && !this.ui.isOpen()) this.pause();
    };
  }

  // -------------------------------------------------------------------- menus
  private lastToggle = 0;

  private pause(): void {
    if (this.state !== 'playing') return;
    this.lastToggle = performance.now();
    this.state = 'paused';
    this.input.inputBlocked = true;
    this.input.clearAll();
    this.input.exitLock();
    this.ui.show('pause');
    this.audio.suspend();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.lastToggle = performance.now();
    this.ui.hide('pause');
    this.state = 'playing';
    this.input.inputBlocked = false;
    this.input.clearAll();
    this.input.requestLock();
    this.audio.resume();
  }

  private applyQuality(): void {
    this.graphics.applyQuality(this.quality, { clusters: this.levelClusters, lodPairs: this.levelLODs });
    this.graphics.setShadowQuality(this.quality.shadows);
    this.graphics.setRenderScale(this.quality.renderScale);
    this.effects.setBudget(this.quality.particles);
    this.resize();
    this.persistSettings();
  }

  private wireUI(): void {
    this.ui.actionHandler = (a: UIAction) => {
      if (typeof a === 'object' && 'buy' in a) { this.buyUpgrade(a.buy); return; }
      switch (a) {
        case 'continue': void this.audio.start(); this.continueGame(); break;
        case 'newgame': {
          void this.audio.start();
          if (this.saves.hasSave()) {
            this.ui.confirm('Begin a new vigil?', 'This erases the current save in this browser: upgrades, shortcuts, relics and the Warden.', () => {
              this.saves.clear();
              this.startNewGame();
            }, () => { });
          } else this.startNewGame();
          break;
        }
        case 'resume': this.resume(); break;
        case 'settings':
          this.ui.syncSettings(this.quality, this.settings);
          this.ui.show('settings');
          break;
        case 'settings-close':
          this.ui.hide('settings');
          if (this.state === 'paused' || this.state === 'resting') { /* keep the underlying panel */ }
          break;
        case 'controls': this.ui.show('controls'); break;
        case 'controls-close': this.ui.hide('controls'); break;
        case 'rest': this.doRest(); break;
        case 'rest-close': this.closeRest(); break;
        case 'respawn': this.respawn(); break;
        case 'quit':
          this.ui.confirm('Abandon to the title?', 'Your progress is saved at the last Vigil Flame.', () => this.returnToTitle(), () => { });
          break;
        case 'victory-continue':
          this.ui.hide('victory');
          this.state = 'playing';
          this.input.inputBlocked = false;
          this.input.requestLock();
          break;
        case 'victory-menu': this.returnToTitle(); break;
        default: break;
      }
    };

    this.ui.settingsHandler = (q, s) => {
      if (Object.keys(q).length) {
        if (q.preset && q.preset !== 'custom') {
          const base = { ...PRESETS[q.preset as Exclude<QualitySettings['preset'], 'custom'>] };
          this.quality = clampQuality({ ...base, perfOverlay: this.quality.perfOverlay });
        } else {
          this.quality = clampQuality({ ...this.quality, ...q, preset: 'custom' });
        }
        this.applyQuality();
        this.ui.syncSettings(this.quality, this.settings);
      }
      if (Object.keys(s).length) {
        this.settings = { ...this.settings, ...s };
        this.input.sensitivity = this.settings.mouseSensitivity;
        this.input.invertY = this.settings.invertY;
        this.audio.setSettings(this.settings);
        this.persistSettings();
      }
      if (this.save) { this.save.settings = { ...this.settings }; this.save.quality = { ...this.quality }; }
    };

    this.ui.onExport = () => {
      if (!this.save) { this.ui.toast('No vigil to export', 'bad'); return; }
      const text = this.saves.exportJSON(this.save);
      void navigator.clipboard?.writeText(text).then(
        () => this.ui.toast('Save JSON copied to the clipboard', 'good'),
        () => this.ui.toast('Clipboard blocked — use import to move saves manually', 'bad'),
      );
    };
    this.ui.onImport = (text) => {
      const res = this.saves.importJSON(text);
      if (!res.ok) { this.ui.toast(`Import rejected: ${res.reason}`, 'bad'); return; }
      this.ui.toast('Save imported', 'good');
      this.prepareMenu();
    };
  }

  private returnToTitle(): void {
    this.state = 'menu';
    this.ui.hide('pause');
    this.ui.hide('victory');
    this.ui.hide('death');
    this.ui.hide('rest');
    this.ui.setHudVisible(false);
    this.input.inputBlocked = true;
    this.input.exitLock();
    this.input.clearAll();
    this.prepareMenu();
  }

  // ------------------------------------------------------------------ debug
  toggleDebug(): void { this.debug.enabled = !this.debug.enabled; }
  get debugEnabled(): boolean { return this.debug.enabled; }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    for (const d of this.disposers) d();
    this.input.dispose();
    this.audio.dispose();
    this.effects.dispose();
    this.graphics?.dispose();
  }

  /** Test hook: the void rule must not end scripted exchanges that fall off an edge. */
  public testDisableVoidDeath = false;

  // ------------------------------------------------------- test hooks (smoke test)
  /** Run one simulation step with synthesised input, for deterministic automated checks. */
  fixedUpdatePublic(dt: number, keys?: string[]): void {
    this.input.setScripted(keys ?? []);
    this.fixedUpdate(dt);
  }

  openRestPublic(id: string): void {
    const def = CHECKPOINTS.find((c) => c.id === id) ?? CHECKPOINTS[0];
    this.openRest(def);
  }

  buyUpgradePublic(kind: UpgradeKind): void { this.buyUpgrade(kind); }
  openGatePublic(): void { this.openGate(); }
  ringBellPublic(): void { this.ringBell(); }
  applyQualityPublic(preset: string): void {
    const p = preset as Exclude<QualitySettings['preset'], 'custom'>;
    if (!PRESETS[p]) return;
    this.quality = clampQuality({ ...PRESETS[p], perfOverlay: this.quality.perfOverlay });
    this.applyQuality();
  }
  startBossFightPublic(): void { this.startBossFight(); }
  applySettingsPublic(q: Partial<QualitySettings>, s: Partial<UserSettings> = {}): void {
    if (Object.keys(q).length) {
      this.quality = clampQuality({ ...this.quality, ...q, preset: 'custom' });
      this.applyQuality();
    }
    if (Object.keys(s).length) {
      this.settings = { ...this.settings, ...s };
      this.input.sensitivity = this.settings.mouseSensitivity;
      this.input.invertY = this.settings.invertY;
      this.audio.setSettings(this.settings);
      this.persistSettings();
    }
  }

  // test hooks (used by the browser smoke test)
  get testState(): Record<string, unknown> {
    const p = this.player?.rawPosition;
    return {
      state: this.state,
      player: p ? { x: p.x, y: p.y, z: p.z } : null,
      health: this.player?.health ?? 0,
      deaths: this.save?.stats.deaths ?? 0,
      stamina: this.player?.stamina.current ?? 0,
      embers: this.player?.embers ?? 0,
      enemiesAlive: this.enemies?.filter((e) => e.alive).length ?? 0,
      bossPhase: this.boss?.phase ?? 0,
      bossDefeated: this.bossDefeated,
      bellRung: this.bellRung,
      gateOpen: this.gate?.opened ?? false,
      checkpoint: this.currentCheckpoint,
      renderSize: [this.graphics?.renderWidth, this.graphics?.renderHeight],
      navNodes: this.nav?.size ?? 0,
      navEdges: this.nav?.edgeCount ?? 0,
      droppedEdges: this.nav?.droppedEdges ?? 0,
      rapier: PhysicsWorld.version,
      simTime: this.simTime,
      hitRecords: this.combat?.registryRef.recorded.length ?? 0,
      distanceTravelled: this.distanceTravelled,
      flasks: this.player?.flasks ?? 0,
      maxFlasks: this.player?.maxFlasks ?? 0,
      damage: this.player?.weaponDamage ?? 0,
      maxHealth: this.player?.maxHealth ?? 0,
      pickups: Object.keys(this.save?.pickups ?? {}).length,
      lore: Object.keys(this.save?.lore ?? {}).length,
      drop: this.save?.drop ?? null,
    };
  }
}

const SIM_FIXED = Game.SIM_FIXED;
void wrapAngle;
void statValue;
