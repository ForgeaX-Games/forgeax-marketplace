/**
 * wb-game-video `entry.backend` for ToolRegistry —— **graph-native** 工具层。
 *
 * 新引擎（GameGraph）时代：AI 与工坊沟通契约 = 读写库文档（GraphLibraryDocument）。
 *
 * 盘上格式与 forgeax 宿主 `/api/game-host` 同格式（单写者不分叉），经 `blueprint-store-fs`：
 *   游戏仓根 `.forgeax/games/<slug>/blueprint.json`（+ project.json）。
 * 版本 = 游戏仓 git annotated tag（由 game-host 打）。
 *
 * 两种宿主上下文按需归一成 boundGameId/gameRoot/extensionRoot：
 *   Arrival: gameId + cwd(gameRoot) + extensionDir
 *   ForgeaX: game + projectRoot + cwd(extensionRoot)
 * list-videos 只需要 extensionRoot；游戏相关工具才要求游戏绑定。
 * 不读取 active-game，不从进程 cwd 猜测用户数据根。
 */

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAsset, listAssets } from './asset-registry'
import type { AssetFilter } from './asset-registry'
import type { MediaKind, MediaProductionType, StyleAxes } from '../src/editor/assets/registry-types'
import {
  generateKeyframe,
  generateNodeVideo,
  generateShotScript,
  generateVideo,
  type KeyframeInput,
  type OrchestrateCtx,
} from './generation/orchestrate'
import type { ExtensionCapabilities } from './generation/video-generation-gateway'
import { importCharacterRefs, importSceneRefs } from './intake'
import { readProject, writeProject } from '../src/editor/persist/blueprint-store-fs'
import { validateDocument } from '../src/editor/persist/blueprint-project'
import type { GraphLibraryDocument } from '../src/runtime/schema/graph-schema'

interface ToolCtx {
  caller: { kind: string; id?: string }
  toolId: string
  env?: Record<string, string | undefined>
  cwd?: string
  extensionDir?: string
  gameId?: string
  projectRoot?: string
  game?: string
  /** Host-provided bridge to the extension-platform capability registry. */
  capabilities?: ExtensionCapabilities
}

interface BoundHostContext {
  boundGameId: string
  gameRoot: string
  extensionRoot: string
}

/** Unicode 和单字符均合法；只拒绝空、路径分隔符以及 `.` / `..`。 */
function isSafeGameId(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
  )
}

/** 扩展自带资源不属于某个游戏，允许在尚未绑定 game 的会话中读取。 */
function resolveExtensionRoot(ctx: ToolCtx): string | null {
  if (ctx.extensionDir) return resolve(ctx.extensionDir)
  if (ctx.cwd) return resolve(ctx.cwd)
  return null
}

/** 显式适配 Arrival 与 ForgeaX 两种宿主形态，不做全局 active-game fallback。 */
function bindHostContext(ctx: ToolCtx): BoundHostContext | null {
  if (ctx.gameId !== undefined) {
    const extensionRoot = resolveExtensionRoot(ctx)
    if (!isSafeGameId(ctx.gameId) || !ctx.cwd || !extensionRoot) return null
    return {
      boundGameId: ctx.gameId,
      gameRoot: resolve(ctx.cwd),
      extensionRoot,
    }
  }
  const extensionRoot = resolveExtensionRoot(ctx)
  if (!isSafeGameId(ctx.game) || !ctx.projectRoot || !extensionRoot) return null
  return {
    boundGameId: ctx.game,
    gameRoot: resolve(ctx.projectRoot, '.forgeax', 'games', ctx.game),
    extensionRoot,
  }
}

/** 显式 gameSlug 若存在，必须与宿主绑定 id 逐字相等。 */
function pickSlug(args: { gameSlug?: string }, bound: BoundHostContext | null): string | null {
  if (!bound) return null
  if (args.gameSlug !== undefined && args.gameSlug !== bound.boundGameId) return null
  return bound.boundGameId
}

/**
 * 取宿主已绑定的目标游戏根（写 blueprint.json / project.json）。
 */
function graphDir(ctx: ToolCtx, slug: string | null): string | null {
  const bound = bindHostContext(ctx)
  if (!slug || !bound || slug !== bound.boundGameId) return null
  return bound.gameRoot
}

/** 解析素材层编排上下文（assetsDir 绝对路径 + 网关 env）。无工程根/slug 则 null。 */
function orchestrateCtx(args: { gameSlug?: string }, ctx: ToolCtx): OrchestrateCtx | null {
  const bound = bindHostContext(ctx)
  const slug = pickSlug(args, bound)
  if (!slug || !bound) return null
  const dir = resolve(bound.gameRoot, 'assets')
  return { dir, gameId: slug, env: ctx.env, capabilities: ctx.capabilities }
}

