import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const gatewayMocks = vi.hoisted(() => ({
  genVideoAndWait: vi.fn(),
}))

vi.mock('./gateway-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gateway-client')>()),
  genVideoAndWait: gatewayMocks.genVideoAndWait,
}))

import { listAssets, upsertAsset, writeMediaFile } from '../asset-registry'
import { buildSeedanceVideoPrompt } from '../engine'
import { generateNodeVideo, type OrchestrateCtx } from './orchestrate'
import type { VideoGenerationRequest } from './video-generation-gateway'

const roots: string[] = []

function makeAssetsDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'wb-game-video-continuity-'))
  roots.push(dir)
  return dir
}

function addImageRef(
  dir: string,
  id: string,
  productionType: 'character_ref' | 'scene_ref',
): void {
  const file = writeMediaFile(dir, id, 'png', Uint8Array.from([1, 2, 3]))
  upsertAsset(dir, {
    id,
    kind: 'image',
    productionType,
    status: 'ready',
    label: id,
    file,
    mime: 'image/png',
    createdAt: 1,
    updatedAt: 1,
  })
}

beforeEach(() => {
  gatewayMocks.genVideoAndWait.mockReset()
  gatewayMocks.genVideoAndWait.mockImplementation(async () => ({
    bytes: Uint8Array.from([0, 0, 0, 1]),
    mime: 'video/mp4',
    sourceUrl: '/__ce-api__/video-file/generated',
    taskId: 'task-generated',
  }))
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('multi-segment video tail-frame continuity', () => {
  test('uses provider-native video extension and never invokes ffmpeg when advertised', async () => {
    const dir = makeAssetsDir()
    addImageRef(dir, 'character-1', 'character_ref')
    addImageRef(dir, 'scene-1', 'scene_ref')
    let generated = 0
    const invoke = vi.fn(async (_id: string, _version: number, raw: unknown) => {
      generated += 1
      return {
        video: {
          bytes: Uint8Array.from(Buffer.from(`kino-segment-${generated}`)),
          mime: 'video/mp4',
          sourceUrl: `https://cdn.example.test/segment-${generated}.mp4`,
          generationId: `generation-${generated}`,
          provider: {
            kind: 'kino',
            ref: `https://cdn.example.test/segment-${generated}.mp4`,
            upstreamResourceId: `resource-${generated}`,
          },
        },
      }
    })
    const tailFrameExtractor = vi.fn(async () => {
      throw new Error('ffmpeg must not be used')
    })
    const ctx: OrchestrateCtx = {
      dir,
      gameId: 'demo',
      capabilities: {
        has(id, version) {
          return version === 1 && (id === 'media.video.generate' || id === 'media.video.extend')
        },
        invoke,
      },
      tailFrameExtractor,
    }

    const videos = await generateNodeVideo(ctx, {
      sceneNodeId: 'node-1',
      nodeName: '追逐',
      storyText: '角色冲过走廊。',
      durationSeconds: 31,
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
    })

    expect(videos).toHaveLength(3)
    expect(tailFrameExtractor).not.toHaveBeenCalled()
    expect(invoke.mock.calls.map(([id]) => id)).toEqual([
      'media.video.generate',
      'media.video.extend',
      'media.video.extend',
    ])
    const secondRequest = invoke.mock.calls[1]?.[2] as VideoGenerationRequest
    const thirdRequest = invoke.mock.calls[2]?.[2] as VideoGenerationRequest
    expect(secondRequest.references[0]).toMatchObject({
      role: 'reference_video',
      assetId: videos[0]!.id,
      mime: 'video/mp4',
    })
    expect(Buffer.from(secondRequest.references[0]!.bytes).toString()).toBe('kino-segment-1')
    expect(thirdRequest.references[0]).toMatchObject({
      role: 'reference_video',
      assetId: videos[1]!.id,
    })
    expect(secondRequest.prompt).toContain('@视频1')
    expect(secondRequest.prompt).not.toContain('真实尾帧')
    expect(listAssets(dir, { productionType: 'shot_image' })).toHaveLength(0)
  })

  test('extracts every completed segment tail and binds it as the next first_frame', async () => {
    const dir = makeAssetsDir()
    addImageRef(dir, 'character-1', 'character_ref')
    addImageRef(dir, 'scene-1', 'scene_ref')
    let extracted = 0
    const tailFrameExtractor = vi.fn(async (videoPath: string) => {
      void videoPath
      return {
        bytes: Uint8Array.from([201 + extracted++]),
        mime: 'image/jpeg' as const,
      }
    })
    const ctx: OrchestrateCtx = { dir, gameId: 'demo', tailFrameExtractor }

    const videos = await generateNodeVideo(ctx, {
      sceneNodeId: 'node-1',
      nodeName: '追逐',
      storyText: '角色冲过走廊。',
      durationSeconds: 31,
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
    })

    expect(videos).toHaveLength(3)
    expect(tailFrameExtractor).toHaveBeenCalledTimes(2)
    expect(tailFrameExtractor.mock.calls[0]?.[0]).toContain(videos[0]!.id)
    expect(tailFrameExtractor.mock.calls[1]?.[0]).toContain(videos[1]!.id)

    const secondInput = gatewayMocks.genVideoAndWait.mock.calls[1]?.[1]
    const thirdInput = gatewayMocks.genVideoAndWait.mock.calls[2]?.[1]
    expect(secondInput.imageWithRoles[0]).toEqual({
      role: 'first_frame',
      url: 'data:image/jpeg;base64,yQ==',
    })
    expect(thirdInput.imageWithRoles[0]).toEqual({
      role: 'first_frame',
      url: 'data:image/jpeg;base64,yg==',
    })
    expect(secondInput.prompt).toContain('@图片1（上一段视频的真实尾帧）')
    expect(secondInput.prompt).not.toContain('@视频1')

    const tailFrames = listAssets(dir, { productionType: 'shot_image' })
      .filter((asset) => asset.meta?.keyframeRole === 'continuity_tail_frame')
    expect(tailFrames).toHaveLength(2)
    expect(tailFrames.map((asset) => asset.meta?.sourceVideoAssetId)).toEqual([
      videos[0]!.id,
      videos[1]!.id,
    ])
  })

  test('stops instead of generating a prompt-only continuation when tail extraction fails', async () => {
    const dir = makeAssetsDir()
    addImageRef(dir, 'character-1', 'character_ref')
    addImageRef(dir, 'scene-1', 'scene_ref')
    const ctx: OrchestrateCtx = {
      dir,
      gameId: 'demo',
      tailFrameExtractor: vi.fn(async () => {
        throw new Error('decoder unavailable')
      }),
    }

    await expect(generateNodeVideo(ctx, {
      sceneNodeId: 'node-1',
      nodeName: '追逐',
      durationSeconds: 20,
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
    })).rejects.toThrow('真实尾帧闭环失败：decoder unavailable')

    expect(gatewayMocks.genVideoAndWait).toHaveBeenCalledTimes(1)
    const failedTail = listAssets(dir, { productionType: 'shot_image' })
      .find((asset) => asset.meta?.keyframeRole === 'continuity_tail_frame')
    expect(failedTail).toMatchObject({ status: 'failed', error: 'decoder unavailable' })
  })

  test('fails preflight before the first paid segment when no native extension or ffmpeg is available', async () => {
    const dir = makeAssetsDir()
    addImageRef(dir, 'character-1', 'character_ref')
    addImageRef(dir, 'scene-1', 'scene_ref')
    const tailFrameAvailabilityCheck = vi.fn(async () => {
      throw new Error('decoder unavailable')
    })

    await expect(generateNodeVideo({
      dir,
      gameId: 'demo',
      tailFrameAvailabilityCheck,
    }, {
      sceneNodeId: 'node-1',
      nodeName: '追逐',
      durationSeconds: 20,
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
    })).rejects.toThrow('首笔付费任务前')

    expect(tailFrameAvailabilityCheck).toHaveBeenCalledTimes(1)
    expect(gatewayMocks.genVideoAndWait).not.toHaveBeenCalled()
  })

  test('allows explicitly independent segments without native extension or ffmpeg', async () => {
    const dir = makeAssetsDir()
    addImageRef(dir, 'character-1', 'character_ref')
    addImageRef(dir, 'scene-1', 'scene_ref')
    const tailFrameAvailabilityCheck = vi.fn(async () => {
      throw new Error('must not preflight')
    })

    const videos = await generateNodeVideo({
      dir,
      gameId: 'demo',
      tailFrameAvailabilityCheck,
    }, {
      sceneNodeId: 'node-1',
      nodeName: '追逐',
      durationSeconds: 20,
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
      continuityMode: 'independent',
    })

    expect(videos).toHaveLength(2)
    expect(tailFrameAvailabilityCheck).not.toHaveBeenCalled()
    expect(gatewayMocks.genVideoAndWait).toHaveBeenCalledTimes(2)
    for (const [, request] of gatewayMocks.genVideoAndWait.mock.calls) {
      expect(request.imageWithRoles).toEqual([
        expect.objectContaining({ role: 'reference_image' }),
        expect.objectContaining({ role: 'reference_image' }),
      ])
      expect(request.prompt).not.toContain('向后延长')
    }
  })

  test('rejects an extend prompt that has no real continuity input', () => {
    expect(() => buildSeedanceVideoPrompt({
      storyText: '继续前进',
      nodeName: '下一段',
      durationSeconds: 8,
      refs: [],
      extend: true,
    })).toThrow('缺少上一段视频或真实尾帧锚点')
  })
})
