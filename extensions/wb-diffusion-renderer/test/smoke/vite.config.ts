import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));

/**
 * Loopback-only, development-only app. The page drives the production
 * Generative Visuals Presenter + LingBot adapter with fixed fixtures and
 * proxies only the token broker contract (never the Reactor media plane).
 */
export default {
  root: directory,
  server: {
    host: '127.0.0.1',
    port: 18921,
    strictPort: true,
    fs: {
      allow: [resolve(directory, '..')],
    },
    proxy: {
      '/api/generative-visuals/reactor': {
        target: 'http://127.0.0.1:18900',
      },
    },
  },
};
