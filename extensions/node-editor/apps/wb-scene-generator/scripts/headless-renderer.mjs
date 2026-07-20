#!/usr/bin/env node
/**
 * Headless renderer daemon for wb-scene-generator.
 *
 * The agent screenshot path (scene:screenshot.capture →
 * POST /api/v1/agent/screenshot/capture) needs a LIVE browser viewer connected
 * to the backend `/ws`: capture broadcasts `screenshot:request` and waits for a
 * renderer to POST the PNG back to /api/v1/agent/screenshot/store. There is no
 * server-side renderer. So if no human has the renderer preview pane open (or a
 * self-signed cert blocks their wss in a sub-iframe), the agent's capture always
 * times out.
 *
 * This daemon runs the EXISTING `?pane=renderer` surface (RendererSurface, which
 * mounts useScreenshotCapture) inside a headless Chromium with
 * ignoreHTTPSErrors=true — so it bypasses the self-signed cert and stays
 * connected as an always-on renderer. No change to the render mechanism or any
 * interface; this is pure orchestration. The surface live-syncs the graph via
 * the kernel WS events (useNodePreviews / useBakedLayers), so screenshots always
 * reflect the latest scene — and because the daemon uses the SAME surface and
 * the SAME `renderFrame()` / `getFrameCanvas()` capture seam as the toolbar
 * "Save screenshot" button, an agent capture is byte-identical to the button.
 *
 * Lifecycle: retries the initial load until the frontend is up; relaunches the
 * browser on crash/disconnect; exits cleanly on SIGTERM (run.sh cleanup).
 * Disable with FORGEAX_LOWPOLY_HEADLESS_RENDERER=0 (the generic host
 * orchestrator scripts/run.sh feature-detects + launches this file and gates it
 * on that same env var, so we honor it for parity with the other workbenches).
 */
const PORT =
  process.env.SCENE_FRONTEND_PORT ||
  process.env.LOWPOLY_FRONTEND_PORT ||
  process.env.VITE_DEV_PORT ||
  '9555';
const PROTO = (process.env.VITE_DEV_HTTPS_CERT && process.env.VITE_DEV_HTTPS_KEY) ? 'https' : 'http';
const URL = process.env.SCENE_RENDERER_URL || `${PROTO}://localhost:${PORT}/?pane=renderer`;

if (process.env.FORGEAX_LOWPOLY_HEADLESS_RENDERER === '0') {
  console.log('[scene-renderer] disabled via FORGEAX_LOWPOLY_HEADLESS_RENDERER=0');
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.warn('[scene-renderer] playwright not installed — skipping headless renderer (agent screenshots need a manually-opened renderer panel).');
  process.exit(0);
}

let browser = null;
let stopping = false;

async function waitForFrontend(maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline && !stopping) {
    try {
      // A failed fetch (e.g. self-signed cert) still means the port is up;
      // ECONNREFUSED means the vite dev server is not listening yet.
      await fetch(URL).catch((e) => { if (String(e).includes('ECONNREFUSED')) throw e; });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return !stopping;
}

async function launch() {
  if (stopping) return;
  try {
    await waitForFrontend();
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 960 } });
    const page = await ctx.newPage();
    browser.on('disconnected', () => { if (!stopping) { console.warn('[scene-renderer] browser disconnected — relaunching'); setTimeout(launch, 2000); } });
    // Retry the nav until the surface actually loads (frontend may still be warming up).
    let navigated = false;
    for (let i = 0; i < 30 && !stopping; i++) {
      try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 }); navigated = true; break; }
      catch { await new Promise((r) => setTimeout(r, 2000)); }
    }
    if (!navigated) throw new Error('navigation to surface failed after retries');
    // Process-up ≠ serving. The screenshot WS only connects once the renderer
    // surface mounts (canvas present). Wait for it so the "ready" signal is
    // truthful and we don't report ready during the post-restart window where
    // capture would still time out.
    await page.waitForSelector('canvas', { timeout: 25000 }).catch(() => {});
    const ready = await page.$('canvas');
    if (ready) console.log(`[scene-renderer] ready & serving (renderer mounted) → ${URL}`);
    else { console.warn('[scene-renderer] loaded but renderer canvas absent — relaunching'); throw new Error('canvas absent'); }
  } catch (e) {
    console.warn('[scene-renderer] launch failed:', String(e).slice(0, 160));
    if (!stopping) setTimeout(launch, 3000);
  }
}

async function shutdown() {
  stopping = true;
  try { await browser?.close(); } catch { /* noop */ }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

launch();
// keep the event loop alive
setInterval(() => {}, 1 << 30);
