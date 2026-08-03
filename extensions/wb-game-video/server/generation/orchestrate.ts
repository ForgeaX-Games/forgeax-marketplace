/**
 * generation/orchestrate —— 服务端 headless「一节点=一镜头」三步生产线。
 *
 *   generateShotScript  节点文本 → Seedance V2 镜头脚本（prompt IP · genText jsonMode）
 *   generateKeyframe    镜头脚本 → 分镜图/关键帧（genImage + 角色/场景只读参考图）→ registry(shot_image)
 *   generateVideo       镜头脚本(+关键帧首帧) → 成片（genVideoAndWait）→ registry(video_clip)
 *
 * 硬约束（对齐 FMV）：
 *   · **必传参考图闸**（FMV 4.5）：generateVideo 缺 character_ref 或 scene_ref 直接抛可读错。
 *   · **尾帧续接**（FMV 坑6/§6.6）：下一镜可传上一镜关键帧作 first_frame 维持连续性
 *     （headless 无 ffmpeg 逐帧抽取，故以"关键帧续接"实现，seam 见 continuityFirstFrameId）。
 *   · **并发信号量**（FMV concurrency）：createSemaphore 控住网关并发。
 *
 * registry 生命周期：每次生成 upsert placeholder→generating→ready/failed，供 P5 轮询三态。
 */
import {
  getAsset,
  getStyleAxes,
  resolveAssetFilePath,
  updateAsset,
  upsertAsset,
  writeMediaFile,
} from '../asset-registry'
import type { MediaAsset, StyleAxes } from '../../src/editor/assets/registry-types'
import { makeAssetId } from '../../src/editor/assets/registry-types'
import { composeAxes, type ComposedAxes } from '../engine/axes'
import {
  buildNodeShotScriptPrompt,
  buildSeedanceVideoPrompt,
  buildShotGridStoryboardPrompt,
  buildShotImagePrompt,
  getShotCount,
  SEEDANCE_MAX_SHOT_DURATION,
  SEEDANCE_POLISH_SYSTEM_PROMPT,
  type RefCharacter,
  type SeedancePromptEntry,
  type ShotGridInput,
  type ShotImageInput,
  type ShotScriptInput,
  type VideoRefBinding,
} from '../engine'
import type { MediaProductionType } from '../../src/editor/assets/registry-types'
import {
  fileToBase64,
  fileToDataUrl,
  genImage,
  genText,
  genVideoAndWait,
  type GatewayCtx,
  type PollOpts,
  type VideoRoleImage,
} from './gateway-client'
import {
  createVideoGenerationGateway,
  generateWithVideoGenerationGateway,
  type ExtensionCapabilities,
  type VideoGenerationReference,
} from './video-generation-gateway'

/** 编排上下文：素材层根目录（assetsDir 解析结果）+ 网关 env。 */
export interface OrchestrateCtx extends GatewayCtx {
  /** `.forgeax/games/<slug>/assets` 绝对路径。 */
  dir: string
  /** content API 所需的游戏 slug。 */
  gameId: string
  /** 测试可注入；默认使用全局 fetch。 */
  fetchImpl?: typeof fetch
  /**
   * 由 Workbench 宿主注入的 extension-platform capability bridge。
   * 缺省时保留 standalone/dev 的 legacy gateway-client 路径。
   */
  capabilities?: ExtensionCapabilities
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}
function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? 'bin'
}

/** 三轴解析（P3）：游戏级 manifest.styleAxes ⊕ node 覆盖 → composeAxes。node 覆盖优先。 */
function resolveAxes(octx: OrchestrateCtx, override?: StyleAxes, custom?: string): ComposedAxes {
  const base = getStyleAxes(octx.dir)
  return composeAxes({ ...(base ?? {}), ...(override ?? {}) }, custom)
}

// ── Step 1：镜头脚本 ─────────────────────────────────────────────────────────
export async function generateShotScript(
  octx: OrchestrateCtx,
  input: ShotScriptInput & { styleAxes?: StyleAxes },
): Promise<SeedancePromptEntry[]> {
  // P3：三轴——artMedia/filmLook 折进 artStyle/styleKeywords，director 折进 system。
  // caller 显式传入的 artStyle/styleKeywords 优先，否则用三轴默认。
  const axes = resolveAxes(octx, input.styleAxes)
  const resolved: ShotScriptInput = {
    ...input,
    artStyle: input.artStyle ?? axes.artMedia,
    styleKeywords: input.styleKeywords ?? axes.styleKeywords,
  }
  const prompt = buildNodeShotScriptPrompt(resolved)
  const text = await genText(octx, {
    system: axes.directorSystem || undefined,
    user: prompt,
    jsonMode: true,
    temperature: 0.7,
  })
  return parseShotScript(text, input.durationSeconds)
}

