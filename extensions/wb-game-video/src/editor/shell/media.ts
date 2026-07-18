/**
 * 媒体解析：把节点演出的 media 引用解析成可播 URL。
 *  - 已是 http/blob/data/绝对路径 URL → 原样用。
 *  - 内置 bundle（assets/zhandou/*.mp4 的 basename）→ 直链。
 *  - 否则视为**共享素材层 registry id** → `/__gva__/media/<id>?game=<slug>`
 *    （见 vite.config.ts gameVideoAssetsPlugin + server/asset-registry）。
 * 返回 undefined = 无演出源（渲染占位）。
 */
import { zhandouUrl } from '../assets/catalog'
import type { MediaAsset, StyleAxes } from '../assets/registry-types'

export function resolveMediaSrc(ref: string | undefined, game?: string): string | undefined {
  if (!ref) return undefined
  if (/^(https?:|blob:|data:|\/)/.test(ref)) return ref
  // demo 里统一按 zhandou 文件名(basename)引用（战斗/叙事视频同源）；兼容运行时 m- 前缀。
  const bare = ref.startsWith('m-') ? ref.slice(2) : ref
  const local = zhandouUrl(bare)
  if (local) return local
  // 其余按共享素材层资产 id 解析。
  return registryMediaUrl(ref, game)
}

/** 共享素材层某资产的同源播放 URL（`/__gva__/media/<id>`）。 */
export function registryMediaUrl(id: string, game?: string): string {
  const q = game ? `?game=${encodeURIComponent(game)}` : ''
  return `/__gva__/media/${encodeURIComponent(id)}${q}`
}

/**
 * 列出该 game 现有的视频资产 id（供演出节点「视频」下拉）。读共享素材层
 * （GET /__gva__/assets?game=<slug>&kind=video）。离线/无端点时返回 []。
 */
export async function listVideoAssets(game?: string): Promise<string[]> {
  return (await listVideoAssetInfos(game)).map((a) => a.id)
}

export interface VideoAssetInfo {
  id: string
  bytes?: number
  mimeType?: string
  label?: string
  status?: MediaAsset['status']
  productionType?: MediaAsset['productionType']
  sceneNodeId?: string
}

/** 同上，但带元信息（视频库视图用）。 */
export async function listVideoAssetInfos(game?: string): Promise<VideoAssetInfo[]> {
  const assets = await listRegistryAssets(game, 'video')
  return assets.map((a) => ({
    id: a.id,
    bytes: a.bytes,
    mimeType: a.mime,
    label: a.label,
    status: a.status,
    productionType: a.productionType,
    sceneNodeId: a.sceneNodeId,
  }))
}

/** 列共享素材层原始 MediaAsset（AssetBoard / 占位卡用）；离线/无端点返回 []。 */
export async function listRegistryAssets(game?: string, kind?: 'video' | 'image'): Promise<MediaAsset[]> {
  try {
    const params = new URLSearchParams()
    if (game) params.set('game', game)
    if (kind) params.set('kind', kind)
    const qs = params.toString()
    const r = await fetch(`/__gva__/assets${qs ? `?${qs}` : ''}`)
    if (!r.ok) return []
    const j = (await r.json()) as { assets?: MediaAsset[] }
    return Array.isArray(j.assets) ? j.assets : []
  } catch {
    return []
  }
}

/** 取单条 registry 资产（轮询生成状态用）。 */
export async function getRegistryAsset(game: string, id: string): Promise<MediaAsset | null> {
  try {
    const r = await fetch(`/__gva__/asset/${encodeURIComponent(id)}?game=${encodeURIComponent(game)}`)
    if (!r.ok) return null
    const j = (await r.json()) as { asset?: MediaAsset | null }
    return j.asset ?? null
  } catch {
    return null
  }
}

export interface GenerateVideoRequest {
  sceneNodeId: string
  nodeName: string
  seedancePrompt?: string
  storyText?: string
  durationSeconds?: number
  artStyle?: string
  styleKeywords?: string[]
  characterRefIds: string[]
  sceneRefIds: string[]
  continuityFirstFrameId?: string
  label?: string
  generateAudio?: boolean
  /** 节点级风格三轴覆盖（P3）；不传用游戏级 manifest.styleAxes。 */
  styleAxes?: StyleAxes
  /** 显式续接段（P5）：前置 V-PROMPT-15 延长块。 */
  extend?: boolean
  transitionHint?: string
}

