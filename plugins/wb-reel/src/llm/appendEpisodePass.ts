/**
 * appendEpisodePass —— 续写新剧集的 LLM pass。
 *
 * 输入：当前 Scenario（角色库/场所库/既有场景上下文）+ 作者对新集的描述
 * 输出：{ episode: Episode, scenes: Record<string, Scene>, newCharacters: Record<string, Character> }
 *
 * 设计要点：
 *   - 全量 characters / locations 作为 LOCKED ANCHORS 注入 prompt，保证一致性
 *   - 既有 episodes 的 synopsis 注入，让 LLM 了解前情
 *   - 返回的 scenes 带 episodeId，调用方通过 adoptForgedEpisode action 追加到 scenario
 *   - newCharacters 是 LLM 发现的新角色（不在当前 characters 里的），需要调用方 upsert
 *   - 不修改任何 store（纯函数 + 副作用外置）
 */

import type { Character, Episode, Location, Prop, Scenario, Scene } from '../scenario/types'
import type { TextClient } from './types'
import { migrateScenarioToLatest, DEFAULT_EPISODE_ID } from '../scenario/schemaMigrate'
import { ensureSceneHasShots } from '../scenario/schemaMigrate'

export interface AppendEpisodeArgs {
  /** 当前剧本（用作上下文，不会被修改） */
  scenario: Scenario
  /** 作者对新集的描述或指令，如"第二集：主角找到凶手，但发现凶手是自己" */
  hint: string
  /** 可选：作者指定的集标题，不填则 LLM 自动命名 */
  episodeTitle?: string
  /** 目标场景数量（默认 6~8） */
  sceneCount?: number
}

