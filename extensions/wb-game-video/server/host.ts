import { defineWorkbenchExtension } from '@forgeax/workbench-host/node'
import { createNodiaSeed, validateNodiaSeed } from './host/nodia-seed'
import { createWbGameVideoRouter } from './host/router'
import { tools } from './tool-handlers'

export const host = defineWorkbenchExtension({
  tools,
  gamePackage: {
    platform: 'wb-game-video',
    createSeed: createNodiaSeed,
    async validateSeed(seed) {
      validateNodiaSeed(seed)
    },
  },
  createRouter: createWbGameVideoRouter,
})

export { tools }
export default host
