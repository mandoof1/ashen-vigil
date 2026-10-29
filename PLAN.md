# ASHEN VIGIL: THE LAST BELL — implementation plan

Compact third-person soulslike for the browser. TypeScript + three.js 0.186 + Rapier 0.21
(kinematic character controllers) + Vite 7. Static build, no backend, no external assets.

## Physics decision (single coherent architecture)
Rapier is the single source of truth for actor positions.
- Static world colliders generated from the *same* block descriptors that generate visual meshes,
  so visual geometry and collision always agree.
- Player + every enemy + the boss use `KinematicPositionBased` bodies + one
  `KinematicCharacterController` each (autostep, snap-to-ground, slope limits).
- Queries: raycasts (ground, camera, line-of-sight, wall obstruction), shape intersections
  (attack volumes, trigger volumes). No second collision system.
- Collision groups: WORLD, BLOCKER, ACTOR, TRIGGER, INTERACT, plus BARRIER for the arena wall that
  blocks actors but not sight or navigation (see `src/physics/Physics.ts`).

## Simulation order (fixed 1/60 s accumulator, clamped dt, interpolated visuals)
1. clamp dt, sample input edges
2. player state machine transitions (cancellation windows centralised in `Balance`)
3. player movement -> Rapier character controller
4. `world.step()`
5. AI think (fixed rate per enemy, staggered) + AI movement -> character controller
6. attack windows -> swept weapon-segment hit queries -> dedupe -> damage events
7. death / stagger resolution, drops
8. interactions, checkpoints, pickups, triggers, tutorial
9. render: interpolate actor transforms, camera rig, animation poses, particles, throttled UI

## Milestones
1. scene + movement + camera 2. collision + navigation 3. combat + one enemy
4. death/checkpoints/currency recovery 5. full level + shortcut 6. boss + ending
7. progression + saves 8. graphics/audio/UI polish 9. optimisation 10. tests + release

## Level (one interconnected map, metres)
Fallen Approach (safe, tutorial, CP1) -> Outer Courtyard (group combat, locked shortcut gate,
boss vista) -> Lower Cloister (pillars, stairs, balcony, ambush, shield pilgrim, route behind gate)
-> Bell Stair (CP2, boss barrier) -> Bell Chamber (two-phase Bellbound Warden, bell, ending).

## Originality / assets
All geometry, textures, animation, and audio are generated procedurally at load.
No third-party art/audio/font binaries are bundled, so `LICENSES.md` documents the toolchain
licences plus the procedural-asset policy.
