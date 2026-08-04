import { createHash } from 'node:crypto'

/** The stable extension-platform capability consumed by this workbench. */
export const VIDEO_GENERATION_CAPABILITY = Object.freeze({
  id: 'media.video.generate',
  version: 1,
} as const)

/** Provider-native continuation using the previous segment as a video reference. */
export const VIDEO_EXTEND_CAPABILITY = Object.freeze({
  id: 'media.video.extend',
  version: 1,
} as const)

/**
 * The host bridge deliberately exposes the small surface a workbench needs.
 * Hosts may adapt it to CapabilityProviderRegistry without coupling this
 * package to a platform implementation or an unpublished package version.
 */
export interface ExtensionCapabilities {
  has?(capabilityId: string, version: number): boolean
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
  /** Host-neutral references; the Provider uploads these bytes to its own storage. */
  readonly references: readonly VideoGenerationReference[]
  readonly metadata: {
    readonly sceneNodeId: string
    readonly nodeName: string
    readonly characterRefIds: readonly string[]
    readonly sceneRefIds: readonly string[]
    readonly continuityFirstFrameId?: string
    readonly continuityVideoId?: string
    readonly extend?: boolean
    readonly transitionHint?: string
  }
}

export interface VideoGenerationReference {
  readonly role: 'reference_image' | 'first_frame' | 'last_frame' | 'reference_video' | 'reference_audio'
  readonly assetId: string
  readonly mime: string
  readonly bytes: Uint8Array
}

export interface VideoGenerationResult {
  readonly video: GeneratedVideo
}

export interface GeneratedVideo {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly sourceUrl: string
  readonly generationId: string
  readonly providerTaskId?: string
  readonly model?: string
  readonly provider?: {
    readonly kind: 'kino'
    readonly ref: string
    readonly upstreamResourceId: string
  }
}

export interface VideoGenerationGateway {
  generate(input: VideoGenerationRequest): Promise<GeneratedVideo>
  extend?: (input: VideoGenerationRequest) => Promise<GeneratedVideo>
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
  if (
    !capabilities ||
    capabilities.has?.(VIDEO_GENERATION_CAPABILITY.id, VIDEO_GENERATION_CAPABILITY.version) === false
  ) return undefined

  const invoke = async (
    capability: typeof VIDEO_GENERATION_CAPABILITY | typeof VIDEO_EXTEND_CAPABILITY,
    input: VideoGenerationRequest,
  ): Promise<GeneratedVideo> => {
    try {
      const result = await capabilities.invoke(
        capability.id,
        capability.version,
        input,
        { requestId: createVideoGenerationRequestId(gameId, input, capability.id) },
      )
      return bindGeneratedVideo((result as VideoGenerationResult | undefined)?.video)
    } catch (error) {
      throw mapCapabilityError(error)
    }
  }

  return {
    generate: (input) => invoke(VIDEO_GENERATION_CAPABILITY, input),
    ...(capabilities.has?.(VIDEO_EXTEND_CAPABILITY.id, VIDEO_EXTEND_CAPABILITY.version) === true
      ? { extend: (input: VideoGenerationRequest) => invoke(VIDEO_EXTEND_CAPABILITY, input) }
      : {}),
  }
}

/**
 * Generates a deterministic, credential-free correlation id. Kino does not
 * expose an idempotency contract, so the Provider must not automatically retry
 * an ambiguous generation POST; this id only joins logs across the host seam.
 */
export function createVideoGenerationRequestId(
  gameId: string,
  input: VideoGenerationRequest,
  capabilityId: typeof VIDEO_GENERATION_CAPABILITY.id | typeof VIDEO_EXTEND_CAPABILITY.id
    = VIDEO_GENERATION_CAPABILITY.id,
): string {
  const references = input.references.map((reference) => ({
    role: reference.role,
    assetId: reference.assetId,
    mime: reference.mime,
    contentSha256: createHash('sha256').update(reference.bytes).digest('hex'),
  }))
  const fingerprint = createHash('sha256')
    .update(stableSerialize({
      capabilityId,
      gameId,
      sceneNodeId: input.metadata.sceneNodeId,
      input: { ...input, references },
    }))
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
  legacyGenerate: () => Promise<GeneratedVideo>,
): Promise<GeneratedVideo> {
  return gateway ? gateway.generate(input) : legacyGenerate()
}

/** Validates the provider-neutral payload before this workbench persists it locally. */
export function bindGeneratedVideo(video: VideoGenerationResult['video'] | undefined): GeneratedVideo {
  if (
    !video ||
    !(video.bytes instanceof Uint8Array) ||
    video.bytes.byteLength === 0 ||
    typeof video.mime !== 'string' ||
    !video.mime.startsWith('video/') ||
    typeof video.sourceUrl !== 'string' ||
    video.sourceUrl.length === 0 ||
    typeof video.generationId !== 'string' ||
    video.generationId.length === 0 ||
    (video.provider !== undefined &&
      (video.provider.kind !== 'kino' ||
        typeof video.provider.ref !== 'string' ||
        video.provider.ref.length === 0 ||
        typeof video.provider.upstreamResourceId !== 'string' ||
        video.provider.upstreamResourceId.length === 0))
  ) {
    throw new VideoGenerationCapabilityError(
      'CAPABILITY_INVALID_RESULT',
      '宿主视频生成能力返回了无效的视频结果',
    )
  }
  return video
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
