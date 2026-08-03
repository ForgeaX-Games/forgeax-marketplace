import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateVideo, type OrchestrateCtx } from './orchestrate'

const roots: string[] = []

function createContext(invoke: NonNullable<OrchestrateCtx['capabilities']>['invoke']): OrchestrateCtx {
  const dir = mkdtempSync(join(tmpdir(), 'wb-game-video-capability-'))
  roots.push(dir)
  mkdirSync(join(dir, 'media'), { recursive: true })
  writeFileSync(join(dir, 'media', 'character.png'), 'character')
  writeFileSync(join(dir, 'media', 'scene.png'), 'scene')
  writeFileSync(join(dir, 'media', 'continuity.png'), 'continuity')
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    version: 2,
    assets: [
      {
        id: 'character', kind: 'image', productionType: 'character_ref', status: 'ready',
        file: 'media/character.png', mime: 'image/png', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'scene', kind: 'image', productionType: 'scene_ref', status: 'ready',
        file: 'media/scene.png', mime: 'image/png', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'continuity', kind: 'image', productionType: 'shot_image', status: 'ready',
        file: 'media/continuity.png', mime: 'image/png', createdAt: 1, updatedAt: 1,
      },
    ],
  }))
  return { dir, gameId: 'game-1', capabilities: { invoke } }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('generateVideo capability seam', () => {
  it('uses the host extension-platform capability instead of the legacy gateway and returns its MediaAsset binding', async () => {
    const invoke = vi.fn(async (_id: string, _version: number, value: unknown) => {
      expect(value).toMatchObject({
        references: [
          { role: 'first_frame', assetId: 'continuity' },
          { role: 'reference_image', assetId: 'character' },
          { role: 'reference_image', assetId: 'scene' },
        ],
      })
      expect(value).not.toHaveProperty('imageWithRoles')
      return {
        asset: {
          id: 'host-video-1', kind: 'video', status: 'ready', mime: 'video/mp4',
          createdAt: 2, updatedAt: 2, provider: { kind: 'kino', ref: 'generation-1' },
        },
      }
    })

    const context = createContext(invoke)
    // Capability hosts resolve asset IDs themselves; this path must not read local
    // bytes or call the legacy resource endpoint before invoking the host bridge.
    rmSync(join(context.dir, 'media', 'character.png'))
    rmSync(join(context.dir, 'media', 'scene.png'))
    rmSync(join(context.dir, 'media', 'continuity.png'))
    const asset = await generateVideo(context, {
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      storyText: 'A heroine enters a rainy cyberpunk alley.',
      durationSeconds: 5,
      characterRefIds: ['character'],
      sceneRefIds: ['scene'],
      continuityFirstFrameId: 'continuity',
    })

    expect(invoke).toHaveBeenCalledWith(
      'media.video.generate',
      1,
      expect.objectContaining({ durationSeconds: 5, generateAudio: false }),
      { requestId: expect.stringMatching(/^wb-game-video-v1-[0-9a-f]{64}$/) },
    )
    expect(asset).toMatchObject({
      id: 'host-video-1', kind: 'video', productionType: 'video_clip', status: 'ready',
      sceneNodeId: 'node-1', durationMs: 5000,
      provider: { kind: 'kino', ref: 'generation-1' },
    })
    expect(JSON.parse(readFileSync(join(context.dir, 'manifest.json'), 'utf8')).assets)
      .toHaveLength(3)
  })
})
