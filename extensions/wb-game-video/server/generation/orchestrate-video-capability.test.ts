import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateVideo, type OrchestrateCtx } from './orchestrate'
import type { VideoGenerationRequest } from './video-generation-gateway'

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
  it('sends reference bytes to the host capability and persists the generated video locally', async () => {
    const invoke = vi.fn(async (_id: string, _version: number, value: unknown) => {
      const request = value as VideoGenerationRequest
      expect(request.references.map(({ role, assetId, mime, bytes }) => ({
        role, assetId, mime, text: Buffer.from(bytes).toString(),
      }))).toEqual([
        { role: 'first_frame', assetId: 'continuity', mime: 'image/png', text: 'continuity' },
        { role: 'reference_image', assetId: 'character', mime: 'image/png', text: 'character' },
        { role: 'reference_image', assetId: 'scene', mime: 'image/png', text: 'scene' },
      ])
      expect(value).not.toHaveProperty('imageWithRoles')
      return {
        video: {
          bytes: Uint8Array.from(Buffer.from('kino-video')),
          mime: 'video/mp4',
          sourceUrl: 'https://cdn.example/generated.mp4',
          generationId: 'generation-1',
          providerTaskId: 'seedance-task-1',
          model: 'seedance2',
          provider: {
            kind: 'kino',
            ref: 'https://cdn.example/generated.mp4',
            upstreamResourceId: 'resource-1',
          },
        },
      }
    })

    const context = createContext(invoke)
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
      id: expect.stringMatching(/^a-vid-/),
      kind: 'video',
      productionType: 'video_clip',
      status: 'ready',
      sceneNodeId: 'node-1',
      durationMs: 5000,
      mime: 'video/mp4',
      bytes: 10,
      url: 'https://cdn.example/generated.mp4',
      provider: {
        kind: 'kino',
        ref: 'https://cdn.example/generated.mp4',
        upstreamResourceId: 'resource-1',
      },
      meta: {
        generationId: 'generation-1',
        providerTaskId: 'seedance-task-1',
        model: 'seedance2',
      },
    })
    expect(asset.file).toBeTruthy()
    expect(existsSync(join(context.dir, asset.file!))).toBe(true)
    expect(readFileSync(join(context.dir, asset.file!), 'utf8')).toBe('kino-video')
    expect(JSON.parse(readFileSync(join(context.dir, 'manifest.json'), 'utf8')).assets).toHaveLength(4)
  })
})