const NO_REGISTRY_ERR = '宿主未绑定有效游戏目录或 gameSlug 与当前游戏不一致，无法访问素材层'

/** 跨模块只读产物目录（characters / textures），与素材层平级。缺工程根/slug 返回 null。 */
function crossModuleDir(args: { gameSlug?: string }, ctx: ToolCtx, sub: 'characters' | 'textures'): string | null {
  const bound = bindHostContext(ctx)
  const slug = pickSlug(args, bound)
  if (!slug || !bound) return null
  return resolve(bound.gameRoot, sub)
}

/** 线协议视角枚举（first/third）→ 引擎 IP 内部中文视角串（POV 段靠 "第一人称" 触发）。 */
function mapPerspective(p?: 'first' | 'third'): string | undefined {
  if (p === 'first') return '第一人称'
  if (p === 'third') return '第三人称'
  return undefined
}

/** 线协议角色 { name, desc } → 引擎薄投影 { name, appearance }（其余字段 IP 不消费）。 */
function mapChars(cs?: { name: string; desc?: string }[]): { name: string; appearance?: string }[] | undefined {
  if (!cs?.length) return undefined
  return cs.map((c) => (c.desc ? { name: c.name, appearance: c.desc } : { name: c.name }))
}

/** wb-game-video:generate-shot-script 线协议入参（对齐 schemas/generate-shot-script.args.json）。 */
interface ShotScriptArgs {
  gameSlug?: string
  sceneNodeId?: string
  nodeName?: string
  storyText?: string
  durationSeconds?: number
  artStyle?: string
  styleKeywords?: string[]
  perspective?: 'first' | 'third'
  tone?: string
  characters?: { name: string; desc?: string }[]
  location?: string
  interactive?: boolean
  choiceCount?: number
  styleAxes?: StyleAxes
}

/** wb-game-video:generate-keyframe 线协议入参（对齐 schemas/generate-keyframe.args.json）。 */
interface KeyframeArgs {
  gameSlug?: string
  sceneNodeId?: string
  nodeName?: string
  beat?: string
  variant?: 'video_first_frame' | 'choice_pressure_frame'
  perspective?: 'first' | 'third'
  characters?: { name: string; desc?: string }[]
  location?: string
  refAssetIds?: string[]
  label?: string
  styleAxes?: StyleAxes
  mode?: 'keyframe' | 'grid_storyboard'
  grid?: KeyframeInput['grid']
}

/** wb-game-video:generate-video / wb-game-video:generate-node-video 线协议入参（对齐两份 schema）。 */
interface VideoArgs {
  gameSlug?: string
  sceneNodeId?: string
  nodeName?: string
  seedancePrompt?: string
  storyText?: string
  durationSeconds?: number
  artStyle?: string
  styleKeywords?: string[]
  characterRefIds?: string[]
  sceneRefIds?: string[]
  continuityFirstFrameId?: string
  label?: string
  generateAudio?: boolean
  styleAxes?: StyleAxes
  extend?: boolean
  transitionHint?: string
}

