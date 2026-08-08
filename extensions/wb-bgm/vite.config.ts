import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

import tools from './server/tool-handlers.ts';

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk: Buffer | string) => {
      body += chunk.toString();
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function packagedAudioToolsPlugin(): Plugin {
  return {
    name: 'packaged-audio-tools',
    configureServer(server) {
      server.middlewares.use('/api/tools/call', async (request, response) => {
        const sendJson = (status: number, value: unknown) => {
          response.writeHead(status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(value));
        };

        if (request.method !== 'POST') {
          sendJson(405, { ok: false, error: 'method not allowed', code: 'method_not_allowed' });
          return;
        }

        try {
          const body = JSON.parse(await readBody(request)) as {
            toolId?: unknown;
            args?: unknown;
          };
          if (body.toolId !== 'bgm:backend') {
            sendJson(200, {
              ok: false,
              error: `standalone mode only serves bgm:backend (got ${String(body.toolId ?? '')})`,
              code: 'not_supported',
            });
            return;
          }
          const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args)
            ? body.args
            : {};
          const result = await tools['bgm:backend'](
            args as Parameters<typeof tools['bgm:backend']>[0],
            { caller: { kind: 'user' }, toolId: 'bgm:backend' },
          );
          sendJson(200, { ok: true, result });
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'invoke_error';
          sendJson(200, { ok: false, error: String(error), code });
        }
      });
    },
  };
}

export default defineConfig({
  base: '/extensions/wb-bgm/',
  plugins: [packagedAudioToolsPlugin()],
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
