# Licences

## 1. This game

**ASHEN VIGIL: THE LAST BELL** — source code, level data, shaders, procedural texture/audio
generation, animation definitions, writing and design.

MIT License

Copyright (c) 2026 The author of Ashen Vigil: The Last Bell

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## 2. Assets: nothing is hotlinked, nothing is third-party

Every visual and audio element in the shipped build is generated at runtime by this
repository's code. There are **no image files, no audio files, no model files and no font
files** in `dist/`.

| Asset | Where it comes from |
| --- | --- |
| Stone / wood / metal / cloth / ground texture sets | `src/render/Textures.ts` — value-noise fbm, drawn to canvas |
| Night sky, moon, stars, ember horizon glow | `src/render/Textures.ts` → `makeSkyCanvas` |
| Grass / moss tufts | `src/render/Textures.ts` → `makeTuftTexture` |
| Glow sprites, spark sprites, decals | `src/render/Textures.ts` → `makeRadialSprite` |
| Characters, the Warden, weapons, props, architecture | `src/render/HumanoidRig.ts`, `GeometryUtils.ts`, `world/LevelBuilder.ts` |
| Animation (walk, attack, guard, stagger, boss phases) | `src/render/Animators.ts` — procedural pose generation |
| All sound (UI, hits, flames, ambience, boss bell) | `src/audio/Audio.ts` — WebAudio synthesis |
| UI type | System fonts only: Georgia / Times New Roman / system-ui. No font files are shipped. |

Consequence: redistributing `dist/` (or the ZIP in this repository) needs no asset licences
beyond the two runtime dependencies below.

---

## 3. Bundled runtime dependencies

### three.js — MIT

```
three.js
https://threejs.org/
Copyright (c) 2010-2026 three.js authors
Version used: 0.186.1
```

The MIT License — full text as shipped in `node_modules/three/LICENSE`:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify, merge,
> publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
> to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
> PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
> FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

### Rapier — Apache License 2.0

```
Rapier 3D physics engine (@dimforge/rapier3d-compat)
https://www.rapier.rs/
Copyright (c) 2019 The Rapier authors
Version used: 0.21.0
```

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file
except in compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the
License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
either express or implied. See the License for the specific language governing permissions
and limitations under the License.

The full Apache-2.0 text ships in `node_modules/@dimforge/rapier3d-compat/LICENSE`. The
`-compat` package inlines the compiled WebAssembly build of the Rust engine as base64 so the
game needs no separate `.wasm` fetch; that compiled binary is covered by the same Apache-2.0
licence.

---

## 4. Development-only dependencies

These are not shipped in `dist/` and do not affect the licence of the game build:
`vite@7.3.0` (MIT), `typescript@5.9.3` (MIT / Apache-2.0), `vitest@3.2.4` (MIT),
`playwright@1.64.1` (Apache-2.0), `@types/three@0.186.0` (MIT), `@types/node@24.10.1` (MIT).