export const tools = {
  /**
   * 读取当前 game 的库文档（GraphLibraryDocument = scenario + manifest）。
   * 无盘数据时 project 为 null。args: { gameSlug? }
   */
  'wb-game-video:get-graph': async (args: { gameSlug?: string }, ctx: ToolCtx) => {
    const slug = pickSlug(args, bindHostContext(ctx))
    const dir = graphDir(ctx, slug)
    const project = dir ? readProject(dir).project : null
    return { project, gameSlug: slug }
  },

  /**
   * 覆盖写当前 game 的 blueprint.json；title 为保留参数，当前忽略。
   * args: { gameSlug?, project, title? }；成功 versions 固定为空数组。
   */
  'wb-game-video:save-graph': async (
    args: { gameSlug?: string; project?: GraphLibraryDocument; title?: string },
    ctx: ToolCtx,
  ) => {
    const slug = pickSlug(args, bindHostContext(ctx))
    const dir = graphDir(ctx, slug)
    if (!dir) return { ok: false, errors: ['宿主未绑定有效游戏目录或 gameSlug 与当前游戏不一致，无法落盘'] }
    if (!args.project) return { ok: false, errors: ['缺少 project'] }
    const errors = validateDocument(args.project)
    if (errors.length) return { ok: false, errors, gameSlug: slug }
    return { ok: true, versions: writeProject(dir, args.project, args.title), gameSlug: slug }
  },

  /**
   * 列出内置演出视频库（`src/editor/assets/zhandou/*.mp4` 的 basename，去扩展名）——
   * 供 AI 编排时知道有哪些 media.ref 可绑。
   */
  'wb-game-video:list-videos': async (_args: Record<string, never>, ctx: ToolCtx) => {
    try {
      const extensionRoot = resolveExtensionRoot(ctx)
      if (!extensionRoot) throw new Error('宿主未提供扩展目录')
      const dir = resolve(extensionRoot, 'src', 'editor', 'assets', 'zhandou')
      const videos = readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.mp4'))
        .map((f) => f.replace(/\.mp4$/i, ''))
        .sort()
      return { videos }
    } catch (e) {
      return { videos: [], error: String(e) }
    }
  },

  /**
   * Step 1 · 生成一节点的 Seedance V2 镜头脚本（纯 prompt→text，不落 registry）。
   * args: ShotScriptInput 薄输入（见 schemas/generate-shot-script.args.json）。
   */
  'wb-game-video:generate-shot-script': async (args: ShotScriptArgs, ctx: ToolCtx) => {
    const octx = orchestrateCtx(args, ctx)
    if (!octx) return { shots: [], error: NO_REGISTRY_ERR }
    if (!args.nodeName || !args.storyText) return { shots: [], error: '缺 nodeName / storyText' }
    try {
      const shots = await generateShotScript(octx, {
        nodeName: args.nodeName,
        storyText: args.storyText,
        durationSeconds: args.durationSeconds ?? 8,
        artStyle: args.artStyle,
        styleKeywords: args.styleKeywords,
        perspective: mapPerspective(args.perspective),
        tone: args.tone,
        characters: mapChars(args.characters),
        location: args.location,
        // 线协议 interactive/choiceCount → IP 的 choicesLength（≥2 且非结局才触发抉择浮现规则）。
        choicesLength: args.choiceCount ?? (args.interactive ? 2 : undefined),
        styleAxes: args.styleAxes,
      })
      return { shots }
    } catch (e) {
      return { shots: [], error: (e as Error).message }
    }
  },

  /**
   * Step 2 · 生成一张分镜图/关键帧，落 registry（shot_image）。
   * args: KeyframeInput 薄输入（见 schemas/generate-keyframe.args.json）。
   */
  'wb-game-video:generate-keyframe': async (args: KeyframeArgs, ctx: ToolCtx) => {
    const octx = orchestrateCtx(args, ctx)
    if (!octx) return { asset: null, error: NO_REGISTRY_ERR }
    if (!args.sceneNodeId || !args.nodeName || !args.beat) return { asset: null, error: '缺 sceneNodeId / nodeName / beat' }
    try {
      const asset = await generateKeyframe(octx, {
        sceneNodeId: args.sceneNodeId,
        nodeName: args.nodeName,
        beat: args.beat,
        variant: args.variant,
        perspective: mapPerspective(args.perspective),
        characters: mapChars(args.characters),
        location: args.location,
        refAssetIds: args.refAssetIds,
        label: args.label,
        styleAxes: args.styleAxes,
        mode: args.mode,
        grid: args.grid,
      })
      return { asset }
    } catch (e) {
      return { asset: null, error: (e as Error).message }
    }
  },

  /**
   * Step 3 · 生成一段视频，落 registry（video_clip）。必传 character/scene 参考图，缺则可读错。
   * args: VideoGenInput 薄输入（见 schemas/generate-video.args.json）。返回 asset.id 供绑 node.data.media.ref。
   */
  'wb-game-video:generate-video': async (args: VideoArgs, ctx: ToolCtx) => {
    const octx = orchestrateCtx(args, ctx)
    if (!octx) return { asset: null, error: NO_REGISTRY_ERR }
    if (!args.sceneNodeId || !args.nodeName) return { asset: null, error: '缺 sceneNodeId / nodeName' }
    try {
      const asset = await generateVideo(octx, {
        sceneNodeId: args.sceneNodeId,
        nodeName: args.nodeName,
        seedancePrompt: args.seedancePrompt,
        storyText: args.storyText,
        durationSeconds: args.durationSeconds ?? 8,
        artStyle: args.artStyle,
        styleKeywords: args.styleKeywords,
        characterRefIds: args.characterRefIds ?? [],
        sceneRefIds: args.sceneRefIds ?? [],
        continuityFirstFrameId: args.continuityFirstFrameId,
        label: args.label,
        generateAudio: args.generateAudio,
        styleAxes: args.styleAxes,
        extend: args.extend,
        transitionHint: args.transitionHint,
      })
      return { asset }
    } catch (e) {
      return { asset: null, error: (e as Error).message }
    }
  },

  /**
   * Step 3b · 为一节点生成成片，时长 > 15s 自动按 15s 拆段续接（P5 超长检测 + 显式 extend）。
   * 必传 character/scene 参考图。返回 assets[]（按段序），单段时长度为 1。
   * args: 同 wb-game-video:generate-video（durationSeconds 可 > 15）。
   */
  'wb-game-video:generate-node-video': async (args: VideoArgs, ctx: ToolCtx) => {
    const octx = orchestrateCtx(args, ctx)
    if (!octx) return { assets: [], error: NO_REGISTRY_ERR }
    if (!args.sceneNodeId || !args.nodeName) return { assets: [], error: '缺 sceneNodeId / nodeName' }
    try {
      const assets = await generateNodeVideo(octx, {
        sceneNodeId: args.sceneNodeId,
        nodeName: args.nodeName,
        seedancePrompt: args.seedancePrompt,
        storyText: args.storyText,
        durationSeconds: args.durationSeconds ?? 8,
        artStyle: args.artStyle,
        styleKeywords: args.styleKeywords,
        characterRefIds: args.characterRefIds ?? [],
        sceneRefIds: args.sceneRefIds ?? [],
        continuityFirstFrameId: args.continuityFirstFrameId,
        label: args.label,
        generateAudio: args.generateAudio,
        styleAxes: args.styleAxes,
        transitionHint: args.transitionHint,
      })
      return { assets }
    } catch (e) {
      return { assets: [], error: (e as Error).message }
    }
  },

  /** 列素材层资产（可按 kind / productionType / sceneNodeId 过滤）。 */
  'wb-game-video:list-assets': async (
    args: { gameSlug?: string; kind?: MediaKind; productionType?: MediaProductionType; sceneNodeId?: string },
    ctx: ToolCtx,
  ) => {
    const octx = orchestrateCtx(args, ctx)
    if (!octx) return { assets: [], error: NO_REGISTRY_ERR }
    const filter: AssetFilter = {}
    if (args.kind) filter.kind = args.kind
    if (args.productionType) filter.productionType = args.productionType
    if (args.sceneNodeId) filter.sceneNodeId = args.sceneNodeId
    return { assets: listAssets(octx.dir, filter) }
  },

  /** 取单条素材资产。 */
  'wb-game-video:get-asset': async (args: { gameSlug?: string; id?: string }, ctx: ToolCtx) => {
    const octx = orchestrateCtx(args, ctx)
    if (!octx) return { asset: null, error: NO_REGISTRY_ERR }
    if (!args.id) return { asset: null, error: '缺 id' }
    return { asset: getAsset(octx.dir, args.id) }
  },

  /**
   * 跨模块只读拿料：扫 wb-character 的 `characters/<charId>/manifest.json`，把角色立绘
   * 登记成本 registry 的只读 character_ref（externalPath 指回对方文件，不复制、不改对方）。
   * 生成视频前先调它把角色参考图备齐。
   */
  'wb-game-video:import-character-refs': async (args: { gameSlug?: string }, ctx: ToolCtx) => {
    const octx = orchestrateCtx(args, ctx)
    const charactersDir = crossModuleDir(args, ctx, 'characters')
    if (!octx || !charactersDir) return { refs: [], error: NO_REGISTRY_ERR }
    try {
      return { refs: importCharacterRefs({ assetsDir: octx.dir, charactersDir }) }
    } catch (e) {
      return { refs: [], error: (e as Error).message }
    }
  },

  /**
   * 跨模块只读拿料：扫场景模块发布到 `textures/index.json` 的贴图/场景图，登记成本 registry
   * 的只读 scene_ref（externalPath 指回对方文件）。生成视频前先调它把场景参考图备齐。
   */
  'wb-game-video:import-scene-refs': async (args: { gameSlug?: string }, ctx: ToolCtx) => {
    const octx = orchestrateCtx(args, ctx)
    const texturesDir = crossModuleDir(args, ctx, 'textures')
    if (!octx || !texturesDir) return { refs: [], error: NO_REGISTRY_ERR }
    try {
      return { refs: importSceneRefs({ assetsDir: octx.dir, texturesDir }) }
    } catch (e) {
      return { refs: [], error: (e as Error).message }
    }
  },
}

export default tools