/** 读游戏级风格三轴（manifest.styleAxes）。离线/无端点返回 null。 */
export async function getGameStyleAxes(game: string): Promise<StyleAxes | null> {
  try {
    const r = await fetch(`/__gva__/style-axes?game=${encodeURIComponent(game)}`)
    if (!r.ok) return null
    const j = (await r.json()) as { styleAxes?: StyleAxes | null }
    return j.styleAxes ?? null
  } catch {
    return null
  }
}

/** 浅合并写游戏级风格三轴，返回合并后结果。 */
export async function setGameStyleAxes(game: string, axes: StyleAxes): Promise<StyleAxes | null> {
  try {
    const r = await fetch(`/__gva__/style-axes?game=${encodeURIComponent(game)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(axes),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { styleAxes?: StyleAxes | null }
    return j.styleAxes ?? null
  } catch {
    return null
  }
}

/**
 * 触发一节点的真实视频生成（服务端 headless 编排，落共享素材层 video_clip）。
 * 立刻返回：成功给 asset（status 从 generating 起，需再轮询到 ready）；失败给 error。
 */
export async function requestGenerateVideo(
  game: string,
  input: GenerateVideoRequest,
): Promise<{ asset?: MediaAsset; error?: string }> {
  return postGva('/__gva__/generate-video', game, input)
}

export interface GenerateKeyframeRequest {
  sceneNodeId: string
  nodeName: string
  beat: string
  seedancePrompt?: string
  variant?: 'video_first_frame' | 'choice_pressure_frame'
  artStyle?: string
  styleKeywords?: string[]
  perspective?: 'first' | 'third'
  povCharacterName?: string
  location?: string
  refAssetIds?: string[]
  label?: string
  /** 节点级风格三轴覆盖（P3）。 */
  styleAxes?: StyleAxes
  /** P4：'keyframe'（默认单帧）| 'grid_storyboard'（6 面板黑白 previs 故事板）。 */
  mode?: 'keyframe' | 'grid_storyboard'
  /** P4：grid 模式额外入参（nodeRole/endingKind/choiceRevealMoment/panelLabels…）。 */
  grid?: Record<string, unknown>
}

/** 触发一节点的分镜图/关键帧生成（落 shot_image）。 */
export async function requestGenerateKeyframe(
  game: string,
  input: GenerateKeyframeRequest,
): Promise<{ asset?: MediaAsset; error?: string }> {
  return postGva('/__gva__/generate-keyframe', game, input)
}

/** 跨模块只读拿料：把 wb-character 立绘登记成 character_ref。返回登记的 ref 列表。 */
export async function importCharacterRefs(game: string): Promise<{ refs: MediaAsset[]; error?: string }> {
  return postGvaRefs('/__gva__/import-character-refs', game)
}

/** 跨模块只读拿料：把场景模块贴图登记成 scene_ref。 */
export async function importSceneRefs(game: string): Promise<{ refs: MediaAsset[]; error?: string }> {
  return postGvaRefs('/__gva__/import-scene-refs', game)
}

async function postGvaRefs(path: string, game: string): Promise<{ refs: MediaAsset[]; error?: string }> {
  try {
    const r = await fetch(`${path}?game=${encodeURIComponent(game)}`, { method: 'POST' })
    const j = (await r.json()) as { refs?: MediaAsset[]; error?: string }
    if (!r.ok) return { refs: [], error: j.error || `HTTP ${r.status}` }
    return { refs: Array.isArray(j.refs) ? j.refs : [], error: j.error }
  } catch (e) {
    return { refs: [], error: (e as Error).message }
  }
}

async function postGva(
  path: string,
  game: string,
  body: unknown,
): Promise<{ asset?: MediaAsset; error?: string }> {
  try {
    const r = await fetch(`${path}?game=${encodeURIComponent(game)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await r.json()) as { asset?: MediaAsset; error?: string }
    if (!r.ok) return { error: j.error || `HTTP ${r.status}` }
    return j
  } catch (e) {
    return { error: (e as Error).message }
  }
}
