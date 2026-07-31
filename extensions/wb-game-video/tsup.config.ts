import { cp } from 'node:fs/promises'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['server/tool-handlers.ts'],
  outDir: 'dist/server',
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
