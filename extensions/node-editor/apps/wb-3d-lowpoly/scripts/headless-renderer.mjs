#!/usr/bin/env node
/**
 * Headless renderer daemon for wb-3d-lowpoly.
 *
 * The screenshot path (lowpoly:screenshot.capture) needs a LIVE browser viewer
 * connected to the backend `/ws`: capture broadcasts `screenshot:request` and
 * waits for a renderer to POST the PNG back to /api/v1/agent/screenshot/store.
 * There is no server-side renderer. So if no human has the URDF preview panel
 * open (or a self-signed cert blocks their wss in a sub-iframe), the agent's
 * capture always times out.
 *
 * This daemon runs the EXISTING `?pane=urdf` surface (UrdfViewerSurface, which
 * mounts useScreenshotCapture) inside a headless Chromium with
 * ignoreHTTPSErrors=true — so it bypasses the self-signed cert and stays
 * connected as an always-on renderer. No change to the render mechanism or any
 * interface; this is pure orchestration. The viewer live-syncs the graph via
 * the kernel `graph:applied` events, so screenshots always reflect the latest.
 *
 * Lifecycle: retries the initial load until the frontend is up; relaunches the
 * browser on crash/disconnect; exits cleanly on SIGTERM (run.sh cleanup).
 * Disable with FORGEAX_LOWPOLY_HEADLESS_RENDERER=0.
 */
const PORT = process.env.LOWPOLY_FRONTEND_PORT || process.env.VITE_DEV_PORT || '9565';
const PROTO = (process.env.VITE_DEV_HTTPS_CERT && process.env.VITE_DEV_HTTPS_KEY) ? 'https' : 'http';
const URL = process.env.LOWPOLY_RENDERER_URL || `${PROTO}://localhost:${PORT}/?pane=urdf`;

if (process.env.FORGEAX_LOWPOLY_HEADLESS_RENDERER === '0') {
  console.log('[lowpoly-renderer] disabled via FORGEAX_LOWPOLY_HEADLESS_RENDERER=0');
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.warn('[lowpoly-renderer] playwright not installed — skipping headless renderer (agent screenshots need a manually-opened URDF panel).');
  process.exit(0);
}

let browser = null;
let stopping = false;

async function waitForFrontend(maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline && !stopping) {
    try {
      // node fetch; ignore cert via undici not trivial, so just probe TCP-ish via fetch to http? frontend is https.
      // A failed fetch (cert) still means the port is up; ECONNREFUSED means not yet.
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
    browser.on('disconnected', () => { if (!stopping) { console.warn('[lowpoly-renderer] browser disconnected — relaunching'); setTimeout(launch, 2000); } });
    // Retry the nav until the surface actually loads (frontend may still be warming up).
    let navigated = false;
    for (let i = 0; i < 30 && !stopping; i++) {
      try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 }); navigated = true; break; }
      catch { await new Promise((r) => setTimeout(r, 2000)); }
    }
    if (!navigated) throw new Error('navigation to surface failed after retries');
    // Process-up ≠ serving. The screenshot WS only connects once the viewer
    // surface mounts (canvas present). Wait for it so the "ready" signal is
    // truthful and we don't report ready during the post-restart window where
    // capture would still time out.
    await page.waitForSelector('canvas', { timeout: 25000 }).catch(() => {});
    const ready = await page.$('canvas');
    if (ready) console.log(`[lowpoly-renderer] ready & serving (viewer mounted) → ${URL}`);
    else { console.warn('[lowpoly-renderer] loaded but viewer canvas absent — relaunching'); throw new Error('canvas absent'); }
  } catch (e) {
    console.warn('[lowpoly-renderer] launch failed:', String(e).slice(0, 160));
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
