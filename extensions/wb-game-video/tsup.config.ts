import { cp } from 'node:fs/promises'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/mount.tsx',
    'server/host': 'server/host.ts',
  },
  outDir: 'dist',
  dts: true,
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  esbuildOptions(options) {
    // `mount()` is consumed from a pre-built npm package. Keep every asset it
    // imports self-contained so a host bundler never has to resolve a relative
    // URL next to an emitted JS chunk (Arrival mounts it in-process).
    options.loader = {
      ...options.loader,
      '.svg': 'dataurl',
      '.png': 'dataurl',
    }
  },
  splitting: false,
  sourcemap: true,
  clean: false,
  external: ['@forgeax/extension-platform'],
  noExternal: ['@forgeax-extension/wb-asset-canvas'],
  onSuccess: async () => {
    await cp('server/engine/llm/skills', 'dist/skills', { recursive: true })
    await cp(
      'src/runtime/component-host/components/HYShangWei.woff2',
      'dist/HYShangWei.woff2',
    )
  },
})
