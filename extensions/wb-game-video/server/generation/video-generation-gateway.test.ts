import { describe, expect, it, vi } from 'vitest'
import {
  VIDEO_GENERATION_CAPABILITY,
  createVideoGenerationGateway,
  createVideoGenerationRequestId,
  generateWithVideoGenerationGateway,
  type VideoGenerationRequest,
} from './video-generation-gateway'

const request: VideoGenerationRequest = {
  prompt: 'A heroine enters a rainy cyberpunk alley.',
  durationSeconds: 5,
  generateAudio: false,
  references: [
    { role: 'reference_image', assetId: 'char-1' },
    { role: 'reference_image', assetId: 'scene-1' },
  ],
  metadata: {
    sceneNodeId: 'scene-1',
    nodeName: 'Opening',
    characterRefIds: ['char-1'],
    sceneRefIds: ['scene-1'],
  },
}

describe('VideoGenerationGateway', () => {
  it('invokes the versioned extension-platform capability and binds the returned host MediaAsset', async () => {
    const invoke = vi.fn(async (id: string, version: number, value: unknown) => {
      const input = value as VideoGenerationRequest
      expect(id).toBe('media.video.generate')
      expect(version).toBe(1)
      expect(input).toEqual(request)
      return {
        asset: {
          id: 'media-host-video-1',
          kind: 'video',
          status: 'ready',
          mime: 'video/mp4',
          bytes: 42,
          createdAt: 100,
          updatedAt: 101,
          provider: { kind: 'kino', ref: 'kino-generation-1' },
        },
      }
    })
    const gateway = createVideoGenerationGateway({ invoke }, 'game-a')!

    const asset = await gateway.generate(request)

    expect(invoke).toHaveBeenCalledWith(
      'media.video.generate',
      1,
      request,
      { requestId: expect.stringMatching(/^wb-game-video-v1-[0-9a-f]{64}$/) },
    )
    expect(asset).toMatchObject({
      id: 'media-host-video-1',
      kind: 'video',
      productionType: 'video_clip',
      status: 'ready',
      sceneNodeId: 'scene-1',
      durationMs: 5000,
      prompt: request.prompt,
      provider: { kind: 'kino', ref: 'kino-generation-1' },
    })
    expect(VIDEO_GENERATION_CAPABILITY).toEqual({ id: 'media.video.generate', version: 1 })
  })

  it('does not create a gateway when the host did not inject capabilities, so callers keep the legacy path', () => {
    expect(createVideoGenerationGateway(undefined)).toBeUndefined()
  })

  it('accepts the minimal ready video MediaAsset returned by the asset-canvas capability consumer', async () => {
    const gateway = createVideoGenerationGateway({
      async invoke() {
        return {
          asset: {
            id: 'canvas-host-video-1',
            kind: 'video',
            status: 'ready',
            url: '/media/canvas-host-video-1.mp4',
          },
        }
      },
    }, 'game-a')!

    const asset = await gateway.generate({
      ...request,
      references: [
        { role: 'first_frame', assetId: 'first-frame' },
        { role: 'reference_image', assetId: 'reference' },
      ],
    })

    expect(asset).toMatchObject({
      id: 'canvas-host-video-1',
      kind: 'video',
      productionType: 'video_clip',
      status: 'ready',
      url: '/media/canvas-host-video-1.mp4',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    })
  })

  it('derives a stable idempotency requestId from game, scene node, and the full capability input', async () => {
    const first = createVideoGenerationRequestId('game-a', request)
    const second = createVideoGenerationRequestId('game-a', structuredClone(request))
    const otherGame = createVideoGenerationRequestId('game-b', request)
    const otherNode = createVideoGenerationRequestId('game-a', {
      ...request,
      metadata: { ...request.metadata, sceneNodeId: 'scene-2' },
    })

    expect(first).toBe(second)
    expect(first).not.toBe(otherGame)
    expect(first).not.toBe(otherNode)
    expect(first).toMatch(/^wb-game-video-v1-[0-9a-f]{64}$/)
  })

  it('runs the legacy generator only when the host did not inject a capability bridge', async () => {
    const legacy = vi.fn(async () => ({
      id: 'legacy-video', kind: 'video' as const, productionType: 'video_clip' as const,
      status: 'ready' as const, createdAt: 1, updatedAt: 1,
    }))

    await expect(generateWithVideoGenerationGateway(undefined, request, legacy)).resolves.toMatchObject({ id: 'legacy-video' })
    expect(legacy).toHaveBeenCalledTimes(1)
  })

  it('maps stable extension-platform capability errors without leaking provider implementation details', async () => {
    const gateway = createVideoGenerationGateway({
      async invoke() {
        throw Object.assign(new Error('private provider endpoint failed'), { code: 'CAPABILITY_UNAVAILABLE' })
      },
    })!

    await expect(gateway.generate(request)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      message: '宿主未提供视频生成能力（media.video.generate@1）',
    })
  })
})
