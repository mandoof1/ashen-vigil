/**
 * Capture still frames of the running build for visual review.
 * node tools/shots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || !extname(p)) p = '/index.html';
  try { const b = await readFile(join(ROOT, 'dist', p.slice(1))); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(4190, r));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:4190/', { waitUntil: 'load' });
await page.waitForFunction(() => window.ASHEN && window.ASHEN.game && window.ASHEN.game.state === 'menu', null, { timeout: 90000 });
await mkdir(join(ROOT, 'shots'), { recursive: true });
const call = (fn, ...a) => page.evaluate(([src, ...rest]) => (0, eval)(`(${src})`)(...rest), [fn.toString(), ...a]);
const settle = async (n = 30) => { await page.waitForTimeout(n); };

await page.screenshot({ timeout: 120000, path: 'shots/01-title.png' });
await page.click('#btn-new');
await page.waitForTimeout(1500);
await page.screenshot({ timeout: 120000, path: 'shots/02-approach.png' });

// Cinematic framings: the camera is pinned at an explicit point and aimed at an explicit point,
// so the shot is composed rather than left to the gameplay rig. Facing is (-sin(yaw), -cos(yaw)).
const shots = [
  // name,        camera,            look-at,          player
  ['03-courtyard', [19, 5.0, 8], [-14, 0.8, -10], [6, 0.4, 2]],
  ['04-courtyard-brazier', [-8, 3.4, -5], [-14, 1.0, -12], [-11, 0.4, -8]],
  ['05-cloister', [23, 4.2, 2], [46, 0.5, 2], [31, 0.4, 2]],
  ['06-balcony', [37, 6.5, 1], [46, 3.2, -16], [42, 4.4, -6]],
  ['07-stair', [2, 4.0, -11], [-2, 4.6, -27], [-1, 0.4, -17]],
  ['08-chamber', [10, 9, -33], [-8, 5.5, -50], [5, 6.4, -34]],
  ['09-bell', [11, 9.2, -38], [-4, 6.0, -56], [4, 6.4, -40]],
  ['10-west-corridor', [-13, 3.2, -17.5], [-29, 1.0, -20], [-17, 0.4, -19]],
];
await call(() => { window.ASHEN.game.applyQualityPublic('ultra'); });
for (const [name, cam, look, pl] of shots) {
  await call(([n, c, l, p]) => {
    const g = window.ASHEN.game;
    g.player.teleport(p[0], p[1], p[2], Math.atan2(-(l[0] - p[0]), -(l[2] - p[2])));
    g.player.setState('idle');
    g.cam.pinCamera(c[0], c[1], c[2], l[0], l[1], l[2]);
  }, [name, cam, look, pl]);
  await page.waitForTimeout(4000);
  await page.screenshot({ timeout: 120000, path: `shots/${name}.png` });
  await call(() => { window.ASHEN.game.cam.clearCameraPin(); });
}

// combat frame: the player mid-swing against a brute, framed from the side
await call(() => {
  const g = window.ASHEN.game;
  const e = g.enemies.find((en) => en.alive && en.def.name === 'Ashbound Brute');
  const px = 31, pz = 2;
  const ex = px + 2.3, ez = pz + 0.3;
  const yaw = Math.atan2(-(ex - px), -(ez - pz));
  g.player.teleport(px, 0.4, pz, yaw);
  e.teleport(ex, 0.4, ez, yaw + Math.PI);
  e.__anchor = { x: ex, y: 0.4, z: ez };
  g.player.stamina.restore();
  g.cam.pinCamera(px - 3.0, 3.2, pz + 6.0, (px + ex) / 2 + 0.4, 1.3, (pz + ez) / 2);
  g.fixedUpdatePublic(1 / 60, ['attack']);
  for (let i = 0; i < 16; i++) { g.fixedUpdatePublic(1 / 60, []); e.teleport(ex, 0.4, ez, yaw + Math.PI); }
  g.player.syncVisual(1);
  g.ui.setVitals(g.player.health, g.player.maxHealth, g.player.stamina.current, g.player.stamina.max, g.player.flasks, g.player.maxFlasks, g.player.embers, 0);
});
await page.waitForTimeout(4000);
await page.screenshot({ timeout: 120000, path: 'shots/11-combat.png' });
await call(() => { window.ASHEN.game.cam.clearCameraPin(); });

// boss
await call(() => {
  const g = window.ASHEN.game;
  g.player.teleport(0, 6.2, -40, Math.PI);
  g.cam.snapBehind(Math.PI);
  if (!g.bossFightActive) g.startBossFightPublic();
  for (let i = 0; i < 200; i++) g.fixedUpdatePublic(1 / 60, []);
  g.player.health = g.player.maxHealth;
  g.player.stamina.restore();
  g.ui.setVitals(g.player.health, g.player.maxHealth, g.player.stamina.current, g.player.stamina.max, g.player.flasks, g.player.maxFlasks, g.player.embers, 0);
});
await page.waitForTimeout(4000);
await page.screenshot({ timeout: 120000, path: 'shots/12-boss.png' });

// rest panel + upgrades
await call(() => { const g = window.ASHEN.game; g.player.embers = 800; g.openRestPublic('cp_stair'); });
await page.waitForTimeout(1200);
await page.screenshot({ timeout: 120000, path: 'shots/13-rest.png' });
await call(() => { window.ASHEN.game.ui.actionHandler('rest-close'); window.ASHEN.game.ui.show('settings'); window.ASHEN.game.ui.syncSettings(window.ASHEN.game.quality, window.ASHEN.game.settings); });
await page.waitForTimeout(800);
await page.screenshot({ timeout: 120000, path: 'shots/14-settings.png' });

await browser.close();
server.close();
console.log('captured shots/');
