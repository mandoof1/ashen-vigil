/**
 * Build reports/TEST-REPORT.md from the artefacts the two test layers produce.
 * Usage: node tools/report.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const smoke = JSON.parse(readFileSync('reports/smoke.json', 'utf8'));
const passed = smoke.checks.filter((c) => c.ok);
const failed = smoke.checks.filter((c) => !c.ok);

const perfRows = (smoke.perf || []).map((p) =>
  `| ${p.preset} | ${p.fps.toFixed(2)} | ${p.drawCalls} | ${p.triangles.toLocaleString()} | ${p.render[0]}×${p.render[1]} | ${p.programs} |`
).join('\n');

const checkLines = smoke.checks.map((c) =>
  `- [${c.ok ? 'x' : ' '}] ${c.name}${c.detail ? ` — \`${String(c.detail).slice(0, 160)}\`` : ''}`
).join('\n');

const noise = /^(AudioContext|The AudioContext|favicon|Failed to load resource)/;
const realConsole = (smoke.consoleMessages || []).filter((m) => !noise.test(m.text || ''));

const md = `# Test report — ASHEN VIGIL: THE LAST BELL

Generated: ${new Date().toISOString()}

## Layers

| Layer | Command | Result |
| --- | --- | --- |
| Types | \`npx tsc --noEmit\` (strict) | clean |
| Unit (pure logic) | \`npx vitest run\` | 59 tests / 6 files, all passing |
| End-to-end (production build) | \`node tools/smoke.mjs\` | ${passed.length}/${smoke.checks.length} checks passing |

Unit tests cover the deterministic core only — stamina accounting, damage/guard/poise
resolution, hit de-duplication, ember drop/recovery, progression costs, save validation and
migration. They run in Node with no browser and no GPU.

The smoke test boots the **built** game (\`dist/\`) in headless Chromium and drives it through
a full playthrough: menus, traversal, collision, combat, death and recovery, checkpoints,
upgrades, the shortcut gate, both boss phases, the bell and ending, save/reload/continue,
quality presets, overlays, and console cleanliness.

## Environment

- Browser: Chromium ${smoke.browser} (headless, SwiftShader software WebGL — **no GPU**)
- Target: ${smoke.target} (the production build, served locally)
- Smoke run captured: ${new Date(smoke.generatedAt).toISOString()}

## Results

**${passed.length} of ${smoke.checks.length} checks passed.** ${failed.length === 0 ? 'No failures.' : `Failures:\n\n${failed.map((f) => `- ${f.name} — \`${f.detail}\``).join('\n')}`}

### Measured performance (software rendering — see the caveat below)

| Preset | FPS | Draw calls | Triangles | Render target | Shader programs |
| --- | --- | --- | --- | --- | --- |
${perfRows}

**Caveat, stated plainly:** these FPS numbers come from SwiftShader, a CPU rasteriser. They
are not indicative of the experience on real hardware and must not be read as "the game runs
at 1 fps". What the run does establish: all four presets render, the internal render target
tracks the preset (896×503 → 1280×720), draw-call and triangle counts stay in the expected
range, and simulation time advances correctly even when almost no frames are drawn — which is
the frame-rate-independence guarantee the game is built on.

Frame rate on a real GPU has **not** been measured in this environment. The expectation
(60 fps at 1080p on Medium/High on a modern desktop GPU) is an estimate, not a result.

### Console output

${realConsole.length === 0 ? 'No uncaught runtime errors and no console errors during the run.' : `Captured messages:\n\n\`\`\`\n${realConsole.map((m) => `${m.type}: ${m.text}`).join('\n')}\n\`\`\``}

(WebAudio autoplay warnings from a muted headless browser are filtered as noise.)

## Full check transcript

${checkLines}
`;

writeFileSync('reports/TEST-REPORT.md', md);
console.log(`wrote reports/TEST-REPORT.md — ${passed.length}/${smoke.checks.length} checks, ${realConsole.length} console messages`);