/** 从 LLM JSON（可能裹 ```json fence）解析镜头脚本数组；宽松兜底成单镜头。 */
export function parseShotScript(raw: string, durationSeconds: number): SeedancePromptEntry[] {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return [{ shotNumber: 1, durationSeconds, seedancePrompt: cleaned.slice(0, 700) }]
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { shots?: unknown[] })?.shots)
      ? (parsed as { shots: unknown[] }).shots
      : []
  const out: SeedancePromptEntry[] = []
  arr.forEach((item, i) => {
    const s = item as Partial<SeedancePromptEntry>
    if (typeof s?.seedancePrompt !== 'string' || !s.seedancePrompt.trim()) return
    out.push({
      shotNumber: typeof s.shotNumber === 'number' ? s.shotNumber : i + 1,
      durationSeconds: typeof s.durationSeconds === 'number' ? s.durationSeconds : durationSeconds,
      seedancePrompt: s.seedancePrompt.trim(),
      dialogueLine: typeof s.dialogueLine === 'string' ? s.dialogueLine : undefined,
      voiceover: typeof s.voiceover === 'string' ? s.voiceover : undefined,
    })
  })
  if (!out.length) return [{ shotNumber: 1, durationSeconds, seedancePrompt: cleaned.slice(0, 700) }]
  return out
}

// ── Step 2：分镜图 / 关键帧 ──────────────────────────────────────────────────

/** P4：关键帧生成模式——'keyframe'（默认，单帧彩色关键帧）| 'grid_storyboard'（6 面板黑白 previs 故事板）。 */
export type KeyframeMode = 'keyframe' | 'grid_storyboard'

export interface KeyframeInput extends ShotImageInput {
  /** 归属节点 id。 */
  sceneNodeId: string
  /** 角色/场景只读参考图的 registry id（externalPath 或 file 皆可）。 */
  refAssetIds?: string[]
  /** 展示名。 */
  label?: string
  /** 节点级三轴覆盖（P3）；不传则用游戏级 manifest.styleAxes。 */
  styleAxes?: StyleAxes
  /** P4：生成模式；缺省 'keyframe'。 */
  mode?: KeyframeMode
  /**
   * P4：grid_storyboard 模式的额外入参（节点角色 / 结局 / 抉择 / 道具 / 台词等，全可选）。
   * originalPrompt / referenceCount / sceneRefReady 由 orchestrate 内部从关键帧 prompt 与参考图派生，不在此传。
   */
  grid?: Omit<ShotGridInput, 'originalPrompt' | 'referenceCount' | 'sceneRefReady'>
}

/**
 * 生成一张分镜图/关键帧，落 registry，返回 ready 资产。
 *   - mode='keyframe'（默认）：单帧关键帧 → productionType 'shot_image'。
 *   - mode='grid_storyboard'：6 面板黑白 previs 故事板 → productionType 'grid_storyboard'
 *     （FMV 双层：内层关键帧 prompt 作 originalPrompt 喂外层 buildShotGridStoryboardPrompt）。
 */
export async function generateKeyframe(octx: OrchestrateCtx, input: KeyframeInput): Promise<MediaAsset> {
  const mode: KeyframeMode = input.mode ?? 'keyframe'
  const productionType: MediaProductionType = mode === 'grid_storyboard' ? 'grid_storyboard' : 'shot_image'
  const defaultLabel = mode === 'grid_storyboard' ? `分镜故事板 · ${input.nodeName}` : `关键帧 · ${input.nodeName}`
  const id = makeAssetId(productionType)
  upsertAsset(octx.dir, {
    id,
    kind: 'image',
    productionType,
    status: 'generating',
    label: input.label ?? defaultLabel,
    sceneNodeId: input.sceneNodeId,
    sourceModule: 'wb-game-video',
    prompt: input.beat,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    meta: { refIds: input.refAssetIds ?? [], mode },
  })
  try {
    // P3：三轴——artMedia+filmLook 组合成 uiStylePrompt（caller 显式传入优先）。
    const axes = resolveAxes(octx, input.styleAxes)
    const refB64 = await resolveRefBase64(octx, input.refAssetIds)
    // 内层关键帧 prompt 始终构建：keyframe 模式直接用它出图；grid 模式把它当 originalPrompt 喂外层故事板 wrapper。
    const keyframePrompt = buildShotImagePrompt({
      ...input,
      uiStylePrompt: input.uiStylePrompt ?? axes.uiStylePrompt,
      refsReady: refB64.length > 0,
    })
    const prompt =
      mode === 'grid_storyboard'
        ? buildShotGridStoryboardPrompt({
            ...(input.grid ?? {}),
            originalPrompt: keyframePrompt,
            referenceCount: refB64.length,
            sceneRefReady: refB64.length > 0,
          })
        : keyframePrompt
    const { base64, mime } = await genImage(octx, { prompt, size: '1024x1024', referenceImagesB64: refB64 })
    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
    const file = writeMediaFile(octx.dir, id, extForMime(mime), bytes)
    const ready = updateAsset(octx.dir, id, { status: 'ready', file, mime, bytes: bytes.byteLength, prompt })
    if (!ready) throw new Error('keyframe asset 落盘后丢失')
    return ready
  } catch (e) {
    updateAsset(octx.dir, id, { status: 'failed', error: (e as Error).message })
    throw e
  }
}

