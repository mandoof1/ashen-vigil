/** Tiny typed event bus: gameplay systems publish, audio/effects/UI subscribe. */

export interface GameEvents {
  hit: { result: import('./Types').DamageResult; attacker: string; target: string; x: number; y: number; z: number; normalX: number; normalY: number; normalZ: number };
  guardImpact: { x: number; y: number; z: number; blocked: boolean; broken: boolean; faction: string };
  attackSwing: { x: number; y: number; z: number; power: number; faction: string };
  dodge: { x: number; y: number; z: number };
  heal: { x: number; y: number; z: number; amount: number };
  death: { x: number; y: number; z: number; kind: string; faction: string };
  stagger: { x: number; y: number; z: number };
  pickup: { x: number; y: number; z: number; kind: string; amount: number };
  checkpoint: { x: number; y: number; z: number; activated: boolean };
  ui: { message: string; kind?: 'good' | 'bad' | 'info' };
  bossPhase: { phase: number };
  bossIntro: {};
  bell: {};
  footstep: { x: number; y: number; z: number; speed: number; sprint: boolean };
  ambush: { x: number; y: number; z: number };
  gate: { opened: boolean };
  playerDamaged: { amount: number; blocked: boolean };
}

export type EventName = keyof GameEvents;

type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

export class EventBus {
  private map = new Map<EventName, Array<Handler<EventName>>>();

  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    const list = this.map.get(name) ?? [];
    list.push(fn as Handler<EventName>);
    this.map.set(name, list);
    return () => this.off(name, fn as Handler<EventName>);
  }

  off<K extends EventName>(name: K, fn: Handler<K>): void {
    const list = this.map.get(name);
    if (!list) return;
    const i = list.indexOf(fn as Handler<EventName>);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends EventName>(name: K, payload: GameEvents[K]): void {
    const list = this.map.get(name);
    if (!list) return;
    for (const fn of list) (fn as Handler<K>)(payload);
  }

  clear(): void {
    this.map.clear();
  }
}
