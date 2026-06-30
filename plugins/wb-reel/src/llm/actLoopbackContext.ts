/**
 * actLoopbackContext —— 把"作者已确认的前 Act 设定"反哺到后续 Act 的 batch trio。
 *
 * 这一层是 Phase 5 的"一致性回流"：
 *
 *   作者跑完 Phase 4 拿到一份 scenario，会去手工：
 *     1. 在 PromptTabs / CharacterEditor 里调角色 prompt（"风衣换成黑色羊毛大衣"）
 *     2. 在 LocationEditor 里调场所描述
 *     3. 在 props 里加/改关键道具
 *     4. 在 uiStyle 里把整剧的 UI 风格定下来
 *
 *   这些字段一旦保存就是"硬约束"——任何后续的 batch trio / 重生场景都不应改写这些设定。
 *   本模块的作用是：把这些"已确认"字段提取成一段**结构化的 LOCKED_ANCHORS 文本**，
 *   注入到下一次 batch trio 调用的 user prompt 里，让 LLM 把它们当不可改的锚点。
 *
 *   另一种回流：在跨 Act 顺序处理时，把**已经成功 batch 的前 Act 的产物摘要**
 *   （每 scene 的角色外观一句话、关键道具、光源风格）作为 PRECEDING_ACT_CONTEXT
 *   塞进下一 Act 的 user prompt。这样作者敲定的前 Act 视觉/光影会自然向后传播。
 *
 * 设计取舍：
 *
 *   - 不引入新字段（不加 character.locked 之类）：scenario 数据结构已经够复杂，
 *     额外字段会污染持久化文件 + zundo history。整 scenario.characters/locations/props
 *     的当前值就当"已确认"用——作者改过的、自动产出的，对下游都是同一种约束力。
 *   - precedingContext 只取"摘要"而非完整 trio：避免上下文爆 token；摘要的目的不是
 *     让 LLM 重新生成同样的 prompt，而是"知道前 Act 长什么样以保持一致"。
 */

import type { Scenario, Scene, Character, Location, Prop } from '../scenario/types'
import type { ActScenePromptTrio } from './forgePromptTrioForAct'

// ─────────────────────────────────────────────────────────────────────────────
// 已确认锚点 · LOCKED_ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把 scenario 的 characters / locations / props / uiStyle 提取成一段
 * "已确认锚点"文本，给 batch trio 当**硬约束**注入。
 *
 * 输出形如：
 *   【LOCKED ANCHORS · 作者已确认的硬约束（不可改写）】
 *   - 角色 阿楠：黑色羊毛大衣，左眉有疤，颈间银项链
 *   - 场所 老火车站：青砖月台，铁轨锈迹，远端蒸汽机车头
 *   - 道具 锈蚀火车票：泛黄硬纸，边缘卷曲，钢印 1947-03-12
 *   - UI 风格：暗黑民国手绘
 *
 * 空时返回空字符串（调用方按需 if check）。
 */
export function buildLockedAnchorsPrompt(scenario: Scenario): string {
  const blocks: string[] = []

  const charBlock = formatCharactersAnchors(scenario.characters)
  if (charBlock) blocks.push(charBlock)

  const locBlock = formatLocationsAnchors(scenario.locations)
  if (locBlock) blocks.push(locBlock)

  const propBlock = formatPropsAnchors(scenario.props)
  if (propBlock) blocks.push(propBlock)

  if (scenario.uiStyle?.prompt?.trim()) {
    blocks.push(`- UI 风格：${scenario.uiStyle.prompt.trim()}`)
  }
  if (scenario.visualStyle) {
    blocks.push(`- 视觉风格：${scenario.visualStyle}`)
  }

  if (blocks.length === 0) return ''

  return [
    '【LOCKED ANCHORS · 作者已确认的硬约束（不可改写）】',
    '严格遵守以下设定。批量产出的 image / storyboard / video 提示词中所有相关元素',
    '都必须**贴合**这些锚点；不得擅自换装、换发色、换道具、换 UI 风格。',
    '',
    ...blocks,
  ].join('\n')
}

function formatCharactersAnchors(
  characters: Record<string, Character> | undefined,
): string {
  if (!characters) return ''
  const list = Object.values(characters).filter((c) => c.prompt?.trim())
  if (list.length === 0) return ''
  // v3.10 · 锚点回流增强：
  // - aliases：让 LLM 知道剧本里"那个男人/老头/凶手"这些指代词归到同一个 character.id；
  //   写在 prompt 同一行后面用 `· 别名:` 段附加，紧凑且 LLM 能稳定 parse。
  // - anchor：是比 prompt 更短/更稳的"识别锚"（疤、口音、独有标志），单独一段，
  //   防止被生图 prompt 的视觉细节覆盖。
  // - appearanceVariants：列出本角色的所有"形态"，让 LLM 在写分镜时主动选 variant
  //   而不是把所有状态揉成一个 prompt。
  return list
    .map((c) => {
      const lines: string[] = []
      const aliasSuffix =
        c.aliases && c.aliases.length > 0
          ? ` · 别名: ${c.aliases.join(' / ')}`
          : ''
      lines.push(`- 角色 ${c.name} [${c.id}]：${c.prompt.trim()}${aliasSuffix}`)
      if (c.anchor?.trim()) {
        lines.push(`  · 识别锚: ${c.anchor.trim()}`)
      }
      if (c.appearanceVariants && c.appearanceVariants.length > 0) {
        const variants = c.appearanceVariants
          .map((v) => {
            const va =
              v.aliases && v.aliases.length > 0
                ? ` · 别名: ${v.aliases.join('/')}`
                : ''
            const desc = v.prompt?.trim() ? `：${v.prompt.trim()}` : ''
            return `    · [${v.id}] ${v.label}${desc}${va}`
          })
          .join('\n')
        lines.push(`  · 形态变体（在 shot.characterVariantIds 中按 id 选用）：\n${variants}`)
      }
      return lines.join('\n')
    })
    .join('\n')
}

