import { getWorkbenchHost } from '../../../lib/workbench-host'
import { ToolCallResultSchema, WorkbenchError } from '@forgeax/workbench-host/contracts'

export const CLIP_GENERATION_TOOL_ID = 'wb-game-video:generate-video-clip'

export type KinoVideoSize = '2560x1440' | '1440x2560' | '2496x1664' | '1664x2496'
export type KinoVideoResolution = '720p' | '1080p'
export type VideoGenerationStatus =
  | 'pending'
  | 'submitting'
  | 'polling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface ClipGenerationRequest {
  /** UI identity only. The Workbench Host supplies the authoritative gameId. */
  gameSlug: string
  prompt: string
  durationSeconds: number
  generateAudio: boolean
  mode: 'strict' | 'firstref' | 'ref' | 't2v'
  firstFrameAssetId?: string
  lastFrameAssetId?: string
  referenceImageAssetIds?: string[]
  size?: KinoVideoSize
  resolution?: KinoVideoResolution
  model?: string
  visualStyleKey?: string
  label?: string
}

/**
 * Public tool contract. Product game identity and provider credentials never
 * cross this browser boundary; both are injected by the Workbench Host.
 */
export interface ClipGenerationWireRequest {
  prompt: string
  durationSeconds: number
  generateAudio: boolean
  mode: ClipGenerationRequest['mode']
  firstFrameAssetId?: string
  lastFrameAssetId?: string
  referenceImageAssetIds?: string[]
  visualStyleKey?: string
  label?: string
  requestId: string
}

export interface ClipGenerationSubmission {
  assetId: string
  status: 'ready' | 'failed'
  error?: string
}

/** Retained for the generation sheet's host-job presentation contract. */
export interface VideoGenerationTask {
  generationId: string
  status: VideoGenerationStatus
  prompt?: string
  model?: string
  providerTaskId?: string
  resultUrl?: string
  resourceId?: string
  errorCode?: string
  errorMessage?: string
  createdAt?: number
}

export interface WorkbenchGenerationToolPort {
  call(toolId: string, args: unknown): Promise<unknown>
}

const defaultClient: WorkbenchGenerationToolPort = {
  call: (toolId, args) => getWorkbenchHost().tool.call(toolId, args),
}

export async function submitClipGeneration(
  request: ClipGenerationWireRequest,
  toolPort: WorkbenchGenerationToolPort = defaultClient,
): Promise<ClipGenerationSubmission> {
  assertClipGenerationRequestId(request.requestId)
  const parsed = ToolCallResultSchema.safeParse(
    await toolPort.call(CLIP_GENERATION_TOOL_ID, request),
  )
  if (!parsed.success) {
    throw new Error('Video generation tool returned an invalid response')
  }
  if (!parsed.data.ok) throw new WorkbenchError(parsed.data.error)
  if (!isClipGenerationSubmission(parsed.data.result)) {
    throw new Error('Video generation tool returned an invalid response')
  }
  return parsed.data.result
}

export function createClipGenerationRequestId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    const requestId = cryptoApi.randomUUID()
    assertClipGenerationRequestId(requestId)
    return requestId
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    const requestId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    assertClipGenerationRequestId(requestId)
    return requestId
  }
  throw new Error('Secure requestId generation is unavailable')
}

export function assertClipGenerationRequestId(requestId: string): void {
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
    throw new Error('Video generation requestId must contain 1 to 128 characters')
  }
}

function isClipGenerationSubmission(value: unknown): value is ClipGenerationSubmission {
  if (!isRecord(value) || typeof value.assetId !== 'string') return false
  if (value.status !== 'ready' && value.status !== 'failed') return false
  return value.error === undefined || typeof value.error === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
