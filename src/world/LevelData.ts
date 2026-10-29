/**
 * Level layout data. One compact interconnected map. Units are metres.
 * Convention: north is -Z. Floors are defined by their walkable `topY`.
 * Wall `gaps` are measured along the run (x for east-west runs, z for north-south runs).
 *
 *   The Fallen Approach (safe, y=3)   x -12..12,  z 9..47      + nook x -19..-12, z 16..26
 *   The Outer Courtyard (y=0)         x -21..21,  z -15..9
 *   The Lower Cloister (y=0)          x 21..47,   z -23..11    + balcony y=3, walkway y=3
 *   The Cloister Passage (y=0)        x 11..21,   z -23..-15
 *   The West Corridor (y=0)           x -31..-11, z -23..-17   and x -25..-21, z -17..-4
 *   The Bell Stair (y=0 -> y=5)       x -11..11,  z -30..-15
 *   The Bell Chamber (y=5)            x -16..16,  z -62..-30
 */

export interface FloorDef { id: string; x1: number; x2: number; z1: number; z2: number; topY: number; thickness: number; kind: 'ground' | 'stone'; chunk: string }
export interface WallDef { id: string; x1: number; z1: number; x2: number; z2: number; baseY: number; height: number; thickness: number; gaps: Array<[number, number]>; kind: 'wall' | 'parapet'; chunk: string }
export interface StairDef { id: string; x1: number; x2: number; z1: number; z2: number; y0: number; y1: number; chunk: string }
export interface PillarDef { x: number; y: number; z: number; height: number; radius: number; broken: boolean; chunk: string }
export interface SpawnDef { id: string; type: 'sentry' | 'pilgrim' | 'brute'; x: number; y: number; z: number; home?: [number, number]; patrol?: Array<[number, number]>; tag?: string }
export interface CheckpointDef { id: string; name: string; x: number; y: number; z: number }
export interface PickupDef { id: string; kind: 'embers' | 'flask' | 'lore'; x: number; y: number; z: number; amount?: number; title?: string; text?: string }
export interface NavNode { id: string; x: number; y: number; z: number; links: string[] }
export interface AreaDef { id: string; name: string; x1: number; x2: number; z1: number; z2: number }

export const MAP_BOUNDS = { minX: -34, maxX: 50, minZ: -66, maxZ: 50 };

export const AREAS: AreaDef[] = [
  { id: 'approach', name: 'The Fallen Approach', x1: -20, x2: 13, z1: 8, z2: 48 },
  { id: 'courtyard', name: 'The Outer Courtyard', x1: -22, x2: 22, z1: -16, z2: 10 },
  { id: 'cloister', name: 'The Lower Cloister', x1: 20, x2: 48, z1: -24, z2: 12 },
  { id: 'passage', name: 'The Cloister Passage', x1: 10, x2: 22, z1: -24, z2: -14 },
  { id: 'westcorridor', name: 'The West Corridor', x1: -32, x2: -10, z1: -24, z2: -3 },
  { id: 'stair', name: 'The Bell Stair', x1: -12, x2: 12, z1: -31, z2: -14 },
  { id: 'chamber', name: 'The Bell Chamber', x1: -17, x2: 17, z1: -63, z2: -29 },
];

