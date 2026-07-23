/**
 * wb-game-video `entry.backend` for ToolRegistry —— **graph-native** 工具层。
 *
 * 新引擎（GameGraph）时代：AI 与工坊沟通契约 = 读写库文档（GraphLibraryDocument）。
 *
 * 盘上格式与 forgeax 宿主 `/api/game-host` 同格式（单写者不分叉），经 `blueprint-store-fs`：
 *   游戏仓根 `.forgeax/games/<slug>/blueprint.json`（+ project.json）。
 * 版本 = 游戏仓 git annotated tag（由 game-host 打）。
 *
 * 沙箱契约：handlers 只用 ctx.env 取配置、ctx.cwd 定位工程根；绝不读 process.env。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { assetsDir as resolveAssetsDir, getAsset, listAssets } from './asset-registry'
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
import { importCharacterRefs, importSceneRefs } from './intake'
import { readProject, writeProject } from '../src/editor/persist/blueprint-store-fs'
import { validateDocument } from '../src/editor/persist/blueprint-project'
import type { GraphLibraryDocument } from '../src/runtime/schema/graph-schema'

interface ToolCtx {
  caller: { kind: string; id?: string }
  toolId: string
  env?: Record<string, string | undefined>
  cwd?: string
}

const GAME_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

/** 从 ctx.cwd（插件目录）向上找出含 `.forgeax/` 的工程根。找不到返回 null。 */
function findProjectRoot(ctx: ToolCtx): string | null {
  let dir = ctx.cwd ?? process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, '.forgeax'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 读当前激活 game 的 slug（`.forgeax/active-game.json`）。无则 null（全局库）。 */
function resolveActiveGameSlug(ctx: ToolCtx): string | null {
  const root = findProjectRoot(ctx)
  if (!root) return null
  try {
    const parsed = JSON.parse(readFileSync(resolve(root, '.forgeax', 'active-game.json'), 'utf-8')) as { slug?: unknown }
    const slug = typeof parsed.slug === 'string' ? parsed.slug : null
    return slug && GAME_SLUG_RE.test(slug) ? slug : null
  } catch {
    return null
  }
}

/** 取有效 slug：显式 args.gameSlug 优先，否则读 active-game。 */
function pickSlug(args: { gameSlug?: string }, ctx: ToolCtx): string | null {
  const explicit = (args.gameSlug ?? '').trim()
  if (explicit) return GAME_SLUG_RE.test(explicit) ? explicit : null
  return resolveActiveGameSlug(ctx)
}

/**
 * GameGraph 落盘目录 = 游戏仓根 `.forgeax/games/<slug>/`（写 blueprint.json / project.json，
 * 与 forgeax 宿主 `/api/game-host` 同格式）；缺工程根或 slug 则 null。
 */
function graphDir(ctx: ToolCtx, slug: string | null): string | null {
  const root = findProjectRoot(ctx)
  if (!slug || !root) return null
  return resolve(root, '.forgeax', 'games', slug)
}

/** 解析素材层编排上下文（assetsDir 绝对路径 + 网关 env）。无工程根/slug 则 null。 */
function orchestrateCtx(args: { gameSlug?: string }, ctx: ToolCtx): OrchestrateCtx | null {
  const slug = pickSlug(args, ctx)
  const dir = resolveAssetsDir(findProjectRoot(ctx), slug)
  if (!dir) return null
  return { dir, env: ctx.env }
}

const NO_REGISTRY_ERR = '无 .forgeax 工程根或无效 gameSlug，无法访问素材层'

/** 跨模块只读产物目录（characters / textures），与素材层平级。缺工程根/slug 返回 null。 */
function crossModuleDir(args: { gameSlug?: string }, ctx: ToolCtx, sub: 'characters' | 'textures'): string | null {
  const slug = pickSlug(args, ctx)
  const root = findProjectRoot(ctx)
  if (!slug || !root) return null
  return resolve(root, '.forgeax', 'games', slug, sub)
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

/** gen:generate-shot-script 线协议入参（对齐 schemas/generate-shot-script.args.json）。 */
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

/** gen:generate-keyframe 线协议入参（对齐 schemas/generate-keyframe.args.json）。 */
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

/** gen:generate-video / gen:generate-node-video 线协议入参（对齐两份 schema）。 */
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
  'gvid:get-graph': async (args: { gameSlug?: string }, ctx: ToolCtx) => {
    const slug = pickSlug(args, ctx)
    const dir = graphDir(ctx, slug)
    const project = dir ? readProject(dir).project : null
    return { project, gameSlug: slug }
  },

  /**
   * 覆盖写当前 game 的库文档，并压一版快照（留 10）。
   * args: { gameSlug?, project, title? }
   */
  'gvid:save-graph': async (
    args: { gameSlug?: string; project?: GraphLibraryDocument; title?: string },
    ctx: ToolCtx,
  ) => {
    const slug = pickSlug(args, ctx)
    const dir = graphDir(ctx, slug)
    if (!dir) return { ok: false, errors: ['无 .forgeax 工程根或无效 gameSlug，无法落盘'] }
    if (!args.project) return { ok: false, errors: ['缺少 project'] }
    const errors = validateDocument(args.project)
    if (errors.length) return { ok: false, errors, gameSlug: slug }
    return { ok: true, versions: writeProject(dir, args.project, args.title), gameSlug: slug }
  },

  /**
   * 列出内置演出视频库（`src/editor/assets/zhandou/*.mp4` 的 basename，去扩展名）——
   * 供 AI 编排时知道有哪些 media.ref 可绑。
   */
  'gvid:list-videos': async (_args: Record<string, never>, ctx: ToolCtx) => {
    try {
      const dir = resolve(ctx.cwd ?? process.cwd(), 'src', 'editor', 'assets', 'zhandou')
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
  'gen:generate-shot-script': async (args: ShotScriptArgs, ctx: ToolCtx) => {
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
  'gen:generate-keyframe': async (args: KeyframeArgs, ctx: ToolCtx) => {
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
  'gen:generate-video': async (args: VideoArgs, ctx: ToolCtx) => {
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
   * args: 同 gen:generate-video（durationSeconds 可 > 15）。
   */
  'gen:generate-node-video': async (args: VideoArgs, ctx: ToolCtx) => {
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
  'gen:list-assets': async (
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
  'gen:get-asset': async (args: { gameSlug?: string; id?: string }, ctx: ToolCtx) => {
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
  'gen:import-character-refs': async (args: { gameSlug?: string }, ctx: ToolCtx) => {
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
  'gen:import-scene-refs': async (args: { gameSlug?: string }, ctx: ToolCtx) => {
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
