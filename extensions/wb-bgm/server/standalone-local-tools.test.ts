import { describe, expect, test } from 'bun:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import viteConfig from '../vite.config.ts';

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void> | void;

describe('standalone packaged audio tools', () => {
  test('serves FindAssetMeta through the Vite /api/tools/call shim', async () => {
    const config = viteConfig as {
      plugins?: Array<{
        name?: string;
        configureServer?: (server: unknown) => void;
      }>;
    };
    const plugin = config.plugins?.find((candidate) => candidate.name === 'packaged-audio-tools');

    expect(plugin).toBeDefined();

    let route = '';
    let middleware: Middleware | undefined;
    if (typeof plugin?.configureServer !== 'function') {
      throw new Error('packaged-audio-tools must configure the Vite server');
    }
    plugin.configureServer({
      middlewares: {
        use(path: string, handler: Middleware) {
          route = path;
          middleware = handler;
        },
      },
    });

    expect(route).toBe('/api/tools/call');
    expect(middleware).toBeDefined();

    const requestBody = JSON.stringify({
      toolId: 'bgm:backend',
      args: {
        endpoint: 'FindAssetMeta',
        payload: {
          query: { asset_type: 7, tag: 'rpg turn confirm' },
          pagination: { page_num: 1, page_size: 5 },
        },
      },
      caller: { kind: 'user' },
    });
    const request = Readable.from([requestBody]) as unknown as IncomingMessage;
    Object.assign(request, { method: 'POST', url: '/' });

    let statusCode = 0;
    let responseBody = '';
    const response = {
      writeHead(code: number) {
        statusCode = code;
        return response;
      },
      end(chunk?: string | Buffer) {
        if (chunk) responseBody += chunk.toString();
        return response;
      },
    } as unknown as ServerResponse;

    await middleware!(request, response, () => {
      throw new Error('local tool route unexpectedly fell through');
    });

    expect(statusCode).toBe(200);
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      result: {
        total: 1,
        asset_meta_info_list: [{ type: 7 }],
      },
    });
  });
});
