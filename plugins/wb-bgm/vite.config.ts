import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

// wb-bgm 锁定 Local 环境（仅用于 vite 独立开发态；嵌入 Workbench 时走 /api/wb/bgm/*）。
// 后端地址/凭证从环境变量读取，不写进源码——本地开发请 export 或放 .env（见 .env.example）。
const LOCAL_BASE = process.env.WB_BGM_BACKEND_BASE ?? '';
const SANDBOX_KEY = process.env.WB_BGM_SANDBOX_KEY ?? '';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function apiProxyPlugin(): Plugin {
  return {
    name: 'api-proxy',
    configureServer(server) {
      // CORS preflight
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method === 'OPTIONS' && req.url?.startsWith('/api/')) {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          res.end();
          return;
        }
        next();
      });

      // POST /api/tools/call — standalone-dev shim for the bgm:backend tool.
      // Embedded in Workbench this hits the host ToolRegistry; here (vite `npm
      // run dev`) we emulate it so the SPA's library browser still works, by
      // doing the same Local-forced upstream proxy and wrapping the result in
      // the ToolResult envelope { ok, result } the SPA expects.
      server.middlewares.use('/api/tools/call', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return;
        const sendJson = (status: number, obj: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(obj));
        };
        try {
          const body = JSON.parse(await readBody(req));
          if (body.toolId !== 'bgm:backend') {
            sendJson(200, { ok: false, error: `standalone dev only emulates bgm:backend (got ${body.toolId})`, code: 'not_supported' });
            return;
          }
          const endpoint = body.args?.endpoint || '';
          const payload = body.args?.payload || {};
          const resp = await fetch(`${LOCAL_BASE}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Sandbox-Key': SANDBOX_KEY },
            body: JSON.stringify(payload),
          });
          const text = await resp.text();
          if (!resp.ok) { sendJson(200, { ok: false, error: `backend ${endpoint} → HTTP ${resp.status}`, code: 'backend-error' }); return; }
          let result: unknown;
          try { result = JSON.parse(text); } catch { sendJson(200, { ok: false, error: 'backend returned non-JSON', code: 'backend-bad-json' }); return; }
          sendJson(200, { ok: true, result });
        } catch (e) {
          sendJson(200, { ok: false, error: String(e), code: 'invoke_error' });
        }
      });

      // GET /api/wb/bgm/cos-proxy?url=... — 代理 COS 文件下载（解决 CORS）
      server.middlewares.use('/api/wb/bgm/cos-proxy', async (req: IncomingMessage, res: ServerResponse) => {
        const parsed = new URL(req.url || '', 'http://localhost');
        const targetUrl = parsed.searchParams.get('url');
        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }
        try {
          // Forward the browser's Range header so <audio>/<video> learns the
          // total duration (via Content-Range) and can seek.
          const range = req.headers['range'];
          const resp = await fetch(targetUrl, range ? { headers: { Range: String(range) } } : undefined);
          if (!resp.ok && resp.status !== 206) {
            res.writeHead(resp.status);
            res.end(`Upstream returned ${resp.status}`);
            return;
          }
          const contentType = resp.headers.get('content-type') || 'application/octet-stream';
          const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
          };
          for (const h of ['content-length', 'content-range', 'last-modified', 'etag']) {
            const v = resp.headers.get(h);
            if (v) headers[h] = v;
          }
          const acceptRanges = resp.headers.get('accept-ranges');
          if (acceptRanges) headers['Accept-Ranges'] = acceptRanges;
          else if (resp.status === 206 || resp.headers.get('content-range')) headers['Accept-Ranges'] = 'bytes';
          res.writeHead(resp.status, headers);

          const reader = resp.body?.getReader();
          if (reader) {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          }
          res.end();
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  base: '/plugins/wb-bgm/',
  plugins: [apiProxyPlugin()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    assetsDir: 'assets',
  },
});
