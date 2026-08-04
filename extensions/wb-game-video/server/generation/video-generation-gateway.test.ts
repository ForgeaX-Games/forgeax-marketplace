import { describe, expect, it, vi } from 'vitest'
import {
  VIDEO_EXTEND_CAPABILITY,
  VIDEO_GENERATION_CAPABILITY,
  createVideoGenerationGateway,
  createVideoGenerationRequestId,
  generateWithVideoGenerationGateway,
  type GeneratedVideo,
  type VideoGenerationRequest,
} from './video-generation-gateway'

const request: VideoGenerationRequest = {
  prompt: 'A heroine enters a rainy cyberpunk alley.',
  durationSeconds: 5,
  generateAudio: false,
  references: [
    { role: 'reference_image', assetId: 'char-1', mime: 'image/png', bytes: Uint8Array.of(1, 2) },
    { role: 'reference_image', assetId: 'scene-1', mime: 'image/png', bytes: Uint8Array.of(3, 4) },
  ],
  metadata: {
    sceneNodeId: 'scene-1',
    nodeName: 'Opening',
    characterRefIds: ['char-1'],
    sceneRefIds: ['scene-1'],
  },
}

const generatedVideo: GeneratedVideo = {
  bytes: Uint8Array.of(9, 8, 7),
  mime: 'video/mp4',
  sourceUrl: 'https://cdn.example/video.mp4',
  generationId: 'generation-1',
  providerTaskId: 'task-1',
  model: 'seedance2',
}

describe('VideoGenerationGateway', () => {
  it('invokes the versioned extension-platform capability and returns provider-neutral video bytes', async () => {
    const invoke = vi.fn(async (id: string, version: number, value: unknown) => {
      expect(id).toBe('media.video.generate')
      expect(version).toBe(1)
      expect(value).toEqual(request)
      return { video: generatedVideo }
    })
    const gateway = createVideoGenerationGateway({ invoke }, 'game-a')!

    await expect(gateway.generate(request)).resolves.toEqual(generatedVideo)
    expect(invoke).toHaveBeenCalledWith(
      'media.video.generate',
      1,
      request,
      { requestId: expect.stringMatching(/^wb-game-video-v1-[0-9a-f]{64}$/) },
    )
    expect(VIDEO_GENERATION_CAPABILITY).toEqual({ id: 'media.video.generate', version: 1 })
  })

  it('does not create a gateway when the host did not inject capabilities, so callers keep the legacy path', () => {
    expect(createVideoGenerationGateway(undefined)).toBeUndefined()
    expect(createVideoGenerationGateway({ has: () => false, async invoke() {} })).toBeUndefined()
  })

  it('exposes provider-native extension only when the host advertises media.video.extend@1', async () => {
    const invoke = vi.fn(async () => ({ video: generatedVideo }))
    const gateway = createVideoGenerationGateway({
      has(id, version) {
        return version === 1 && (id === VIDEO_GENERATION_CAPABILITY.id || id === VIDEO_EXTEND_CAPABILITY.id)
      },
      invoke,
    }, 'game-a')!

    expect(gateway.extend).toBeTypeOf('function')
    await expect(gateway.extend!(request)).resolves.toEqual(generatedVideo)
    expect(invoke).toHaveBeenCalledWith(
      'media.video.extend',
      1,
      request,
      { requestId: expect.stringMatching(/^wb-game-video-v1-[0-9a-f]{64}$/) },
    )
    expect(VIDEO_EXTEND_CAPABILITY).toEqual({ id: 'media.video.extend', version: 1 })
  })

  it('rejects an invalid provider result before the workbench persists it', async () => {
    const gateway = createVideoGenerationGateway({
      async invoke() {
        return { video: { ...generatedVideo, bytes: new Uint8Array() } }
      },
    }, 'game-a')!

    await expect(gateway.generate(request)).rejects.toMatchObject({
      code: 'CAPABILITY_INVALID_RESULT',
      message: '宿主视频生成能力返回了无效的视频结果',
    })
  })

  it('derives a stable requestId from metadata and reference content hashes', () => {
    const first = createVideoGenerationRequestId('game-a', request)
    const second = createVideoGenerationRequestId('game-a', structuredClone(request))
    const otherGame = createVideoGenerationRequestId('game-b', request)
    const otherBytes = createVideoGenerationRequestId('game-a', {
      ...request,
      references: [{ ...request.references[0]!, bytes: Uint8Array.of(5) }, request.references[1]!],
    })

    expect(first).toBe(second)
    expect(first).not.toBe(otherGame)
    expect(first).not.toBe(otherBytes)
    expect(first).toMatch(/^wb-game-video-v1-[0-9a-f]{64}$/)
  })

  it('runs the legacy generator only when the host did not inject a capability bridge', async () => {
    const legacy = vi.fn(async () => generatedVideo)

    await expect(generateWithVideoGenerationGateway(undefined, request, legacy)).resolves.toEqual(generatedVideo)
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
