import { defineWorkbenchExtension } from '@forgeax/workbench-host/node'
import { createEmptyLibrarySeed, validateEmptyLibrarySeed } from './host/empty-library-seed'
import { createNodiaSeed, validateNodiaSeed } from './host/nodia-seed'
import { createWbGameVideoRouter } from './host/router'
import { tools } from './tool-handlers'

export const host = defineWorkbenchExtension({
  tools,
  gamePackage: {
    platform: 'wb-game-video',
    createSeed: (context) => createEmptyLibrarySeed(context),
    async validateSeed(seed) {
      validateEmptyLibrarySeed(seed)
    },
  },
  createRouter: createWbGameVideoRouter,
})

export { tools, createNodiaSeed, validateNodiaSeed, createEmptyLibrarySeed, validateEmptyLibrarySeed }
export default host
