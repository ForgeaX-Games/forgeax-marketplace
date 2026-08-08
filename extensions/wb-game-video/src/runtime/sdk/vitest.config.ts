import { defineConfig } from 'vitest/config'

/** Isolated config so SDK unit tests do not load the Workbench dev-host Vite plugin. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/runtime/sdk/**/__tests__/**/*.test.ts'],
  },
})