export const FLOORS: FloorDef[] = [
  { id: 'f_approach', x1: -12, x2: 12, z1: 9, z2: 47, topY: 3, thickness: 4, kind: 'ground', chunk: 'approach' },
  { id: 'f_nook', x1: -19, x2: -12, z1: 16, z2: 26, topY: 3, thickness: 4, kind: 'ground', chunk: 'approach' },
  { id: 'f_court', x1: -21, x2: 21, z1: -15, z2: 9, topY: 0, thickness: 4, kind: 'stone', chunk: 'courtyard' },
  { id: 'f_cloister', x1: 21, x2: 47, z1: -23, z2: 11, topY: 0, thickness: 4, kind: 'stone', chunk: 'cloister' },
  { id: 'f_passage', x1: 11, x2: 21, z1: -23, z2: -15, topY: 0, thickness: 4, kind: 'stone', chunk: 'passage' },
  { id: 'f_west_h', x1: -31, x2: -11, z1: -23, z2: -17, topY: 0, thickness: 4, kind: 'stone', chunk: 'westcorridor' },
  { id: 'f_west_v', x1: -25, x2: -21, z1: -17, z2: -4, topY: 0, thickness: 4, kind: 'stone', chunk: 'westcorridor' },
  { id: 'f_stair_low', x1: -11, x2: 11, z1: -22, z2: -15, topY: 0, thickness: 4, kind: 'stone', chunk: 'stair' },
  { id: 'f_stair_land', x1: -11, x2: 11, z1: -30, z2: -28, topY: 5, thickness: 5, kind: 'stone', chunk: 'stair' },
  { id: 'f_chamber', x1: -16, x2: 16, z1: -62, z2: -30, topY: 5, thickness: 6, kind: 'stone', chunk: 'chamber' },
  { id: 'f_balcony', x1: 40, x2: 47, z1: -23, z2: 5, topY: 3, thickness: 1.2, kind: 'stone', chunk: 'cloister' },
  { id: 'f_walkway', x1: 30, x2: 40, z1: -22, z2: -19, topY: 3, thickness: 1.2, kind: 'stone', chunk: 'cloister' },
];

export const WALLS: WallDef[] = [
  // ---- approach canyon (terrace at y=3)
  { id: 'w_app_e', x1: 12, z1: 9, x2: 12, z2: 47, baseY: 3, height: 7, thickness: 2, gaps: [], kind: 'wall', chunk: 'approach' },
  { id: 'w_app_w1', x1: -12, z1: 9, x2: -12, z2: 16, baseY: 3, height: 7, thickness: 2, gaps: [], kind: 'wall', chunk: 'approach' },
  { id: 'w_app_w2', x1: -12, z1: 26, x2: -12, z2: 47, baseY: 3, height: 7, thickness: 2, gaps: [], kind: 'wall', chunk: 'approach' },
  { id: 'w_app_nook_w', x1: -19, z1: 16, x2: -19, z2: 26, baseY: 3, height: 4, thickness: 2, gaps: [], kind: 'wall', chunk: 'approach' },
  { id: 'w_app_nook_n', x1: -19, z1: 26, x2: -12, z2: 26, baseY: 3, height: 4, thickness: 2, gaps: [], kind: 'wall', chunk: 'approach' },
  { id: 'w_app_back', x1: -12, z1: 47, x2: 12, z2: 47, baseY: 3, height: 3.2, thickness: 2, gaps: [], kind: 'parapet', chunk: 'approach' },
  // ---- courtyard ring
  { id: 'w_court_s', x1: -21, z1: 9, x2: 21, z2: 9, baseY: 0, height: 6, thickness: 2, gaps: [[-4, 4]], kind: 'wall', chunk: 'courtyard' },
  { id: 'w_court_n', x1: -21, z1: -15, x2: 11, z2: -15, baseY: 0, height: 6, thickness: 2, gaps: [[-3.5, 3.5]], kind: 'wall', chunk: 'courtyard' },
  { id: 'w_court_e', x1: 21, z1: -15, x2: 21, z2: 9, baseY: 0, height: 6, thickness: 2, gaps: [[-2, 4]], kind: 'wall', chunk: 'courtyard' },
  { id: 'w_court_w', x1: -21, z1: -15, x2: -21, z2: 9, baseY: 0, height: 6, thickness: 2, gaps: [[-9, -3]], kind: 'wall', chunk: 'courtyard' },
  // ---- cloister ring
  { id: 'w_clo_s', x1: 21, z1: 11, x2: 47, z2: 11, baseY: 0, height: 7, thickness: 2, gaps: [], kind: 'wall', chunk: 'cloister' },
  { id: 'w_clo_n', x1: 21, z1: -23, x2: 47, z2: -23, baseY: 0, height: 7, thickness: 2, gaps: [], kind: 'wall', chunk: 'cloister' },
  { id: 'w_clo_e', x1: 47, z1: -23, x2: 47, z2: 11, baseY: 0, height: 8, thickness: 2, gaps: [], kind: 'wall', chunk: 'cloister' },
  // ---- passage
  { id: 'w_pas_n', x1: 11, z1: -15, x2: 21, z2: -15, baseY: 0, height: 5, thickness: 1.6, gaps: [], kind: 'wall', chunk: 'passage' },
  { id: 'w_pas_s', x1: 11, z1: -23, x2: 21, z2: -23, baseY: 0, height: 5, thickness: 1.6, gaps: [], kind: 'wall', chunk: 'passage' },
  // ---- west corridor
  { id: 'w_wc_n', x1: -31, z1: -17, x2: -21, z2: -17, baseY: 0, height: 5, thickness: 1.6, gaps: [[-25, -21]], kind: 'wall', chunk: 'westcorridor' },
  { id: 'w_wc_s', x1: -31, z1: -23, x2: -11, z2: -23, baseY: 0, height: 5, thickness: 1.6, gaps: [], kind: 'wall', chunk: 'westcorridor' },
  { id: 'w_wc_w', x1: -31, z1: -23, x2: -31, z2: -17, baseY: 0, height: 5, thickness: 1.6, gaps: [], kind: 'wall', chunk: 'westcorridor' },
  { id: 'w_wc_v_w', x1: -25, z1: -17, x2: -25, z2: -4, baseY: 0, height: 5, thickness: 1.6, gaps: [], kind: 'wall', chunk: 'westcorridor' },
  { id: 'w_wc_v_n', x1: -25, z1: -4, x2: -21, z2: -4, baseY: 0, height: 5, thickness: 1.6, gaps: [], kind: 'wall', chunk: 'westcorridor' },
  // ---- bell stair
  { id: 'w_stair_e', x1: 11, z1: -30, x2: 11, z2: -15, baseY: 0, height: 11, thickness: 2, gaps: [[-23, -17]], kind: 'wall', chunk: 'stair' },
  { id: 'w_stair_w', x1: -11, z1: -30, x2: -11, z2: -15, baseY: 0, height: 11, thickness: 2, gaps: [[-23, -17]], kind: 'wall', chunk: 'stair' },
  // ---- bell chamber (square arena, entrance gap in the south wall)
  { id: 'w_ch_s', x1: -16, z1: -30, x2: 16, z2: -30, baseY: 5, height: 10, thickness: 2, gaps: [[-4, 4]], kind: 'wall', chunk: 'chamber' },
  { id: 'w_ch_n', x1: -16, z1: -62, x2: 16, z2: -62, baseY: 5, height: 13, thickness: 2.5, gaps: [], kind: 'wall', chunk: 'chamber' },
  { id: 'w_ch_e', x1: 16, z1: -62, x2: 16, z2: -30, baseY: 5, height: 13, thickness: 2.5, gaps: [], kind: 'wall', chunk: 'chamber' },
  { id: 'w_ch_w', x1: -16, z1: -62, x2: -16, z2: -30, baseY: 5, height: 13, thickness: 2.5, gaps: [], kind: 'wall', chunk: 'chamber' },
];

