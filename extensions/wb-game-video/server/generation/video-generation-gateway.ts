import { createHash } from 'node:crypto'
import type { MediaAsset } from '../../src/editor/assets/registry-types'

/** The stable extension-platform capability consumed by this workbench. */
export const VIDEO_GENERATION_CAPABILITY = Object.freeze({
  id: 'media.video.generate',
  version: 1,
} as const)

/**
 * The host bridge deliberately exposes the small surface a workbench needs.
 * Hosts may adapt it to CapabilityProviderRegistry without coupling this
 * package to a platform implementation or an unpublished package version.
 */
export interface ExtensionCapabilities {
  invoke(
    capabilityId: string,
    version: number,
    input: unknown,
    options?: { readonly requestId: string },
  ): Promise<unknown>
}

export interface VideoGenerationRequest {
  readonly prompt: string
  readonly durationSeconds: number
  readonly generateAudio: boolean
  /** Host-owned references; the host resolves these IDs into provider inputs. */
  readonly references: readonly VideoGenerationReference[]
  readonly metadata: {
    readonly sceneNodeId: string
    readonly nodeName: string
    readonly characterRefIds: readonly string[]
    readonly sceneRefIds: readonly string[]
    readonly extend?: boolean
    readonly transitionHint?: string
  }
}

export interface VideoGenerationReference {
  readonly role: 'reference_image' | 'first_frame' | 'last_frame' | 'reference_video' | 'reference_audio'
  readonly assetId: string
}

/**
 * The shared capability has the same minimum result consumed by Asset Canvas:
 * a ready video with a stable id. Hosts can supply richer MediaAsset metadata;
 * this workbench fills its own registry timestamps when the host omits them.
 */
export type HostVideoMediaAsset =
  Pick<MediaAsset, 'id' | 'kind' | 'status'> &
  Partial<Omit<MediaAsset, 'id' | 'kind' | 'status'>>

export interface VideoGenerationResult {
  readonly asset: HostVideoMediaAsset
}

export interface VideoGenerationGateway {
  generate(input: VideoGenerationRequest): Promise<MediaAsset>
}

/**
 * Creates the capability-backed path when a host injected extension-platform
 * capabilities. Returning undefined is intentional: standalone/dev callers
 * then retain the pre-existing gateway-client implementation.
 */
export function createVideoGenerationGateway(
  capabilities: ExtensionCapabilities | undefined,
  gameId = '',
): VideoGenerationGateway | undefined {
  if (!capabilities) return undefined

  return {
    async generate(input) {
      try {
        const result = await capabilities.invoke(
          VIDEO_GENERATION_CAPABILITY.id,
          VIDEO_GENERATION_CAPABILITY.version,
          input,
          { requestId: createVideoGenerationRequestId(gameId, input) },
        )
        return bindHostMediaAsset((result as VideoGenerationResult | undefined)?.asset, input)
      } catch (error) {
        throw mapCapabilityError(error)
      }
    },
  }
}

/**
 * Generates a deterministic, credential-free idempotency key. It includes the
 * game and scene scope plus every capability input field, so retries of the
 * same logical request resume the durable Host receipt instead of submitting
 * a second provider job.
 */
export function createVideoGenerationRequestId(
  gameId: string,
  input: VideoGenerationRequest,
): string {
  const fingerprint = createHash('sha256')
    .update(stableSerialize({ gameId, sceneNodeId: input.metadata.sceneNodeId, input }))
    .digest('hex')
  return `wb-game-video-v1-${fingerprint}`
}

/**
 * Keeps the capability decision in one place: a host capability is
 * authoritative, while a missing bridge preserves the standalone/dev path.
 */
export function generateWithVideoGenerationGateway(
  gateway: VideoGenerationGateway | undefined,
  input: VideoGenerationRequest,
  legacyGenerate: () => Promise<MediaAsset>,
): Promise<MediaAsset> {
  return gateway ? gateway.generate(input) : legacyGenerate()
}

/** Converts a host-owned video asset to the public wb-game-video registry view. */
export function bindHostMediaAsset(asset: VideoGenerationResult['asset'] | undefined, input: VideoGenerationRequest): MediaAsset {
  if (!asset || typeof asset.id !== 'string' || asset.id.trim().length === 0) {
    throw new VideoGenerationCapabilityError(
      'CAPABILITY_INVALID_RESULT',
      '宿主视频生成能力返回了无效的 MediaAsset',
    )
  }
  if (asset.kind !== 'video' || asset.status !== 'ready') {
    throw new VideoGenerationCapabilityError(
      'CAPABILITY_INVALID_RESULT',
      '宿主视频生成能力未返回可绑定的视频 MediaAsset',
    )
  }

  const createdAt = asset.createdAt ?? Date.now()

  return {
    ...asset,
    kind: 'video',
    productionType: 'video_clip',
    status: 'ready',
    sceneNodeId: input.metadata.sceneNodeId,
    durationMs: asset.durationMs ?? Math.round(input.durationSeconds * 1000),
    prompt: asset.prompt ?? input.prompt,
    createdAt,
    updatedAt: asset.updatedAt ?? createdAt,
  }
}

export class VideoGenerationCapabilityError extends Error {
  readonly code: 'CAPABILITY_UNAVAILABLE' | 'CAPABILITY_AMBIGUOUS' | 'CAPABILITY_INVALID_RESULT'

  constructor(
    code: 'CAPABILITY_UNAVAILABLE' | 'CAPABILITY_AMBIGUOUS' | 'CAPABILITY_INVALID_RESULT',
    message: string,
  ) {
    super(message)
    this.name = 'VideoGenerationCapabilityError'
    this.code = code
  }
}

function mapCapabilityError(error: unknown): Error {
  if (error instanceof VideoGenerationCapabilityError) return error
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
  if (code === 'CAPABILITY_UNAVAILABLE') {
    return new VideoGenerationCapabilityError(code, '宿主未提供视频生成能力（media.video.generate@1）')
  }
  if (code === 'CAPABILITY_AMBIGUOUS') {
    return new VideoGenerationCapabilityError(code, '宿主视频生成能力存在多个 Provider，无法自动选择')
  }
  return error instanceof Error ? error : new Error(String(error))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
    .join(',')}}`
}
