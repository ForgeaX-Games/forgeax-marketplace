import type { WorkbenchExtensionContext } from '@forgeax/workbench-host/node'
import type { MediaReference } from '@forgeax/workbench-host/contracts'
import { createHostAssetRegistry, type HostAssetRegistry } from '../asset-registry'
import { makeAssetId, type MediaAsset } from '../../src/editor/assets/registry-types'
import { generated, generationError } from './orchestrate'
import { generateVideoThroughHostCapability } from './video-capability'

const ASSET_LIBRARY_NODE_ID = 'asset-library'
const ASSET_LIBRARY_SOURCE = 'asset-library-generation'
const DEFAULT_DURATION_SECONDS = 8
const MAX_DURATION_SECONDS = 15
const MAX_PROMPT_LENGTH = 4_000
const MAX_LABEL_LENGTH = 120
const MAX_REFERENCE_IMAGES = 9
const VISUAL_STYLE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,80}$/

export type VideoClipGenerationMode = 'strict' | 'firstref' | 'ref' | 't2v'

export interface GenerateVideoClipArgs {
  prompt: string
  durationSeconds?: number
  generateAudio?: boolean
  mode?: VideoClipGenerationMode
  firstFrameAssetId?: string
  lastFrameAssetId?: string
  referenceImageAssetIds?: string[]
  label?: string
  requestId?: string
  visualStyleKey?: string
}

export type GenerateVideoClipResult =
  | { assetId: string; status: 'ready' }
  | { assetId: string; status: 'failed'; error: string }

interface ValidatedClipInput {
  durationSeconds: number
  generateAudio: boolean
  label: string
  mode: VideoClipGenerationMode
  requestId?: string
  visualStyleKey?: string
}

/**
 * Generates one standalone asset-library clip through the host's
 * media.video.generate broker. Arguments are validated and a generating
 * placeholder is persisted before submission, so invalid requests never
 * pollute the registry and slow provider reads stay visible to polling.
 */
export async function generateVideoClip(
  context: WorkbenchExtensionContext,
  args: GenerateVideoClipArgs,
  registry: HostAssetRegistry = createHostAssetRegistry(context),
): Promise<GenerateVideoClipResult> {
  const validated = validateClipInput(args)
  const referenceAssetIds = collectReferenceAssetIds(args, validated.mode)
  await Promise.all(referenceAssetIds.map((id) => assertImageAsset(registry, id)))

  const id = makeAssetId('video_clip')
  const createdAt = Date.now()
  await registry.upsert({
    id,
    kind: 'video',
    productionType: 'video_clip',
    status: 'generating',
    label: validated.label,
    sceneNodeId: ASSET_LIBRARY_NODE_ID,
    sourceModule: 'wb-game-video',
    prompt: args.prompt,
    durationMs: Math.round(validated.durationSeconds * 1_000),
    createdAt,
    updatedAt: createdAt,
    meta: {
      source: ASSET_LIBRARY_SOURCE,
      mode: validated.mode,
      referenceAssetIds,
      ...(validated.requestId !== undefined ? { requestId: validated.requestId } : {}),
      ...(validated.visualStyleKey !== undefined ? { visualStyleKey: validated.visualStyleKey } : {}),
    },
  })

  try {
    const references = await resolveReferences(registry, args, validated.mode)
    const generatedVideo = await generateVideoThroughHostCapability(context, {
      prompt: args.prompt,
      references,
      durationSeconds: validated.durationSeconds,
      generateAudio: validated.generateAudio,
      visualStyleKey: validated.visualStyleKey,
      metadata: {
        sceneNodeId: ASSET_LIBRARY_NODE_ID,
        nodeName: validated.label,
      },
      requestId: validated.requestId,
    })
    await registry.persistGenerated(generated([generatedVideo], 'video'), {
      registryId: id,
      filenamePrefix: 'video',
      productionType: 'video_clip',
      sceneNodeId: ASSET_LIBRARY_NODE_ID,
      label: validated.label,
      prompt: args.prompt,
      // durationMs 记录的是请求时长而非产物实际时长；provider 未回传真实时长。
      durationMs: Math.round(validated.durationSeconds * 1_000),
      meta: {
        source: ASSET_LIBRARY_SOURCE,
        mode: validated.mode,
        referenceAssetIds,
        ...(validated.requestId !== undefined ? { requestId: validated.requestId } : {}),
        ...(validated.visualStyleKey !== undefined ? { visualStyleKey: validated.visualStyleKey } : {}),
      },
    })
  } catch (error) {
    const message = generationError(error)
    const failed = await registry.update(id, { status: 'failed', error: message })
    if (!failed) throw new Error('video clip asset 失败更新时丢失')
    return { assetId: id, status: 'failed', error: message }
  }
  return { assetId: id, status: 'ready' }
}

