import { describe, expect, it, vi } from 'vitest'
import type { WorkbenchExtensionContext } from '@forgeax/workbench-host/node'

const { generateShotScript } = vi.hoisted(() => ({
  generateShotScript: vi.fn(async () => []),
}))

vi.mock('../generation/orchestrate', () => ({
  createHostGenerationOrchestrator: () => ({
    generateShotScript,
    generateKeyframe: vi.fn(),
    generateVideo: vi.fn(),
    generateNodeVideo: vi.fn(),
  }),
}))

import { createWbGameVideoService } from './wb-service'

describe('wb-service style axes', () => {
  it('passes only supplied style-axis override keys to the orchestrator', async () => {
    const context = {
      gameId: 'demo',
      files: {},
    } as unknown as WorkbenchExtensionContext
    const service = createWbGameVideoService(context)

    await service.generateShotScript({
      nodeName: 'Opening',
      storyText: 'Hero enters',
      durationSeconds: 4,
      styleAxes: { director: 'precision-noir' },
    })

    expect(generateShotScript).toHaveBeenCalledWith(expect.objectContaining({
      styleAxes: { director: 'precision-noir' },
    }))
  })
})
