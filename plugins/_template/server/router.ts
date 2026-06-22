/* Template plugin's server router. Studio host mounts this via:
 *   import { createTemplateRouter } from '.../plugins/_template/server/router';
 *   app.route('/api/wb/template', createTemplateRouter(ctx));
 *
 * The router is plain Hono so it composes inside the Studio app. The ctx
 * object is the plugin-server context — see Module 02 manifest spec for
 * what host passes in (projectRoot, fs, bus, etc.).
 *
 * When the plugin runs standalone via `npm run dev`, this file is NOT
 * loaded — standalone mode hits the dev server's mock at /api/bus/tools/*.
 */
import { Hono } from 'hono';

export interface TemplatePluginCtx {
  projectRoot: string;
  dispatchToSurface: (surfaceId: string, toolId: string, args: unknown) => string;
}

export function createTemplateRouter(ctx: TemplatePluginCtx) {
  const app = new Hono();

  app.get('/status', (c) => c.json({ ok: true, pluginId: '@forgeax-plugin/_template' }));

  app.post('/echo', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = String(body?.args?.text ?? body?.text ?? '');
    const result = { echoed: text, at: Date.now() };

    // Notify any connected iframe that something happened. This is the
    // dual-modality hookup — AI calling this endpoint causes the UI to
    // re-render exactly the same way the user clicking would.
    ctx.dispatchToSurface('template', 'template:echo-result', result);

    return c.json(result);
  });

  return app;
}
