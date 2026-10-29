# Test report — ASHEN VIGIL: THE LAST BELL

Generated: 2026-10-29T13:47:52.192Z

## Layers

| Layer | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` (strict) | clean |
| Unit (pure logic) | `npx vitest run` | 59 tests / 6 files, all passing |
| End-to-end (production build) | `node tools/smoke.mjs` | 68/68 checks passing |

Unit tests cover the deterministic core only — stamina accounting, damage/guard/poise
resolution, hit de-duplication, ember drop/recovery, progression costs, save validation and
migration. They run in Node with no browser and no GPU.

The smoke test boots the **built** game (`dist/`) in headless Chromium and drives it through
a full playthrough: menus, traversal, collision, combat, death and recovery, checkpoints,
upgrades, the shortcut gate, both boss phases, the bell and ending, save/reload/continue,
quality presets, overlays, and console cleanliness.

## Environment

- Browser: Chromium 156.0.8078.4 (headless, SwiftShader software WebGL — **no GPU**)
- Target: http://127.0.0.1:4173/ (the production build, served locally)
- Smoke run captured: 2026-10-29T13:46:34.888Z

## Results

**68 of 68 checks passed.** No failures.

### Measured performance (software rendering — see the caveat below)

| Preset | FPS | Draw calls | Triangles | Render target | Shader programs |
| --- | --- | --- | --- | --- | --- |
| low | 0.89 | 481 | 44,160 | 896×503 | 39 |
| medium | 0.55 | 496 | 44,175 | 1088×612 | 40 |
| high | 1.95 | 498 | 44,177 | 1280×720 | 40 |
| ultra | 1.19 | 536 | 45,033 | 1280×720 | 40 |

**Caveat, stated plainly:** these FPS numbers come from SwiftShader, a CPU rasteriser. They
are not indicative of the experience on real hardware and must not be read as "the game runs
at 1 fps". What the run does establish: all four presets render, the internal render target
tracks the preset (896×503 → 1280×720), draw-call and triangle counts stay in the expected
range, and simulation time advances correctly even when almost no frames are drawn — which is
the frame-rate-independence guarantee the game is built on.

Frame rate on a real GPU has **not** been measured in this environment. The expectation
(60 fps at 1080p on Medium/High on a modern desktop GPU) is an estimate, not a result.

### Console output

No uncaught runtime errors and no console errors during the run.

(WebAudio autoplay warnings from a muted headless browser are filtered as noise.)

## Full check transcript

- [x] boots to the title screen with no fatal error
- [x] new game enters play — `{"state":"playing","pos":{"x":-0.0000010338961828892934,"y":3.003596305847168,"z":42}}`
- [x] navigation graph is connected across the whole map — `{"nodes":52,"edges":163,"dropped":0,"unreachable":[],"reach":52}`
- [x] navigation edges are validated against real collision — `{"edges":163,"dropped":0}`
- [x] the player can walk the whole route from the gate to the bell-chamber landing on real physics — `{"reached":5,"waypoints":5,"steps":1154,"stuck":0,"falls":0,"alive":true,"x":0,"y":4.6,"z":-27.2}`
- [x] rapier physics is loaded — `0.21.0`
- [x] enemies are placed in the world — `alive=10`
- [x] HUD is visible in play
- [x] real keyboard input is captured and released correctly — `{"heldWhilePressed":true,"heldAfterRelease":false}`
- [x] player is held on the ground by the character controller — `y=3.02`
- [x] one and a half seconds of simulation moves the player at run speed — `moved 4.96m`
- [x] camera yaw steers movement (camera-relative controls) — `{"dx":-5.91,"dz":0.52}`
- [x] mouse look turns the camera — `{"dYaw":-0.528,"dPitch":-0.264,"residual":[0,0]}`
- [x] walls stop the player without tunnelling — `{"x":-10.61989974975586,"minX":-10.6202974319458,"minY":3.019782781600952,"insideSolid":false,"grounded":true,"fell":false}`
- [x] the player capsule never overlaps solid geometry — `{"x":-10.61989974975586,"minX":-10.6202974319458,"minY":3.019782781600952,"insideSolid":false,"grounded":true,"fell":false}`
- [x] snap-to-ground keeps the player grounded on flat floor — `{"x":-10.61989974975586,"minX":-10.6202974319458,"minY":3.019782781600952,"insideSolid":false,"grounded":true,"fell":false}`
- [x] light attacks damage an enemy — `74 -> 0 minBlade=1.02 [{"i":255,"at":0.27,"m":1.02,"d":0.74,"blocked":false,"hp":0,"st":"attackActive"}]`
- [x] attacking costs stamina — `stamina=85.0`
- [x] heavy attack (Q) damages an enemy — `158 -> 0`
- [x] dodge enters the dodge state and spends stamina — `{"dodgeState":"dodge","st0":100,"st1":80,"recovered":100,"backToIdle":true}`
- [x] stamina regenerates after the dodge — `80 -> 100`
- [x] dodge returns to a neutral state when it finishes — `dodge`
- [x] holding guard enters the guard stance and drains stamina — `{"guarded":true,"drained":true,"broken":true}`
- [x] guard breaks when stamina is exhausted — `{"guarded":true,"drained":true,"broken":true}`
- [x] emberflask heals and consumes a charge — `{"h0":48,"h1":94,"f0":3,"f1":2}`
- [x] enemies attack and damage the player — `minBlade=0.49 [{"i":1174,"m":0.49,"at":0.6,"st":"attackActive","tipRel":["0.42","1.63","-0.75"],"pRel":["0.32","0.36","-1.05"]}]`
- [x] death switches to the death state — `dead`
- [x] death drops the embers at the death point — `{"drop":{"embers":250,"x":-14.000000953674316,"y":0.020095892250537872,"z":-12,"collected":false},"pos":{"x":-14.000000953674316,"y":0.01999628357589245,"z":-12`
- [x] death zeroes the carried embers — `0`
- [x] death counter increments — `0 -> 1`
- [x] death screen appears with an ember message — `Your embers wait where you fell.`
- [x] respawn restores full health at the last checkpoint — `{"hp":120,"pos":{"x":0.000005377722118282691,"y":3.005793571472168,"z":42.000003814697266},"state":"playing"}`
- [x] respawn restores defeated enemies — `alive=10`
- [x] embers still wait at the drop site after respawn — `{"embers":0,"drop":{"embers":250,"x":-14.000000953674316,"y":0.020095892250537872,"z":-12,"collected":false},"visible":true}`
- [x] walking over the drop recovers the embers — `{"embers":250,"drop":null,"visible":false}`
- [x] checkpoint opens the rest panel — `{"state":"resting","exists":true,"hidden":false,"text":"Vigil Flame\n      Embers: 250Vitality: 120 / 120Stamina: 100 / 100Emberflask: 3 / 3\n      Vigil Body L`
- [x] upgrade raises max health and spends embers — `{"hp0":120,"hp1":142,"emb0":900,"emb1":830,"level":1,"health":164}`
- [x] upgrade is refused without enough embers — `{"hp1":142,"hp2":142,"embers":10}`
- [x] closed portcullis blocks the corridor — `{"opened":false,"x":-21.729902267456055}`
- [x] the shortcut gate opens and is recorded — `{"opened":true,"x":-11.831422805786133,"saved":true}`
- [x] the gate collider is removed so the corridor is walkable — `{"opened":true,"x":-11.831422805786133,"saved":true}`
- [x] boss fight starts on approach — `{"active":true,"visible":true,"hp":760,"max":760,"barrier":true}`
- [x] boss health bar is shown — `{"exists":true,"hidden":false,"text":"The Bellbound Warden"}`
- [x] arena barrier seals the entrance during the fight — `{"active":true,"visible":true,"hp":760,"max":760,"barrier":true}`
- [x] boss performs named attacks — `["attackWindup","attackActive","attackRecovery"]`
- [x] boss shows area telegraphs — `{"attacks":["attackWindup","attackActive","attackRecovery"],"sawPhase2":true,"telegraph":true,"damagedPlayer":true,"phase":2,"states":["transition","idle","run"`
- [x] boss damages the player — `{"attacks":["attackWindup","attackActive","attackRecovery"],"sawPhase2":true,"telegraph":true,"damagedPlayer":true,"phase":2,"states":["transition","idle","run"`
- [x] boss reaches phase two below the health threshold — `phase=2`
- [x] boss can be defeated and the kill is recorded — `{"defeated":true,"saved":true,"barrier":false,"reward":910}`
- [x] arena barrier is removed after the fight — `{"defeated":true,"saved":true,"barrier":false,"reward":910}`
- [x] the bell interaction is offered after the boss falls — `Ring the last bell`
- [x] ringing the last bell completes the game — `{"prompt":"Ring the last bell","rung":true,"state":"victory","saved":true,"shown":true}`
- [x] ending is recorded in the save — `{"prompt":"Ring the last bell","rung":true,"state":"victory","saved":true}`
- [x] save is written to localStorage with a version tag — `{"version":3,"createdAt":1793281486635,"updatedAt":1793281527172,"checkpointId":"cp_approa`
- [x] save reloads and validates against the current schema — `{"ok":true,"v":3,"gate":true,"boss":true,"bell":true,"upgrades":{"health":1,"stamina":0,"damage":0},"deaths":1}`
- [x] world progress persists across a reload — `{"ok":true,"v":3,"gate":true,"boss":true,"bell":true,"upgrades":{"health":1,"stamina":0,"damage":0},"deaths":1}`
- [x] continue resumes play with the persisted world — `{"state":"playing","gate":true,"boss":true,"hp":142}`
- [x] future / malformed / empty saves are rejected, not guessed — `{"future":false,"malformed":false,"empty":false,"partial":true,"level":5,"embers":0,"cp":"cp_approach"}`
- [x] partial saves are filled with defaults and clamped — `{"future":false,"malformed":false,"empty":false,"partial":true,"level":5,"embers":0,"cp":"cp_approach"}`
- [x] unknown checkpoint ids fall back to the default — `cp_approach`
- [x] all four quality presets render (headless SwiftShader is software-rendered) — `[["low",1,481],["medium",1,496],["high",2,498],["ultra",1,536]]`
- [x] render target follows the preset (low < ultra) — `896x503 vs 1280x720`
- [x] frame timing is frame-rate independent (sim keeps running) — `simTime advanced`
- [x] escape pauses and opens the pause menu — `{"state":"paused","exists":true,"hidden":false,"text":"Vigil Paused\n      \n        Resume\n        Settings\n        Controls\n        Abandon to title\n     `
- [x] controls overlay opens
- [x] settings overlay opens from the pause menu — `{"shown":true}`
- [x] render-scale slider changes the render target — `{"before":[1280,720],"after":[768,432]}`
- [x] no uncaught runtime errors or console errors
