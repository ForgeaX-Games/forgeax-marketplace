/**
 * UI Curator —— 按「当前剧本 + 视觉风格」自动策划一套叠加式 UI 素材(UIAsset[])。
 *
 * 定位(镜像 sceneBgmComposer):纯函数 "剧本上下文 → UIAsset[]",除 LLM call 外无副作用
 * (不改 scenarioStore、不生图)。上层 UI(UIAssetLibrary「AI 生成整套」)拿到结果后
 * 逐条 upsert，再由作者逐个点「生成素材图」批量出图。
 *
 * 去背纪律(与 uiAssetArt 一致):发光/金色/粒子 → screen-black;暗色线稿 → multiply-white;
 * 极少数需要真透明的整形主体才用 chroma(手动)。LLM 只在这三档里选,不发明新底色。
 *
 * 三档用户输入(userHint):auto(无) / 中文粗描述 / 参考风格。永远最高优先级。
 */

import type { UIAsset, UIAssetRole, UIMatte } from '../../scenario/types'
import type { TextClient } from '../config/types'
import { createTextProvider } from '../providers/ClaudeAzureProvider'
import { SKILLS } from '../skills'
import { parseJSONLoose } from '../util/parseJSONLoose'
import { UI_ROLE_PRESETS, makeUIAsset } from '../../forge/modules/uiAssetArt'

export interface UICuratorInput {
  synopsis?: string
  visualStyle?: string
  filmLook?: string
  /** 全局 UI 风格描述(scenario.uiStyle.prompt)。 */
  uiStylePrompt?: string
  /** 角色名(供 nameplate / avatar 参考)。 */
  characters?: string[]
  /** 变量注册表(供 hp-bar 等 valueBind 建议)。 */
  variables?: { id: string; name: string; kind: 'number' | 'flag' }[]
  /** 作者一句话需求,最高优先级。 */
  userHint?: string
  /** 可选注入 LLM(测试);缺省内部 createTextProvider()。 */
  llm?: TextClient | null
}

const VALID_ROLES = new Set<string>(Object.keys(UI_ROLE_PRESETS))
const VALID_MATTES = new Set<UIMatte>(['screen-black', 'multiply-white', 'alpha', 'chroma', 'opaque'])
const VALID_LIFECYCLES = new Set<UIAsset['lifecycle']>(['transient', 'scene', 'hud'])

interface CuratedItem {
  role: UIAssetRole
  name?: string
  prompt?: string
  matte?: UIMatte
  lifecycle?: UIAsset['lifecycle']
  anchor?: { x: number; y: number; scale?: number }
  valueBindVarId?: string
}

/**
 * 入口。LLM 优先,失败/无 key → 启发式兜底(基于剧本上下文的一套起手素材)。
 * 返回的每个 UIAsset 都带唯一 id、合理默认 matte/blendMode/anchor/lifecycle。
 */
export async function generateUISet(input: UICuratorInput): Promise<UIAsset[]> {
  let llm = input.llm
  if (llm === undefined) {
    try {
      llm = createTextProvider()
    } catch {
      llm = null
    }
  }

  let items: CuratedItem[] | null = null
  if (llm) {
    try {
      const raw = await llm.generate({
        systemPrompt: SKILLS.uiCurator,
        userPrompt: composeUserPrompt(input),
        temperature: 0.7,
        maxTokens: 1400,
        jsonMode: true,
      })
      items = validateItems(parseJSONLoose(raw))
    } catch (e) {
      console.warn('[uiCurator] LLM failed, using heuristic fallback:', e)
    }
  }

  if (!items || items.length === 0) {
    items = heuristicSet(input)
  }
  return toAssets(items, input)
}