/** Stair runs: `y0` at `z1`, `y1` at `z2`. A ramp collider covers the whole run; steps are visual. */
export const STAIRS: StairDef[] = [
  { id: 's_approach', x1: -4, x2: 4, z1: 6, z2: 9, y0: 0, y1: 3, chunk: 'courtyard' },
  { id: 's_grand', x1: -6, x2: 6, z1: -22, z2: -28, y0: 0, y1: 5, chunk: 'stair' },
  { id: 's_balcony', x1: 40, x2: 47, z1: 5, z2: 10, y0: 3, y1: 0, chunk: 'cloister' },
  { id: 's_walkway', x1: 26, x2: 30, z1: -18, z2: -22, y0: 0, y1: 3, chunk: 'cloister' },
];

export const PILLARS: PillarDef[] = [
  { x: 26, y: 0, z: 6, height: 8, radius: 0.75, broken: false, chunk: 'cloister' },
  { x: 32, y: 0, z: 6, height: 8, radius: 0.75, broken: true, chunk: 'cloister' },
  { x: 38, y: 0, z: 6, height: 8, radius: 0.75, broken: false, chunk: 'cloister' },
  { x: 26, y: 0, z: -2, height: 8, radius: 0.75, broken: false, chunk: 'cloister' },
  { x: 32, y: 0, z: -2, height: 8, radius: 0.75, broken: false, chunk: 'cloister' },
  { x: 38, y: 0, z: -2, height: 8, radius: 0.75, broken: true, chunk: 'cloister' },
  { x: 26, y: 0, z: -10, height: 8, radius: 0.75, broken: false, chunk: 'cloister' },
  { x: 38, y: 0, z: -10, height: 8, radius: 0.75, broken: false, chunk: 'cloister' },
  { x: 44, y: 0, z: -10, height: 6, radius: 0.7, broken: true, chunk: 'cloister' },
  { x: -16, y: 3, z: 12, height: 5, radius: 0.7, broken: true, chunk: 'approach' },
  { x: 16, y: 0, z: -12, height: 6, radius: 0.8, broken: true, chunk: 'courtyard' },
  { x: -17, y: 0, z: -12, height: 4.5, radius: 0.8, broken: true, chunk: 'courtyard' },
  { x: 8, y: 0, z: 5, height: 7, radius: 0.7, broken: false, chunk: 'courtyard' },
  { x: -8, y: 0, z: 5, height: 7, radius: 0.7, broken: true, chunk: 'courtyard' },
  { x: -13, y: 5, z: -56, height: 9, radius: 0.9, broken: false, chunk: 'chamber' },
  { x: 13, y: 5, z: -56, height: 9, radius: 0.9, broken: false, chunk: 'chamber' },
];

