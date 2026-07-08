/**
 * 视频游戏「固定资产目录」—— 视频 / 界面 / 规则三个 tab 的内置数据源，
 * 以及蓝图节点「配置」面板各下拉的取值来源。
 *
 * 数据移植自 `视频交互原型.html`（= `新影游平台交互原型.html`），并按
 * 《新影游平台-编辑器开发规格》对齐字段与取值。两处关系：
 *
 *   1. 「视频」tab（VIDEO_CLIPS）= 14 段战斗片段；
 *      → 蓝图节点「演出编号」下拉直接取这份列表（节点 clipId 引用片段 id）；
 *      → 节点「视频类型 / 演出时长」只读派生自所选片段的 type / durMs。
 *   2. 「界面」tab（UI_SCHEMES）= HUD 方案库（主 / 战斗 / 探索 / 隐藏界面，与
 *      HudPreset 对齐）；→ 蓝图节点「HUD 方案」下拉直接取这份列表（节点
 *      hudPreset 引用方案 id），运行时按它叠加 HUD 到视频之上。
 *
 * 不放进 Scenario：这是平台级固定能力清单（可用演出库 / HUD 方案库），跨剧本
 * 共享、不随某本剧本增删，故以模块常量持有，避免污染 Scenario schema。
 */
import type { HudPreset } from './gameplayTypes'

/** 演出片段类型 —— 对齐原型 VIDEO_ASSETS.kind（loop / 演出 / 转场）。 */
export type VideoClipType = 'loop' | '演出' | '转场'

/** 一条内置演出视频。 */
export interface VideoClip {
  /** 稳定 id（节点 clipId 引用它）。 */
  id: string
  /** 显示名（如「空藏 · 轻攻击」）。 */
  label: string
  /** 可播放的视频直链 —— 「视频」tab 预览与试玩运行时都直接播它。 */
  url: string
  /** 片段性质（loop / 演出 / 转场）—— 蓝图面板「视频类型」只读展示。可选。 */
  type?: VideoClipType
  /** 时长（ms）—— 蓝图面板「演出时长」只读展示。可选（未标注时由视频元数据自得）。 */
  durMs?: number
}

/**
 * 演出视频取源开关：
 *   true  = 本地 bundle（Vite 把 `assets/zhandou/*.mp4` 打进插件，与游戏同源，离线可播）
 *   false = 远程直链（CLIP_BASE 指向的内网静态服务器）
 *
 * 默认走本地 glob；想切回远程对比时改这一处即可（本地缺文件时也会自动回落到远程）。
 */
const USE_LOCAL_CLIPS = true

/** 远程直链根路径 —— USE_LOCAL_CLIPS=false 或本地缺文件时的回落来源。 */
const CLIP_BASE = ''

// Vite 构建期把 zhandou/*.mp4 静态导入成带 hash 的最终 URL（dev 直接给源路径），运行时零成本。
const localClipModules = import.meta.glob<string>('../assets/zhandou/*.mp4', {
  eager: true,
  import: 'default',
  query: '?url',
})

/** 文件名（含扩展名）→ 本地 bundle URL。例如 'idle01.mp4' → '/assets/idle01.<hash>.mp4'。 */
const localClipUrlByFile: Record<string, string> = {}
for (const [path, url] of Object.entries(localClipModules)) {
  const file = path.split('/').pop() ?? ''
  localClipUrlByFile[file] = url as unknown as string
}

/**
 * 按文件名解析一条演出视频的可播放 url。
 * 默认取本地 bundle；开关关闭或本地缺该文件时回落到 CLIP_BASE 远程直链。
 */
function clipUrl(file: string): string {
  if (USE_LOCAL_CLIPS) {
    const local = localClipUrlByFile[file]
    if (local) return local
  }
  return `${CLIP_BASE}/${file}`
}

/**
 * 内置演出视频库（t-video）—— 战斗片段固定数据源。
 * 顺序即「视频」tab 左栏展示顺序；每条自带可播放直链 url（节点 clipId 引用其 id）。
 * type / durMs 暂不标注（先固定用这批直链，运行时由视频元数据自得时长）。
 */