function formatLocationsAnchors(
  locations: Record<string, Location> | undefined,
): string {
  if (!locations) return ''
  const list = Object.values(locations).filter((l) => l.prompt?.trim())
  if (list.length === 0) return ''
  return list.map((l) => `- 场所 ${l.name} [${l.id}]：${l.prompt.trim()}`).join('\n')
}

function formatPropsAnchors(
  props: Record<string, Prop> | undefined,
): string {
  if (!props) return ''
  const list = Object.values(props).filter((p) => p.prompt?.trim())
  if (list.length === 0) return ''
  return list
    .map((p) => {
      const lines: string[] = []
      const aliasSuffix =
        p.aliases && p.aliases.length > 0
          ? ` · 别名: ${p.aliases.join(' / ')}`
          : ''
      lines.push(`- 道具 ${p.name} [${p.id}]：${p.prompt.trim()}${aliasSuffix}`)
      if (p.anchor?.trim()) {
        lines.push(`  · 识别锚: ${p.anchor.trim()}`)
      }
      if (p.variants && p.variants.length > 0) {
        const variants = p.variants
          .map((v) => {
            const va =
              v.aliases && v.aliases.length > 0
                ? ` · 别名: ${v.aliases.join('/')}`
                : ''
            const desc = v.prompt?.trim() ? `：${v.prompt.trim()}` : ''
            return `    · [${v.id}] ${v.label}${desc}${va}`
          })
          .join('\n')
        lines.push(`  · 形态变体（在 shot.propVariantIds 中按 id 选用）：\n${variants}`)
      }
      return lines.join('\n')
    })
    .join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// PRECEDING_ACT_CONTEXT · 前 Act 摘要回流
// ─────────────────────────────────────────────────────────────────────────────

/** 单个已完成 scene 的简要摘要（一句话长度即可）。 */
export interface PrecedingSceneSummary {
  sceneId: string
  title: string
  /** 该 scene 的画面提示词首句（≤ 60 字） */
  imageGist: string
  /** 该 scene 的视频提示词首段时间码（≤ 60 字） */
  videoGist: string
}

/**
 * 把若干已成功的 scene trio 压成"前情摘要"文本，作为下一批的 PRECEDING_ACT_CONTEXT。
 *
 * 摘要原则：
 *   - 每场只取一句话长度，避免上下文爆 token
 *   - imageGist 取首段冒号/逗号前的部分（"风格 · 人物" 段最有信息量）
 *   - videoGist 取第一个时间码段
 */
export function summarizeForPrecedingContext(
  scenarioScenes: Record<string, Scene>,
  trios: ActScenePromptTrio[],
): PrecedingSceneSummary[] {
  return trios.map((t) => {
    const scene = scenarioScenes[t.sceneId]
    return {
      sceneId: t.sceneId,
      title: scene?.title ?? t.sceneId,
      imageGist: extractImageGist(t.image),
      videoGist: extractVideoGist(t.video),
    }
  })
}

/**
 * 把 PrecedingSceneSummary[] 拼成给 LLM 看的文本块。空时返回空字符串。
 *
 * 长度上限默认 12 条 —— 超过时取前 6 条（开头）+ 后 6 条（最近）以保留上下文连续感。
 */
export function buildPrecedingContextPrompt(
  summaries: PrecedingSceneSummary[],
  maxItems = 12,
): string {
  if (summaries.length === 0) return ''
  let picked: PrecedingSceneSummary[]
  if (summaries.length <= maxItems) {
    picked = summaries
  } else {
    const half = Math.floor(maxItems / 2)
    picked = [...summaries.slice(0, half), ...summaries.slice(-half)]
  }

  const lines = picked.map(
    (s, i) => `  ${String(i + 1).padStart(2, '0')}. [${s.sceneId}] ${s.title}\n      画面：${s.imageGist}\n      视频：${s.videoGist}`,
  )

  return [
    '【PRECEDING_ACT_CONTEXT · 前 Act 已落地内容（仅供一致性参考）】',
    '本批之前已成功产出的 scene 摘要（光影 / 服装 / 道具 / 节奏需与之对齐）：',
    '',
    ...lines,
  ].join('\n')
}

function extractImageGist(image: string): string {
  const trimmed = image.trim()
  if (!trimmed) return '（空）'
  // 取首句（中文逗号 / 句号 / 分号）；最长 60 字
  const m = trimmed.match(/^[^，。；,;\n]{1,60}/)
  return (m?.[0] ?? trimmed.slice(0, 60)).trim()
}

function extractVideoGist(video: string): string {
  const trimmed = video.trim()
  if (!trimmed) return '（空）'
  // 取第一个 [0-X 秒] 段；其后到换行/句号；最长 60 字
  const m = trimmed.match(/\[[\d\-\s秒]+\][^\n。]{0,80}/)
  if (m) return m[0].slice(0, 80).trim()
  return trimmed.split('\n')[0]!.slice(0, 60).trim()
}