function validateClipInput(args: GenerateVideoClipArgs): ValidatedClipInput {
  if (typeof args.prompt !== 'string' || args.prompt.trim().length === 0) {
    throw new Error('prompt 不能为空')
  }
  if (args.prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`prompt 不能超过 ${MAX_PROMPT_LENGTH} 个字符`)
  }

  const durationSeconds = args.durationSeconds ?? DEFAULT_DURATION_SECONDS
  if (
    typeof durationSeconds !== 'number'
    || !Number.isFinite(durationSeconds)
    || durationSeconds < 1
    || durationSeconds > MAX_DURATION_SECONDS
  ) {
    throw new Error(`durationSeconds 必须在 1 到 ${MAX_DURATION_SECONDS} 之间`)
  }
  if (args.generateAudio !== undefined && typeof args.generateAudio !== 'boolean') {
    throw new Error('generateAudio 必须是 boolean')
  }
  if (args.label !== undefined && typeof args.label !== 'string') {
    throw new Error('label 必须是 string')
  }
  const explicitLabel = args.label?.trim() ?? ''
  if (explicitLabel.length > MAX_LABEL_LENGTH) {
    throw new Error(`label 不能超过 ${MAX_LABEL_LENGTH} 个字符`)
  }
  if (
    args.requestId !== undefined
    && (typeof args.requestId !== 'string' || args.requestId.length < 1 || args.requestId.length > 128)
  ) {
    throw new Error('requestId 必须是长度 1 到 128 的字符串')
  }

  const mode = args.mode ?? 't2v'
  if (!isGenerationMode(mode)) throw new Error(`不支持的视频生成模式：${String(mode)}`)
  const firstFrameAssetId = optionalAssetId(args.firstFrameAssetId, 'firstFrameAssetId')
  const lastFrameAssetId = optionalAssetId(args.lastFrameAssetId, 'lastFrameAssetId')
  const referenceImageAssetIds = validateReferenceImageIds(args.referenceImageAssetIds)
  const visualStyleKey = args.visualStyleKey
  if (
    visualStyleKey !== undefined
    && (typeof visualStyleKey !== 'string' || !VISUAL_STYLE_KEY_PATTERN.test(visualStyleKey))
  ) {
    throw new Error('visualStyleKey 必须是有效的 Kino 风格 key')
  }

  if (mode === 'strict') {
    if (!firstFrameAssetId || !lastFrameAssetId) {
      throw new Error('strict 模式必须同时提供 firstFrameAssetId 和 lastFrameAssetId')
    }
    if (referenceImageAssetIds.length > 0) {
      throw new Error('strict 模式不接受 referenceImageAssetIds')
    }
  } else if (mode === 'firstref') {
    if (!firstFrameAssetId) throw new Error('firstref 模式必须提供 firstFrameAssetId')
    if (lastFrameAssetId || referenceImageAssetIds.length > 0) {
      throw new Error('firstref 模式只接受 firstFrameAssetId')
    }
  } else if (mode === 'ref') {
    if (referenceImageAssetIds.length === 0) {
      throw new Error('ref 模式必须提供至少一张 referenceImageAssetIds')
    }
    if (firstFrameAssetId || lastFrameAssetId) {
      throw new Error('ref 模式只接受 referenceImageAssetIds')
    }
  } else if (firstFrameAssetId || lastFrameAssetId || referenceImageAssetIds.length > 0) {
    throw new Error('t2v 模式不接受任何参考图')
  }

  return {
    durationSeconds,
    generateAudio: args.generateAudio === true,
    label: explicitLabel || deriveLabelFromPrompt(args.prompt),
    mode,
    requestId: args.requestId,
    visualStyleKey,
  }
}

function collectReferenceAssetIds(args: GenerateVideoClipArgs, mode: VideoClipGenerationMode): string[] {
  if (mode === 'strict') return [args.firstFrameAssetId!, args.lastFrameAssetId!]
  if (mode === 'firstref') return [args.firstFrameAssetId!]
  if (mode === 'ref') return [...args.referenceImageAssetIds ?? []]
  return []
}

async function resolveReferences(
  registry: HostAssetRegistry,
  args: GenerateVideoClipArgs,
  mode: VideoClipGenerationMode,
): Promise<MediaReference[]> {
  if (mode === 'strict') {
    const [first, last] = await Promise.all([
      registry.mediaReference(args.firstFrameAssetId!),
      registry.mediaReference(args.lastFrameAssetId!),
    ])
    return [{ ...first, role: 'first_frame' }, { ...last, role: 'last_frame' }]
  }
  if (mode === 'firstref') {
    const first = await registry.mediaReference(args.firstFrameAssetId!)
    return [{ ...first, role: 'first_frame' }]
  }
  if (mode === 'ref') {
    const refs = await Promise.all(
      (args.referenceImageAssetIds ?? []).map((id) => registry.mediaReference(id)),
    )
    return refs.map((ref) => ({ ...ref, role: 'reference_image' as const }))
  }
  return []
}

async function assertImageAsset(registry: HostAssetRegistry, assetId: string): Promise<MediaAsset> {
  const asset = await registry.get(assetId)
  if (!asset) throw new Error(`参考图不存在：${assetId}`)
  if (asset.kind !== 'image') throw new Error(`参考资产不是图片：${assetId}`)
  if (asset.status !== 'ready') throw new Error(`参考图尚未就绪：${assetId}`)
  if (!asset.mime?.toLowerCase().startsWith('image/')) {
    throw new Error(`参考图 MIME 无效：${assetId}`)
  }
  return asset
}


function optionalAssetId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} 必须是非空字符串`)
  return value
}

function validateReferenceImageIds(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('referenceImageAssetIds 必须是数组')
  if (value.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`referenceImageAssetIds 最多 ${MAX_REFERENCE_IMAGES} 张`)
  }
  return value.map((assetId, index) => {
    if (typeof assetId !== 'string' || assetId.length === 0) {
      throw new Error(`referenceImageAssetIds[${index}] 必须是非空字符串`)
    }
    return assetId
  })
}

function isGenerationMode(value: unknown): value is VideoClipGenerationMode {
  return value === 'strict' || value === 'firstref' || value === 'ref' || value === 't2v'
}

function deriveLabelFromPrompt(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ')
  return normalized.slice(0, MAX_LABEL_LENGTH)
}
