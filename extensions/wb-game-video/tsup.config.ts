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
  splitting: false,
  sourcemap: true,
  clean: false,
  external: ['@forgeax/extension-platform'],
  onSuccess: async () => {
    await cp('server/engine/llm/skills', 'dist/skills', { recursive: true })
  },
})