export const CHECKPOINTS: CheckpointDef[] = [
  { id: 'cp_approach', name: 'Vigil Flame of the Approach', x: 0, y: 3, z: 14 },
  { id: 'cp_stair', name: 'Vigil Flame of the Bell Stair', x: -6, y: 0, z: -18 },
];

export const SPAWNS: SpawnDef[] = [
  { id: 'e_app1', type: 'sentry', x: 4, y: 3, z: 28, home: [4, 28], patrol: [[4, 28], [1, 18]] },
  { id: 'e_ct1', type: 'sentry', x: -7, y: 0, z: -6, home: [-7, -6] },
  { id: 'e_ct2', type: 'sentry', x: 9, y: 0, z: -2, home: [9, -2] },
  { id: 'e_ct3', type: 'brute', x: 1, y: 0, z: -11, home: [1, -11] },
  { id: 'e_ct4', type: 'pilgrim', x: 16, y: 0, z: 5, home: [16, 5], tag: 'side' },
  { id: 'e_cl1', type: 'pilgrim', x: 43, y: 3, z: -8, home: [43, -8], tag: 'balcony' },
  { id: 'e_cl2', type: 'sentry', x: 28, y: 0, z: -12, home: [28, -12] },
  { id: 'e_cl3', type: 'brute', x: 33, y: 0, z: -9, home: [33, -9], tag: 'ambush' },
  { id: 'e_cl4', type: 'sentry', x: 33, y: 3, z: -21, home: [33, -21], tag: 'walkway' },
  { id: 'e_wc1', type: 'sentry', x: -27, y: 0, z: -19, home: [-27, -19], tag: 'gate' },
];

/** Legal respawn ids: the arrival gate plus every Vigil Flame. */
export const RESPAWN_IDS = ['spawn', ...CHECKPOINTS.map((c) => c.id)];

export const PICKUPS: PickupDef[] = [
  { id: 'p_cache_nook', kind: 'embers', x: -16, y: 3, z: 21, amount: 55 },
  { id: 'p_cache_cloister', kind: 'embers', x: 44, y: 3, z: -21, amount: 55 },
  { id: 'p_cache_wc', kind: 'embers', x: -29, y: 0, z: -20, amount: 55 },
  { id: 'p_flask', kind: 'flask', x: 43, y: 3, z: 1 },
  { id: 'p_lore_bell1', kind: 'lore', x: 8, y: 3, z: 38, title: 'Broken Bell', text: 'The first bell was cracked by the hand of a keeper who loved it too much. The valley forgave him. The bell did not.' },
  { id: 'p_lore_banner', kind: 'lore', x: 18, y: 0, z: -13, title: 'Burned Banner', text: 'Ashen cloth, the sigil of a watchful eye. The guardians wore this when they still slept standing up.' },
  { id: 'p_lore_offer', kind: 'lore', x: 22, y: 0, z: 8, title: 'Abandoned Offering', text: 'A child\'s shoe. A coin. A fistful of salt. Someone asked for the bell to ring again. Nobody answered.' },
  { id: 'p_lore_relief', kind: 'lore', x: 34, y: 0, z: 9, title: 'Cracked Relief', text: 'Carved into the plinth: WHEN THE LAST VIGIL FAILS, RING WHAT REMAINS.' },
  { id: 'p_lore_stair', kind: 'lore', x: 5, y: 0, z: -20, title: 'Worn Inscription', text: 'The Warden was the first to volunteer, and the last to be allowed to leave.' },
];