export interface AppendEpisodeResult {
  episode: Episode
  /** 新集所有场景（已打 episodeId） */
  scenes: Record<string, Scene>
  /** LLM 发现的全新角色（不在原 characters 里） */
  newCharacters: Record<string, Character>
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt 构建
// ─────────────────────────────────────────────────────────────────────────────

function buildAnchors(scenario: Scenario): string {
  const chars = Object.values(scenario.characters ?? {})
  const locs = Object.values(scenario.locations ?? {})
  const props = Object.values(scenario.props ?? {})

  const lines: string[] = ['## LOCKED ANCHORS（必须沿用，不可改名改 id）']
  if (chars.length > 0) {
    lines.push('\n### 角色库')
    for (const c of chars) {
      const aliases = (c.aliases ?? []).length > 0 ? `（别名: ${c.aliases!.join('/')}）` : ''
      lines.push(`- [${c.id}] ${c.name}${aliases}: ${c.prompt}`)
    }
  }
  if (locs.length > 0) {
    lines.push('\n### 场所库')
    for (const l of locs) {
      lines.push(`- [${l.id}] ${l.name}: ${l.prompt}`)
    }
  }
  if (props.length > 0) {
    lines.push('\n### 道具库')
    for (const p of props) {
      lines.push(`- [${p.id}] ${p.name}: ${p.prompt}`)
    }
  }
  return lines.join('\n')
}

function buildPreviousEpisodesSummary(scenario: Scenario): string {
  const episodes = scenario.episodes ?? []
  if (episodes.length === 0) return ''
  const sorted = [...episodes].sort((a, b) => a.order - b.order)
  const lines = ['## 前情提要（每集简介）']
  for (const ep of sorted) {
    const synopsis = ep.synopsis ?? '（暂无简介）'
    lines.push(`- **${ep.title}**（id: ${ep.id}）：${synopsis}`)
  }
  return lines.join('\n')
}

function buildCurrentSceneSummary(scenario: Scenario, episodeFilter?: string): string {
  const scenes = Object.values(scenario.scenes)
  const relevant = episodeFilter
    ? scenes.filter((s) => s.episodeId === episodeFilter || s.episodeId === DEFAULT_EPISODE_ID)
    : scenes.slice(0, 8) // 前8场供参考
  if (relevant.length === 0) return ''
  const lines = ['## 现有场景摘要（供续写参考，不要重复这些场景）']
  for (const sc of relevant) {
    lines.push(`- [${sc.id}] ${sc.title}${sc.background ? `：${sc.background.slice(0, 80)}` : ''}`)
  }
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON 解析
// ─────────────────────────────────────────────────────────────────────────────

interface LLMEpisodeOutput {
  episode: {
    id: string
    title: string
    synopsis: string
    rootSceneId: string
  }
  scenes: {
    id: string
    title: string
    background: string
    dialogue: { id: string; role: string; speaker?: string; text: string; startMs: number }[]
    branches: { id: string; kind: string; label: string; targetSceneId: string }[]
    characterIds?: string[]
    locationId?: string
    durationMs?: number
  }[]
  newCharacters?: {
    id: string
    name: string
    prompt: string
    aliases?: string[]
  }[]
}

function parseEpisodeOutput(raw: string, hint: string): LLMEpisodeOutput | null {
  // 尝试从 ```json ... ``` 或直接 JSON 提取
  const jsonMatch = raw.match(/```json\s*([\s\S]+?)\s*```/) ?? raw.match(/(\{[\s\S]+\})/)
  const jsonStr = jsonMatch?.[1] ?? jsonMatch?.[0] ?? raw
  try {
    const obj = JSON.parse(jsonStr)
    if (obj && obj.episode && Array.isArray(obj.scenes)) return obj as LLMEpisodeOutput
    return null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一位专业的互动剧本续写编剧，负责为已有剧本续写新的剧集（Episode）。

## 输出格式（严格 JSON，不添加其他内容）
\`\`\`json
{
  "episode": {
    "id": "ep-<英文小写-数字>",           // 新集唯一 id，不能与现有 id 重复
    "title": "第X集：副标题",              // 集标题
    "synopsis": "本集的一句话简介",         // ≤80字
    "rootSceneId": "sc-ep2-001"          // 本集第一个场景的 id
  },
  "scenes": [                            // 6~8 个场景
    {
      "id": "sc-ep2-001",                // 唯一 id，以 sc-ep2- 前缀
      "title": "场景标题",
      "background": "氛围/舞美速记（不念不上字幕，喂生图用）",
      "dialogue": [
        {
          "id": "dl-ep2-001-1",
          "role": "narration|character|protagonist",
          "speaker": "角色名（role=character时）",
          "text": "台词或旁白",
          "startMs": 0
        }
      ],
      "branches": [
        {
          "id": "br-ep2-001-1",
          "kind": "auto|choice|qte_pass|qte_fail",
          "label": "选项标签",
          "targetSceneId": "sc-ep2-002"  // 下一场景 id
        }
      ],
      "characterIds": ["ch-001"],        // 引用现有角色 id
      "locationId": "loc-001",           // 引用现有场所 id（可选）
      "durationMs": 8000
    }
  ],
  "newCharacters": [                     // 仅填完全新角色（不在原角色库里）
    {
      "id": "ch-new-001",
      "name": "角色名",
      "prompt": "外观描述 prompt（英文，用于生图）",
      "aliases": ["别名1"]
    }
  ]
}
\`\`\`

## 规则
- 严格沿用 LOCKED ANCHORS 中的 id 和名称，不得新创同名角色
- 新集必须在前情基础上自然演进，不重复已有场景内容
- 场景之间用 branches 连接，确保第一场景 id = episode.rootSceneId
- 如无特殊需求，最后一个场景可以设 branches=[] 表示集末（待续）
- dialogue 的 startMs 从 0 开始，每条间隔 2000ms
- background 用英文描述舞美氛围（30~80字），供生图 prompt 使用`

export async function appendEpisodePass(
  llm: TextClient,
  args: AppendEpisodeArgs,
): Promise<AppendEpisodeResult> {
  const { scenario, hint, episodeTitle, sceneCount = 7 } = args
  const lastEpIdx = (scenario.episodes?.length ?? 0) + 1

  const anchors = buildAnchors(scenario)
  const prevSummary = buildPreviousEpisodesSummary(scenario)
  const sceneSummary = buildCurrentSceneSummary(scenario)

  const userMsg = [
    prevSummary,
    anchors,
    sceneSummary,
    '',
    `## 作者指令`,
    `续写新的一集（第${lastEpIdx}集${episodeTitle ? `：${episodeTitle}` : ''}）。`,
    `场景数量目标：${sceneCount} 个。`,
    `核心情节/指令：${hint}`,
  ]
    .filter(Boolean)
    .join('\n')

  const raw = await llm.generate({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: userMsg,
    maxTokens: 6000,
    temperature: 0.85,
  })

  const parsed = parseEpisodeOutput(raw, hint)
  if (!parsed) {
    throw new Error(`[appendEpisodePass] LLM 返回无法解析的 JSON\n---\n${raw.slice(0, 400)}`)
  }

  const epId = parsed.episode.id?.trim() || `ep-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
  const episode: Episode = {
    id: epId,
    title: parsed.episode.title || episodeTitle || `第${lastEpIdx}集`,
    synopsis: parsed.episode.synopsis,
    rootSceneId: parsed.episode.rootSceneId,
    order: lastEpIdx - 1,
    createdAt: Date.now(),
  }

  // 组装 scenes
  const scenes: Record<string, Scene> = {}
  for (const sc of parsed.scenes) {
    const rawScene: Scene = {
      id: sc.id,
      title: sc.title,
      background: sc.background,
      media: { kind: 'IMAGE_PROMPT', prompt: sc.background ?? '' },
      durationMs: sc.durationMs ?? 8000,
      dialogue: (sc.dialogue ?? []).map((d) => ({
        id: d.id,
        role: d.role as Scene['dialogue'][number]['role'],
        speaker: d.speaker,
        text: d.text,
        startMs: d.startMs,
      })),
      branches: (sc.branches ?? []).map((b) => ({
        id: b.id,
        kind: b.kind as Scene['branches'][number]['kind'],
        label: b.label,
        targetSceneId: b.targetSceneId,
      })),
      characterIds: sc.characterIds,
      locationId: sc.locationId,
      episodeId: epId,
    }
    scenes[sc.id] = ensureSceneHasShots(rawScene)
  }

  // 修正 episode.rootSceneId（防止 LLM 写错）
  if (!scenes[episode.rootSceneId]) {
    const firstId = Object.keys(scenes)[0]
    if (firstId) episode.rootSceneId = firstId
  }

  // 收集新角色
  const existingCharIds = new Set(Object.keys(scenario.characters ?? {}))
  const newCharacters: Record<string, Character> = {}
  for (const nc of parsed.newCharacters ?? []) {
    if (!existingCharIds.has(nc.id)) {
      newCharacters[nc.id] = {
        id: nc.id,
        name: nc.name,
        prompt: nc.prompt,
        aliases: nc.aliases,
      }
    }
  }

  return { episode, scenes, newCharacters }
}