function composeUserPrompt(input: UICuratorInput): string {
  const lines: string[] = []
  if (input.synopsis) lines.push(`synopsis: ${truncate(input.synopsis, 400)}`)
  if (input.visualStyle) lines.push(`visualStyle: ${input.visualStyle}`)
  if (input.filmLook) lines.push(`filmLook: ${input.filmLook}`)
  if (input.uiStylePrompt) lines.push(`uiStyle: ${truncate(input.uiStylePrompt, 200)}`)
  if (input.characters && input.characters.length > 0) {
    lines.push(`characters: [${input.characters.slice(0, 8).map((c) => JSON.stringify(c)).join(', ')}]`)
  }
  if (input.variables && input.variables.length > 0) {
    lines.push(
      `variables: [${input.variables
        .slice(0, 12)
        .map((v) => `${v.id}(${v.name},${v.kind})`)
        .join(', ')}]`,
    )
  }
  lines.push('')
  lines.push(`availableRoles: [${Object.keys(UI_ROLE_PRESETS).join(', ')}]`)
  if (input.userHint && input.userHint.trim()) {
    lines.push(`userHint: ${JSON.stringify(input.userHint.trim())}`)
  }
  return lines.join('\n')
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

/** 校验 LLM 返回:接受 {assets:[...]} 或裸数组。逐项收窄,非法项丢弃。 */
function validateItems(raw: unknown): CuratedItem[] | null {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { assets?: unknown }).assets)
      ? (raw as { assets: unknown[] }).assets
      : null
  if (!arr) return null
  const out: CuratedItem[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const r = it as Record<string, unknown>
    const role = typeof r.role === 'string' && VALID_ROLES.has(r.role) ? (r.role as UIAssetRole) : null
    if (!role) continue
    const item: CuratedItem = { role }
    if (typeof r.name === 'string' && r.name.trim()) item.name = r.name.trim().slice(0, 40)
    if (typeof r.prompt === 'string' && r.prompt.trim()) item.prompt = r.prompt.trim().slice(0, 400)
    if (typeof r.matte === 'string' && VALID_MATTES.has(r.matte as UIMatte)) item.matte = r.matte as UIMatte
    if (typeof r.lifecycle === 'string' && VALID_LIFECYCLES.has(r.lifecycle as UIAsset['lifecycle'])) {
      item.lifecycle = r.lifecycle as UIAsset['lifecycle']
    }
    const anchor = r.anchor as { x?: unknown; y?: unknown; scale?: unknown } | undefined
    if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
      item.anchor = {
        x: clamp01(anchor.x),
        y: clamp01(anchor.y),
        ...(typeof anchor.scale === 'number' ? { scale: anchor.scale } : {}),
      }
    }
    if (typeof r.valueBindVarId === 'string' && r.valueBindVarId.trim()) {
      item.valueBindVarId = r.valueBindVarId.trim()
    }
    out.push(item)
    if (out.length >= 16) break
  }
  return out.length ? out : null
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** 把策划项落成完整 UIAsset(唯一 id + 默认值 + 覆盖)。 */
function toAssets(items: CuratedItem[], input: UICuratorInput): UIAsset[] {
  const firstNumberVar = input.variables?.find((v) => v.kind === 'number')?.id
  const seen = new Set<string>()
  const out: UIAsset[] = []
  let seq = 0
  for (const it of items) {
    const id = `ui_${it.role}_${Date.now().toString(36)}_${seq++}`
    const asset = makeUIAsset({
      id,
      role: it.role,
      name: it.name,
      prompt: it.prompt,
      matte: it.matte,
    })
    if (it.lifecycle) asset.lifecycle = it.lifecycle
    if (it.anchor) asset.defaultAnchor = it.anchor
    // hp-bar 等值绑定:优先 LLM 建议的 varId,否则挂第一个 number 变量。
    if (asset.valueBind) {
      const varId = it.valueBindVarId || firstNumberVar || ''
      asset.valueBind = { ...asset.valueBind, varId }
    }
    // 去重(同 role 同名视为重复,避免 LLM 抖动产出两份一样的)。
    const key = `${asset.role}::${asset.name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(asset)
  }
  return out
}

/**
 * 启发式兜底 —— 无 LLM / 输出非法时,按剧本上下文给一套「起手 UI 素材」。
 * 覆盖最高频的叙事 UI;有数值变量则补血条。prompt 只用剧本关键词点缀,底色纪律固定。
 */
function heuristicSet(input: UICuratorInput): CuratedItem[] {
  const styleTag = [input.visualStyle, input.filmLook].filter(Boolean).join(' / ')
  const flavor = styleTag ? `风格:${styleTag}` : ''
  const items: CuratedItem[] = [
    { role: 'affinity', name: '好感度提升', prompt: `好感度 +，金色爱心与光粒子。${flavor}` },
    { role: 'affinity', name: '好感度下降', prompt: `好感度 −，冷色破碎爱心与暗光。${flavor}` },
    { role: 'nameplate', name: '人物出场姓名条', prompt: `角色登场姓名条。${flavor}` },
    { role: 'location-title', name: '地点标题卡', prompt: `地域名称标题卡。${flavor}` },
    { role: 'act-transition', name: '幕次/时间流逝', prompt: `第二日 / 幕次切换字卡。${flavor}` },
    { role: 'interaction-hint', name: '交互点提示', prompt: `可交互热点脉冲光环。${flavor}` },
  ]
  const numberVar = input.variables?.find((v) => v.kind === 'number')
  if (numberVar) {
    items.push({
      role: 'hp-bar',
      name: `${numberVar.name}条`,
      prompt: `与「${numberVar.name}」联动的能量条。${flavor}`,
      valueBindVarId: numberVar.id,
    })
  }
  return items
}

/** @internal 单测可见 */
export const __test = { validateItems, heuristicSet, toAssets, composeUserPrompt }
