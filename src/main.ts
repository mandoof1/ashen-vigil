/**
 * Entry point. Verifies WebGL2 with a readable message, then boots the game.
 * `window.ASHEN` is exposed for the automated smoke test and for debugging.
 */
import './styles.css';
import { Game } from './bootstrap/Game';
import { UI } from './ui/UI';

function detectWebGL2(): { ok: boolean; reason: string } {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { ok: false, reason: 'This browser cannot create a WebGL2 context. Ashen Vigil requires WebGL2 (Chrome, Edge, Firefox or Safari 15+). Try a different browser, or enable hardware acceleration.' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown device';
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    void rendererName;
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: false, reason: `WebGL2 could not be initialised: ${e instanceof Error ? e.message : 'unknown error'}` };
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) return;
  const support = detectWebGL2();
  if (!support.ok) {
    try {
      const ui = new UI();
      ui.showCompat(support.reason);
    } catch {
      const loading = document.getElementById('loading');
      if (loading) loading.innerHTML = `<div class="load-inner"><div class="load-title">ASHEN VIGIL</div><div class="load-text">${support.reason}</div></div>`;
    }
    return;
  }
  const game = new Game(canvas);
  (window as unknown as { ASHEN: Record<string, unknown> }).ASHEN = {
    version: '1.0.0',
    bootedAt: Date.now(),
    game,
    state: () => game.testState,
  };
  try {
    await game.boot();
  } catch (err) {
    console.error('Ashen Vigil failed to start', err);
    const ui = new UI();
    ui.showCompat(`The game failed to start: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

void main();