// ── Step 3：视频 ─────────────────────────────────────────────────────────────
export interface VideoGenInput {
  sceneNodeId: string
  nodeName: string
  /** 已审镜头脚本（优先）。 */
  seedancePrompt?: string
  storyText?: string
  durationSeconds: number
  artStyle?: string
  styleKeywords?: string[]
  /** 必传：≥1 角色参考图 registry id（character_ref）。 */
  characterRefIds: string[]
  /** 必传：≥1 场景参考图 registry id（scene_ref）。 */
  sceneRefIds: string[]
  /** 可选：作 first_frame 的关键帧 registry id（尾帧续接 seam）。 */
  continuityFirstFrameId?: string
  label?: string
  generateAudio?: boolean
  /** 节点级三轴覆盖（P3）；不传则用游戏级 manifest.styleAxes。 */
  styleAxes?: StyleAxes
  /**
   * P5：是否 extend 续接段（前置 VIDEO_EXTEND_HEADER_BLOCK，V-PROMPT-15 七条）。
   * generateNodeVideo 拆段时对第 2 段起自动置 true；单独调用 generateVideo 也可手动开。
   */
  extend?: boolean
  /** P5：extend 段的衔接锚点（拼进 extend 头块第 7 条）。 */
  transitionHint?: string
}

/** 必传参考图硬闸（FMV 4.5）：缺角色/场景参考图立刻抛可读错，绝不静默降级。 */
function assertRefsPresent(input: VideoGenInput): void {
  const missing: string[] = []
  if (!input.characterRefIds?.some(Boolean)) missing.push('character_ref（角色参考图）')
  if (!input.sceneRefIds?.some(Boolean)) missing.push('scene_ref（场景参考图）')
  if (missing.length) {
    throw new Error(
      `视频生成缺必传参考图：${missing.join(' + ')}。请先从上游模块（wb-character / 场景模块）导入参考图，再生成本节点视频。`,
    )
  }
}

/** 把一批 registry ref id 解析成视频参考图槽（reference_image），逐张转 data URL。 */
function kinoContentUrl(octx: OrchestrateCtx, assetId: string): string {
  const port = octx.env?.FORGEAX_SERVER_PORT?.trim() || '18900'
  return `http://127.0.0.1:${port}/api/v1/kino/resources/${encodeURIComponent(assetId)}/content?game_id=${encodeURIComponent(octx.gameId)}`
}