export const GATE = {
  id: 'gate_courtyard',
  x: -21, y: 0, z: -6,
  width: 6, height: 6.2, thickness: 0.7, yaw: Math.PI / 2, // curtain spans the gap along Z
  leverX: -27, leverY: 0, leverZ: -19,
  name: 'Portcullis of the Watch',
};

export const BOSS_TRIGGER = { id: 'warden_gate', x: 0, y: 5, z: -31, radius: 5.5 };
export const BOSS_SPAWN = { x: 0, y: 5, z: -48 };
export const BELL = { id: 'bell', x: 0, y: 5, z: -56, name: 'The Last Bell' };
export const ARENA = { cx: 0, cz: -46, half: 14.2 };

export const NAV: NavNode[] = [
  // approach
  { id: 'n_start', x: 0, y: 3, z: 42, links: ['n_app1'] },
  { id: 'n_app1', x: 0, y: 3, z: 34, links: ['n_start', 'n_app2', 'n_bell1'] },
  { id: 'n_app2', x: 3, y: 3, z: 26, links: ['n_app1', 'n_cp1', 'n_e_app1'] },
  { id: 'n_e_app1', x: 5, y: 3, z: 20, links: ['n_app2'] },
  { id: 'n_cp1', x: 0, y: 3, z: 14, links: ['n_app2', 'n_ramp_top'] },
  { id: 'n_bell1', x: 8, y: 3, z: 38, links: ['n_app1'] },
  { id: 'n_nook', x: -15, y: 3, z: 21, links: ['n_app2'] },
  { id: 'n_ramp_top', x: 0, y: 3, z: 8, links: ['n_cp1', 'n_ramp_bottom'] },
  // courtyard
  { id: 'n_ramp_bottom', x: 0, y: 0, z: 6, links: ['n_ramp_top', 'n_court_s'] },
  { id: 'n_court_s', x: 0, y: 0, z: 4, links: ['n_ramp_bottom', 'n_court_c', 'n_offer'] },
  { id: 'n_offer', x: 20, y: 0, z: 7, links: ['n_court_s', 'n_ct4'] },
  { id: 'n_ct4', x: 16, y: 0, z: 3, links: ['n_offer', 'n_court_e'] },
  { id: 'n_court_c', x: 0, y: 0, z: -2, links: ['n_court_s', 'n_court_w', 'n_court_e', 'n_ct3'] },
  { id: 'n_court_w', x: -16, y: 0, z: -6, links: ['n_court_c', 'n_gate'] },
  { id: 'n_gate', x: -20, y: 0, z: -6, links: ['n_court_w', 'n_wc_v'] },
  { id: 'n_court_e', x: 18, y: 0, z: 1, links: ['n_court_c', 'n_cl_s'] },
  { id: 'n_ct1', x: -7, y: 0, z: -6, links: ['n_court_c'] },
  { id: 'n_ct3', x: 1, y: 0, z: -11, links: ['n_court_c', 'n_stair_s'] },
  { id: 'n_court_n', x: 0, y: 0, z: -13, links: ['n_court_c', 'n_stair_s'] },
  // cloister (nodes are placed so every straight leg passes through a real opening)
  { id: 'n_cl_s', x: 24, y: 0, z: 2, links: ['n_court_e', 'n_cl_c', 'n_lore_relief'] },
  { id: 'n_lore_relief', x: 34, y: 0, z: 9, links: ['n_cl_s', 'n_cl_se'] },
  { id: 'n_cl_se', x: 38, y: 0, z: 6, links: ['n_cl_c', 'n_cl_e'] },
  { id: 'n_cl_c', x: 32, y: 0, z: -4, links: ['n_cl_s', 'n_cl_a', 'n_cl_se'] },
  { id: 'n_cl_a', x: 26, y: 0, z: -6, links: ['n_cl_w', 'n_ambush'] },
  { id: 'n_cl_w', x: 24, y: 0, z: -19, links: ['n_cl_a', 'n_pas_w', 'n_walk_st'] },
  { id: 'n_cl_e', x: 43.5, y: 0, z: 9.3, links: ['n_cl_se', 'n_balcony_st'] },
  { id: 'n_ambush', x: 28.5, y: 0, z: -9, links: ['n_cl_a'] },
  { id: 'n_balcony_st', x: 43.5, y: 1.5, z: 7.6, links: ['n_cl_e', 'n_balcony'] },
  { id: 'n_balcony', x: 43, y: 3, z: -4, links: ['n_balcony_st', 'n_cache_cl', 'n_balcony_w'] },
  { id: 'n_balcony_w', x: 41, y: 3, z: -20, links: ['n_walkway'] },
  { id: 'n_cache_cl', x: 44, y: 3, z: -21, links: ['n_balcony'] },
  { id: 'n_walkway', x: 33, y: 3, z: -21, links: ['n_balcony_w', 'n_walk_top'] },
  { id: 'n_walk_top', x: 28, y: 3, z: -21.8, links: ['n_walkway', 'n_walk_st'] },
  { id: 'n_walk_st', x: 28, y: 1.2, z: -19.5, links: ['n_walk_top', 'n_cl_w'] },
  // passage + west corridor
  { id: 'n_pas_w', x: 14, y: 0, z: -19, links: ['n_cl_w', 'n_stair_e'] },
  { id: 'n_wc_v', x: -23, y: 0, z: -10, links: ['n_gate', 'n_wc_j'] },
  { id: 'n_wc_j', x: -23, y: 0, z: -19, links: ['n_wc_v', 'n_lever', 'n_stair_w'] },
  { id: 'n_lever', x: -27, y: 0, z: -19, links: ['n_wc_j', 'n_cache_wc'] },
  { id: 'n_cache_wc', x: -29, y: 0, z: -20, links: ['n_lever'] },
  // bell stair
  { id: 'n_stair_s', x: 0, y: 0, z: -17, links: ['n_court_n', 'n_cp2', 'n_stair_e', 'n_stair_w', 'n_lore_st', 'n_stair_base'] },
  { id: 'n_cp2', x: -6, y: 0, z: -18, links: ['n_stair_s'] },
  { id: 'n_stair_e', x: 9, y: 0, z: -19, links: ['n_pas_w', 'n_stair_s'] },
  { id: 'n_stair_w', x: -9, y: 0, z: -19, links: ['n_wc_j', 'n_stair_s'] },
  { id: 'n_lore_st', x: 5, y: 0, z: -20, links: ['n_stair_s'] },
  { id: 'n_stair_base', x: 0, y: 0, z: -21, links: ['n_stair_s', 'n_stair_mid'] },
  { id: 'n_stair_mid', x: 0, y: 2.5, z: -25, links: ['n_stair_base', 'n_stair_top'] },
  { id: 'n_stair_top', x: 0, y: 5, z: -29, links: ['n_stair_mid', 'n_chamber_s'] },
  // chamber
  { id: 'n_chamber_s', x: 0, y: 5, z: -33, links: ['n_stair_top', 'n_chamber_c'] },
  { id: 'n_chamber_c', x: 0, y: 5, z: -46, links: ['n_chamber_s', 'n_chamber_e', 'n_chamber_w', 'n_bell'] },
  { id: 'n_chamber_e', x: 11, y: 5, z: -46, links: ['n_chamber_c'] },
  { id: 'n_chamber_w', x: -11, y: 5, z: -46, links: ['n_chamber_c'] },
  { id: 'n_bell', x: 0, y: 5, z: -54, links: ['n_chamber_c'] },
];

export const SPAWN_START = { x: 0, y: 3, z: 42, yaw: 0 }; // facing -Z, toward the sanctuary

/** Landmarks the camera and composition rely on (also used by the debug overlay). */
export const LANDMARKS = [
  { name: 'Bell Tower', x: 0, y: 14, z: -46 },
  { name: 'Approach Arch', x: 0, y: 3, z: 9 },
  { name: 'Cloister Arch', x: 21, y: 0, z: 1 },
];