export const VIDEO_CLIPS: readonly VideoClip[] = [
  { id: 'vd-wcc-idle', label: '双方 · 待机', url: clipUrl('idle01.mp4'), type: 'loop', durMs: 8000 },
  { id: 'vd-wcc-qianyao', label: '小怪 · 攻击前摇', url: clipUrl('difanggongjiqianyao.mp4'), type: '演出', durMs: 4000 },
  { id: 'vd-wcc-pugong', label: '空藏 · 轻攻击', url: clipUrl('pugong.mp4'), type: '演出', durMs: 5000 },
  { id: 'vd-wcc-pugong2', label: '空藏 · 轻攻击·变招', url: clipUrl('pugong2.mp4'), type: '演出', durMs: 5000 },
  { id: 'vd-wcc-zhong', label: '空藏 · 重攻击', url: clipUrl('zhonggongji.mp4'), type: '演出', durMs: 6000 },
  { id: 'vd-wcc-zhong2', label: '空藏 · 重攻击·变招', url: clipUrl('zhonggongji2.mp4'), type: '演出', durMs: 6000 },
  { id: 'vd-wcc-qinggong', label: '空藏 · 轻攻致死', url: clipUrl('qinggongjizhisi.mp4'), type: '演出', durMs: 7000 },
  { id: 'vd-wcc-dazhao', label: '空藏 · 灭世', url: clipUrl('dazhao.mp4'), type: '演出', durMs: 12000 },
  { id: 'vd-wcc-fangfan', label: '空藏 · 受击防反', url: clipUrl('fangfan.mp4'), type: '演出', durMs: 4000 },
  { id: 'vd-wcc-shanbi', label: '空藏 · 受击闪避', url: clipUrl('shanbi.mp4'), type: '演出', durMs: 4000 },
  { id: 'vd-wcc-huiqi', label: '空藏 · 冥想', url: clipUrl('huiqi.mp4'), type: '演出', durMs: 5000 },
  { id: 'vd-wcc-shouji', label: '空藏 · 受击', url: clipUrl('shouji.mp4'), type: '演出', durMs: 4000 },
  { id: 'vd-wcc-shengli', label: '空藏 · 胜利', url: clipUrl('shengli.mp4'), type: '演出', durMs: 10000 },
  { id: 'vd-wcc-shibai', label: '空藏 · 失败', url: clipUrl('shibai.mp4'), type: '演出', durMs: 6000 },
]

const LEGACY_CLIP_ALIASES: Record<string, string> = {
  idle01: 'vd-wcc-idle',
  difanggongjiqianyao: 'vd-wcc-qianyao',
  pugong: 'vd-wcc-pugong',
  pugong2: 'vd-wcc-pugong2',
  zhonggongji: 'vd-wcc-zhong',
  zhonggongji2: 'vd-wcc-zhong2',
  qinggongjizhisi: 'vd-wcc-qinggong',
  dazhao: 'vd-wcc-dazhao',
  fangfan: 'vd-wcc-fangfan',
  shanbi: 'vd-wcc-shanbi',
  huiqi: 'vd-wcc-huiqi',
  shouji: 'vd-wcc-shouji',
  shengli: 'vd-wcc-shengli',
  shibai: 'vd-wcc-shibai',
}

/** 一套 HUD 界面方案。id 与 HudPreset 对齐，运行时直接当 hudPreset 用。 */
export interface UiScheme {
  /** 与 HudPreset 对齐的 id —— 蓝图面板「HUD 方案」存它进 scene.hudPreset。 */
  id: HudPreset
  /** 显示名。 */
  label: string
  /** 一句说明（列表/预览展示）。 */
  desc: string
}

/**
 * 内置 HUD 界面库（「界面」tab）—— 列表 + 蓝图「HUD 方案」下拉的共同数据源。
 * id 即 HudPreset，运行时叠加到视频之上。
 */
export const UI_SCHEMES: readonly UiScheme[] = [
  { id: 'main', label: '主界面', desc: '常驻主 HUD：玩家血条 / 头像 / 基础操作。' },
  { id: 'battle', label: '战斗界面', desc: '战斗 HUD：玩家 + Boss 血条、技能、状态图标。' },
  { id: 'explore', label: '探索界面', desc: '探索 HUD：背包 / 热点提示 / 简化操作。' },
  { id: 'hidden', label: '隐藏界面', desc: '纯过场：隐藏全部 HUD，只留画面。' },
  { id: 'narrative', label: '叙事主界面', desc: '叙事 HUD：左上四维属性（理智/佛性/业障/痴），适用于国风叙事段。' },
]

/** 一条玩法规则（固定展示数据）。 */
export interface GameRule {
  id: string
  label: string
  /** 规则条目（每行一条，列表点开后逐条展示）。 */
  lines: string[]
}

/**
 * 内置规则库（t-rule）—— 「规则」tab 列表 + 预览数据源。移植自原型 t-rule（玩家 / 敌人）。
 */
export const GAME_RULES: readonly GameRule[] = [
  {
    id: 'r-player',
    label: '空藏',
    lines: [
      '生命值：300（受击归零则进入失败演出）',
      '攻击力 80 · 防御力 40 · 暴击率 10%',
      '气力上限：5（满气可触发「灭世」终结技）',
      '出手速度 30 · 先手判定：出手速度大者先手',
    ],
  },
  {
    id: 'r-enemy',
    label: '小怪',
    lines: [
      '生命值：700',
      '攻击力 75 · 防御力 50 · 暴击率 8%',
      '进攻欲望 0.5 · 出手速度 25',
      '受创硬直：被重攻击命中后进入硬直',
    ],
  },
]

/** 按 id 取演出视频元数据（找不到返回 undefined）。 */
export function getVideoClip(id: string | undefined): VideoClip | undefined {
  if (!id) return undefined
  const canonical = LEGACY_CLIP_ALIASES[id] ?? id
  return VIDEO_CLIPS.find((v) => v.id === canonical)
}

/** 按 id 取 HUD 方案。 */
export function getUiScheme(id: HudPreset | undefined): UiScheme | undefined {
  if (!id) return undefined
  return UI_SCHEMES.find((u) => u.id === id)
}

/** 按 id 取规则。 */
export function getGameRule(id: string | undefined): GameRule | undefined {
  if (!id) return undefined
  return GAME_RULES.find((r) => r.id === id)
}