export async function resolveAssetImagePayload(
  octx: OrchestrateCtx,
  asset: MediaAsset,
): Promise<{ base64: string; dataUrl: string }> {
  const path = resolveAssetFilePath(octx.dir, asset)
  if (path) {
    return { base64: fileToBase64(path), dataUrl: fileToDataUrl(path) }
  }
  if (!asset.provider) {
    throw new Error(`参考图 ${asset.id} 没有可读取的文件或 provider`)
  }
  const response = await (octx.fetchImpl ?? fetch)(kinoContentUrl(octx, asset.id))
  if (!response.ok) {
    throw new Error(`参考图 ${asset.id} 读取失败（HTTP ${response.status}）`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new Error(`参考图 ${asset.id} 内容为空`)
  }
  const mime = response.headers.get('content-type')?.split(';', 1)[0] || asset.mime || 'image/png'
  const base64 = bytes.toString('base64')
  return { base64, dataUrl: `data:${mime};base64,${base64}` }
}

/**
 * Host capability 的引用只携带 registry asset id；宿主负责解析受控媒体内容。
 * 这样 ForgeaX/Arrival 的 capability bridge 不会依赖本地文件或 data URL。
 */
function buildVideoGenerationReferences(input: VideoGenInput): VideoGenerationReference[] {
  const references: VideoGenerationReference[] = []
  if (input.continuityFirstFrameId) {
    references.push({ role: 'first_frame', assetId: input.continuityFirstFrameId })
  }
  for (const assetId of input.characterRefIds.filter(Boolean)) {
    references.push({ role: 'reference_image', assetId })
  }
  for (const assetId of input.sceneRefIds.filter(Boolean)) {
    references.push({ role: 'reference_image', assetId })
  }
  return references
}

/** 解析 registry 引用的展示绑定；不读取媒体内容，供 capability prompt 使用。 */
async function resolveVideoRoleBindings(octx: OrchestrateCtx, input: VideoGenInput): Promise<VideoRefBinding[]> {
  const bindings: VideoRefBinding[] = []
  let idx = 1
  const push = (assetId: string, semantic: string): void => {
    const asset = getAsset(octx.dir, assetId)
    if (!asset) throw new Error(`参考图不存在：${assetId}`)
    bindings.push({ index: idx, role: semantic, label: asset.label })
    idx++
  }
  if (input.continuityFirstFrameId) push(input.continuityFirstFrameId, '续接首帧')
  for (const cid of input.characterRefIds.filter(Boolean)) push(cid, '角色')
  for (const sid of input.sceneRefIds.filter(Boolean)) push(sid, '场景')
  return bindings
}

/** 把一批 registry ref id 解析成视频参考图槽（reference_image），逐张转 data URL。 */
async function resolveVideoRoleImages(octx: OrchestrateCtx, input: VideoGenInput): Promise<{ roles: VideoRoleImage[]; bindings: VideoRefBinding[] }> {
  const roles: VideoRoleImage[] = []
  const bindings = await resolveVideoRoleBindings(octx, input)
  const push = async (assetId: string, role: VideoRoleImage['role']): Promise<void> => {
    const asset = getAsset(octx.dir, assetId)
    if (!asset) throw new Error(`参考图不存在：${assetId}`)
    const payload = await resolveAssetImagePayload(octx, asset)
    roles.push({ role, url: payload.dataUrl })
  }
  if (input.continuityFirstFrameId) await push(input.continuityFirstFrameId, 'first_frame')
  for (const cid of input.characterRefIds.filter(Boolean)) await push(cid, 'reference_image')
  for (const sid of input.sceneRefIds.filter(Boolean)) await push(sid, 'reference_image')
  return { roles, bindings }
}

/** 生成一段视频，落 registry（video_clip），返回 ready 资产。node.data.media.ref 应指它。 */
export async function generateVideo(
  octx: OrchestrateCtx,
  input: VideoGenInput,
  pollOpts?: PollOpts,
): Promise<MediaAsset> {
  assertRefsPresent(input)
  let legacyAssetId: string | undefined
  try {
    // P3：三轴——video 侧折 artMedia/filmLook 到 artStyle/styleKeywords（caller 显式优先）。
    const axes = resolveAxes(octx, input.styleAxes)
    // Prompt bindings and capability references are ID-only. Media bytes are resolved
    // below, inside the legacy fallback, so Host capability providers never receive
    // or depend on local data URLs.
    const bindings = await resolveVideoRoleBindings(octx, input)
    const prompt = buildSeedanceVideoPrompt({
      seedancePrompt: input.seedancePrompt,
      storyText: input.storyText,
      nodeName: input.nodeName,
      durationSeconds: input.durationSeconds,
      artStyle: input.artStyle ?? axes.artMedia,
      styleKeywords: input.styleKeywords ?? axes.styleKeywords,
      refs: bindings,
      extend: input.extend,
      transitionHint: input.transitionHint,
    })
    const capabilityInput = {
      prompt,
      durationSeconds: input.durationSeconds,
      generateAudio: input.generateAudio ?? false,
      references: buildVideoGenerationReferences(input),
      metadata: {
        sceneNodeId: input.sceneNodeId,
        nodeName: input.nodeName,
        characterRefIds: input.characterRefIds,
        sceneRefIds: input.sceneRefIds,
        extend: input.extend,
        transitionHint: input.transitionHint,
      },
    }
    return await generateWithVideoGenerationGateway(
      createVideoGenerationGateway(octx.capabilities, octx.gameId),
      capabilityInput,
      async () => {
        const { roles } = await resolveVideoRoleImages(octx, input)
        const id = makeAssetId('video_clip')
        legacyAssetId = id
        upsertAsset(octx.dir, {
          id,
          kind: 'video',
          productionType: 'video_clip',
          status: 'generating',
          label: input.label ?? `视频 · ${input.nodeName}`,
          sceneNodeId: input.sceneNodeId,
          sourceModule: 'wb-game-video',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: { characterRefIds: input.characterRefIds, sceneRefIds: input.sceneRefIds },
        })
        const { bytes, mime, sourceUrl, taskId } = await genVideoAndWait(
          octx,
          {
            prompt,
            seconds: input.durationSeconds,
            imageWithRoles: roles,
            generateAudio: input.generateAudio ?? false,
          },
          pollOpts,
        )
        const file = writeMediaFile(octx.dir, id, extForMime(mime), bytes)
        const ready = updateAsset(octx.dir, id, {
          status: 'ready',
          file,
          mime,
          bytes: bytes.byteLength,
          durationMs: Math.round(input.durationSeconds * 1000),
          prompt,
          meta: { characterRefIds: input.characterRefIds, sceneRefIds: input.sceneRefIds, taskId, sourceUrl },
        })
        if (!ready) throw new Error('video asset 落盘后丢失')
        return ready
      },
    )
  } catch (e) {
    if (legacyAssetId) {
      updateAsset(octx.dir, legacyAssetId, { status: 'failed', error: (e as Error).message })
    }
    throw e
  }
}

// ── Step 3b：超长节点自动拆段续接（P5） ──────────────────────────────────────

/**
 * 把总时长均匀拆成 n 段（n = getShotCount = ceil(total / 15s)），每段 ≤ SEEDANCE_MAX_SHOT_DURATION。
 * 余数分摊到靠前的段（如 34s → [12,11,11]）。
 */
export function splitDurationIntoSegments(totalSeconds: number): number[] {
  const n = getShotCount(totalSeconds)
  if (n <= 1) return [Math.max(1, Math.round(totalSeconds))]
  const base = Math.floor(totalSeconds / n)
  const remainder = Math.round(totalSeconds - base * n)
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * 生成一个节点的成片：时长 ≤ 15s 走单段（= generateVideo）；> 15s 自动按 15s 拆段，
 * 逐段顺序生成，第 2 段起前置 VIDEO_EXTEND_HEADER_BLOCK（extend=true）+ 首帧关键帧 seam
 * （continuityFirstFrameId，网关无 mp4 输入槽故以关键帧首帧续接，见本文件头注）。
 * 返回按顺序的分段资产数组（长度 = 段数）；上层把它们拼进 node.data.media（或做多 clip 时间线）。
 */
export async function generateNodeVideo(
  octx: OrchestrateCtx,
  input: VideoGenInput,
  pollOpts?: PollOpts,
): Promise<MediaAsset[]> {
  assertRefsPresent(input)
  const segments = splitDurationIntoSegments(input.durationSeconds)
  if (segments.length <= 1) {
    return [await generateVideo(octx, input, pollOpts)]
  }
  const baseLabel = input.label ?? `视频 · ${input.nodeName}`
  const out: MediaAsset[] = []
  for (let i = 0; i < segments.length; i++) {
    const isExtend = i > 0
    const seg: VideoGenInput = {
      ...input,
      durationSeconds: segments[i]!,
      label: `${baseLabel} · 段${i + 1}/${segments.length}`,
      extend: isExtend,
      transitionHint: isExtend
        ? input.transitionHint ?? `接上一段（第 ${i} 段）尾部，人物、机位、光影、表演节奏无缝延续`
        : undefined,
      // 续接 seam：extend 段用调用方给的关键帧作 first_frame（无 mp4 抽帧能力）；首段沿用原 seam。
      continuityFirstFrameId: input.continuityFirstFrameId,
    }
    out.push(await generateVideo(octx, seg, pollOpts))
  }
  return out
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function resolveRefBase64(octx: OrchestrateCtx, ids: string[] | undefined): Promise<string[]> {
  const out: string[] = []
  for (const aid of ids ?? []) {
    const asset = getAsset(octx.dir, aid)
    if (!asset) throw new Error(`参考图不存在：${aid}`)
    out.push((await resolveAssetImagePayload(octx, asset)).base64)
  }
  return out
}

/** 并发信号量（FMV concurrency）：acquire()→release()，或 run() 包裹。 */
export function createSemaphore(max: number): {
  run: <T>(fn: () => Promise<T>) => Promise<T>
} {
  let active = 0
  const queue: (() => void)[] = []
  const acquire = (): Promise<void> =>
    new Promise((res) => {
      if (active < max) {
        active++
        res()
      } else {
        queue.push(() => {
          active++
          res()
        })
      }
    })
  const release = (): void => {
    active--
    queue.shift()?.()
  }
  return {
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      await acquire()
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

export { SEEDANCE_POLISH_SYSTEM_PROMPT }
export type { RefCharacter }
