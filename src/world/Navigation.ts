/**
 * Waypoint navigation graph. Authored nodes are validated against the real collision
 * world at load time (line-of-sight + ground probe), so an edge can never be walked
 * through a wall.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/Physics';
import { MASK_WORLD } from '../physics/Physics';
import { NAV, type NavNode } from '../world/LevelData';

interface GraphNode {
  id: string;
  pos: THREE.Vector3;
  links: Array<{ to: string; cost: number }>;
}

export class NavigationGraph {
  private nodes = new Map<string, GraphNode>();
  public droppedEdges = 0;
  /** debug: which authored links were rejected, and why */
  public droppedLog: Array<{ from: string; to: string; reason: string }> = [];

  build(phys: PhysicsWorld): void {
    this.droppedEdges = 0;
    this.droppedLog = [];
    this.nodes.clear();
    for (const n of NAV) {
      this.nodes.set(n.id, { id: n.id, pos: new THREE.Vector3(n.x, n.y, n.z), links: [] });
    }
    for (const n of NAV) {
      const from = this.nodes.get(n.id)!;
      for (const toId of n.links) {
        const to = this.nodes.get(toId);
        if (!to) { this.droppedEdges++; this.droppedLog.push({ from: n.id, to: toId, reason: 'unknown node' }); continue; }
        const why = this.edgeReason(phys, from, to);
        if (why) { this.droppedEdges++; this.droppedLog.push({ from: n.id, to: toId, reason: why }); continue; }
        const cost = from.pos.distanceTo(to.pos);
        from.links.push({ to: toId, cost });
        const back = this.nodes.get(toId)!;
        if (!back.links.some((l) => l.to === n.id)) back.links.push({ to: n.id, cost });
      }
    }
  }

  /**
   * Validate an authored edge against the real collision world.
   *
   * The probe follows the ground: each segment is sampled, the surface under both ends of the
   * segment is found, and a horizontal probe is cast at torso height above that surface. This
   * makes stairs, ramps and raised walkways validate correctly instead of clipping the probe
   * into the slope. An edge survives only when every segment has ground and a walkable corridor
   * (three parallel probes, so an actor can pass a narrow obstacle).
   */
  private edgeReason(phys: PhysicsWorld, a: GraphNode, b: GraphNode): string {
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return 'degenerate edge';
    const len = dist;
    const px = -dz / len, pz = dx / len;
    const segments = Math.max(2, Math.min(10, Math.ceil(dist / 2.5)));
    const segLen = dist / segments;
    // a climb is legal when its slope is inside the actor's own walking limit
    const maxClimb = Math.tan(48 * Math.PI / 180) * segLen + 0.6;
    const surface = (x: number, z: number, y: number) => {
      const g = phys.groundBelow(x, y + 1.8, z, 3.6);
      if (!g.hit) return null;
      if (g.distance < 0.05) return y;          // probe started inside geometry: trust the authored node
      return g.y;
    };
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments, t1 = (i + 1) / segments;
      const ax = a.pos.x + dx * t0, az = a.pos.z + dz * t0, ay = a.pos.y + (b.pos.y - a.pos.y) * t0;
      const bx = a.pos.x + dx * t1, bz = a.pos.z + dz * t1, by = a.pos.y + (b.pos.y - a.pos.y) * t1;
      const g0 = surface(ax, az, ay);
      const g1 = surface(bx, bz, by);
      if (g0 === null || g1 === null) return 'no ground under the edge';
      if (Math.abs(g1 - g0) > maxClimb) return 'slope too steep for the actor';
      let clear = 0;
      for (const off of [-0.85, 0, 0.85]) {
        if (!phys.lineBlocked(ax + px * off, g0 + 0.9, az + pz * off, bx + px * off, g1 + 0.9, bz + pz * off, MASK_WORLD)) clear++;
      }
      if (clear === 0) return 'no walkable corridor';
    }
    return '';
  }

  /** Breadth-first reachability over the validated graph (used by tests + AI fallback). */
  reachableFrom(startId: string): Set<string> {
    const seen = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift()!;
      const node = this.nodes.get(id);
      if (!node) continue;
      for (const l of node.links) if (!seen.has(l.to)) { seen.add(l.to); queue.push(l.to); }
    }
    return seen;
  }

  /** Node ids that the authored layout expects but the collision world rejected. */
  unreachableNodes(): string[] {
    const reach = this.reachableFrom(NAV[0].id);
    return [...this.nodes.keys()].filter((id) => !reach.has(id));
  }

  nearest(pos: THREE.Vector3, maxDist = 40): GraphNode | null {
    let best: GraphNode | null = null;
    let bestD = maxDist * maxDist;
    for (const n of this.nodes.values()) {
      const d = (n.pos.x - pos.x) ** 2 + (n.pos.y - pos.y) ** 2 + (n.pos.z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** Dijkstra over the waypoint graph. Returns world positions (excluding the start node). */
  findPath(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[]): boolean {
    out.length = 0;
    const start = this.nearest(from);
    const goal = this.nearest(to);
    if (!start || !goal) return false;
    if (start === goal) return false;
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    dist.set(start.id, 0);
    const queue: Array<{ id: string; d: number }> = [{ id: start.id, d: 0 }];
    while (queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].d < queue[bi].d) bi = i;
      const cur = queue.splice(bi, 1)[0];
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      if (cur.id === goal.id) break;
      const node = this.nodes.get(cur.id)!;
      for (const link of node.links) {
        if (visited.has(link.to)) continue;
        const nd = cur.d + link.cost;
        if (nd < (dist.get(link.to) ?? Infinity)) {
          dist.set(link.to, nd);
          prev.set(link.to, cur.id);
          queue.push({ id: link.to, d: nd });
        }
      }
    }
    if (!visited.has(goal.id)) return false;
    const chain: string[] = [];
    let at: string | undefined = goal.id;
    while (at) { chain.push(at); at = prev.get(at); }
    chain.reverse();
    for (const id of chain) out.push(this.nodes.get(id)!.pos.clone());
    return out.length > 0;
  }

  nodePositions(): THREE.Vector3[] {
    return [...this.nodes.values()].map((n) => n.pos.clone());
  }

  get size(): number { return this.nodes.size; }
  /** Directed link count (each walkable connection is stored both ways). */
  get edgeCount(): number {
    let n = 0;
    for (const node of this.nodes.values()) n += node.links.length;
    return n;
  }
}

export function navNodeById(id: string): NavNode | undefined {
  return NAV.find((n) => n.id === id);
}
