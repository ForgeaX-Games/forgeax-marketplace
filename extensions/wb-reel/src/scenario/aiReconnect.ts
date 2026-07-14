import type { Scenario, Scene } from './types'
import type { OrphanInfo, ReconnectPlan, ReconnectEntry } from './reconnectOrphans'

/**
 * aiReconnect —— 让 LLM 基于剧情语义给"出边为空"的场景推荐 targetSceneId。
 *
 * 为什么不是几何推断就够：
 *   - reconnectOrphans.ts 的推荐基于画布 x/y 坐标，作者拖过的布局会误导它
 *   - 作者想要的是"按故事逻辑续上"——角色、台词、场景转折
 *   - 让 Opus 吃一份紧凑摘要（而非整份 scenario），返回 id → id 映射，
 *     不改 LLM 侧的 schema、不走整树重生
 *
 * 这里只写两个纯函数：
 *   - buildReconnectPrompt(scenario, orphans)：给 LLM 的 user prompt
 *   - parseReconnectSuggestions(raw, orphanIds, sceneIds)：解析 + 白名单校验
 *
 * LLM 调用本身在 promptForge.forgeReconnectOrphans 里；对话框只调
 * forgeReconnectOrphans，结果再 patch 现有 plan。
 */

/** 每个场景塞给模型的"摘要"行 —— 尽量短但保留剧情锚点 */
export interface SceneDigest {
  id: string
  title: string
  /** 第一句非 system 台词（给模型一个"这场在讲啥"的抓手） */
  firstLine: string
  /** 出场角色名 */
  speakers: string[]
  /** 该场 outgoing branches —— 让模型知道"已有连线，不要再推" */
  outgoingTargets: string[]
  /** 是否为 rootSceneId —— 根场景绝对不作为候选 target */
  isRoot: boolean
  /** 是否为 orphan —— 断头自己也不应作为 target（避免 A→B、B→A 的环） */
  isOrphan: boolean
}

/**
 * 从 scenario 抽每个 scene 的紧凑摘要。不做任何 LLM / 网络调用。
 */
export function digestScenes(
  scenario: Scenario,
  orphanIds: Set<string>,
): SceneDigest[] {
  const scenes = Object.values(scenario.scenes)
  const digests: SceneDigest[] = []
  for (const s of scenes) {
    digests.push({
      id: s.id,
      title: (s.title ?? '').trim() || s.id,
      firstLine: pickFirstLine(s),
      speakers: pickSpeakers(s),
      // 只把"指向仍然存在 scene"的 target 告诉 LLM。野指针是 orphan 的根因，
      // 如果带进来 LLM 会误以为"这条节点已连好，不用推荐"。
      outgoingTargets: (s.branches ?? [])
        .map((b) => b.targetSceneId)
        .filter((t): t is string => !!t && !!scenario.scenes[t]),
      isRoot: s.id === scenario.rootSceneId,
      isOrphan: orphanIds.has(s.id),
    })
  }
  return digests
}

function pickFirstLine(scene: Scene): string {
  const lines = scene.dialogue ?? []
  for (const l of lines) {
    if (l.role === 'system') continue
    const t = (l.text ?? '').replace(/\s+/g, ' ').trim()
    if (t) return t.slice(0, 60)
  }
  return ''
}

function pickSpeakers(scene: Scene): string[] {
  const set = new Set<string>()
  for (const l of scene.dialogue ?? []) {
    if (l.speaker && l.speaker.trim()) set.add(l.speaker.trim())
  }
  return [...set]
}

/**
 * 构造给 LLM 的 user prompt。只依赖 scenario + orphans —— 纯函数。
 *
 * 输出格式严格要求：
 *   {
 *     "suggestions": [
 *       { "orphanId": "scene_03", "targetId": "scene_04", "reason": "…" },
 *       { "orphanId": "scene_bad_end", "targetId": null, "reason": "剧情结局" }
 *     ]
 *   }
 */
export function buildReconnectPrompt(
  scenario: Scenario,
  orphans: OrphanInfo[],
): string {
  const orphanIdSet = new Set(orphans.map((o) => o.sceneId))
  const digests = digestScenes(scenario, orphanIdSet)

  const orphanLines = orphans
    .map((o) => {
      const d = digests.find((x) => x.id === o.sceneId)
      if (!d) return `- ${o.sceneId}（标题：${o.title}）`
      const speakers = d.speakers.length ? `出场：${d.speakers.join('、')}` : '无对白'
      const firstLine = d.firstLine ? `首句："${d.firstLine}"` : '无台词'
      return `- ${d.id}（标题：${d.title}） · ${speakers} · ${firstLine}`
    })
    .join('\n')

  const sceneCatalog = digests
    .map((d) => {
      const tags: string[] = []
      if (d.isRoot) tags.push('ROOT')
      if (d.isOrphan) tags.push('ORPHAN')
      const tagStr = tags.length ? `[${tags.join(',')}] ` : ''
      const speakers = d.speakers.length ? `· 出场 ${d.speakers.join('/')}` : ''
      const firstLine = d.firstLine ? `· 首句"${d.firstLine}"` : ''
      const out =
        d.outgoingTargets.length > 0
          ? `· →[${d.outgoingTargets.join(',')}]`
          : '· 无出边'
      return `${tagStr}${d.id}："${d.title}" ${speakers} ${firstLine} ${out}`
    })
    .join('\n')

  return [
    '【任务】下面是一份互动剧本的剧情树。有若干场景"出边为空"（ORPHAN），',
    '导致玩家走到这些节点会卡住。你的任务是**基于剧情语义**，给每个 ORPHAN 推荐',
    '一个最合适的下一场场景 id；如果这个 ORPHAN 本身就是剧情结局（比如 BAD END / ',
    'GOOD END / 章节结尾），请把 targetId 设为 null。',
    '',
    '【硬性约束】',
    '- 推荐的 targetId 必须是 catalog 里**已存在**的 sceneId；不要发明新 id',
    '- 绝对不要把 ORPHAN 自己作为 targetId（不允许自环）',
    '- 绝对不要把 ROOT 作为 targetId（剧情不能绕回起点）',
    '- 如果没有合理候选、或你判断这就是一个结局，把 targetId 设为 null',
    '- 不需要解释每个候选，reason 字段限 30 字以内',
    '',
    '【ORPHAN 列表】',
    orphanLines || '（空）',
    '',
    '【剧情树节点 catalog】',
    sceneCatalog,
    '',
    '【输出契约】只输出 JSON，形如：',
    '{',
    '  "suggestions": [',
    '    { "orphanId": "<orphan 的 sceneId>", "targetId": "<target 的 sceneId 或 null>", "reason": "<≤30字>" }',
    '  ]',
    '}',
    '对每一个 ORPHAN 都必须给出一条 suggestions 条目。',
  ].join('\n')
}

// ============================================================================
// 解析与白名单校验
// ============================================================================

export interface ReconnectSuggestion {
  orphanId: string
  targetId: string | null
  reason: string
}

export interface ParseReconnectResult {
  suggestions: ReconnectSuggestion[]
  warnings: string[]
}

/**
 * 解析 LLM 输出并做三重校验：
 *   1. orphanId 必须在 orphanIds 白名单里（否则丢弃）
 *   2. targetId 不能等于 orphanId（否则归为 null）
 *   3. targetId 必须在 sceneIds 白名单里（否则归为 null）
 *
 * 容错策略：
 *   - 接受整个对象 { suggestions: [...] } 或直接数组 [...]
 *   - 忽略额外字段；缺失 reason 视为空字符串
 *   - 单条坏数据不影响其它条（只记一条 warning）
 */
export function parseReconnectSuggestions(
  raw: unknown,
  orphanIds: ReadonlySet<string>,
  sceneIds: ReadonlySet<string>,
): ParseReconnectResult {
  const warnings: string[] = []
  const out: ReconnectSuggestion[] = []

  const list = extractList(raw)
  if (!list) {
    return {
      suggestions: [],
      warnings: ['LLM 输出不是合法 JSON 或缺少 suggestions 字段'],
    }
  }

  const seenOrphans = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      warnings.push('丢弃非对象条目')
      continue
    }
    const o = item as Record<string, unknown>
    const orphanId = typeof o.orphanId === 'string' ? o.orphanId : null
    if (!orphanId) {
      warnings.push('丢弃缺少 orphanId 的条目')
      continue
    }
    if (!orphanIds.has(orphanId)) {
      warnings.push(`丢弃：${orphanId} 不在 orphan 白名单里`)
      continue
    }
    if (seenOrphans.has(orphanId)) {
      warnings.push(`重复的 orphanId=${orphanId}，保留第一条`)
      continue
    }
    seenOrphans.add(orphanId)

    let targetId: string | null = null
    const rawTarget = o.targetId
    if (typeof rawTarget === 'string' && rawTarget.trim()) {
      const tid = rawTarget.trim()
      if (tid === orphanId) {
        warnings.push(`${orphanId} 推荐自环，改为 null`)
      } else if (!sceneIds.has(tid)) {
        warnings.push(`${orphanId} 的 targetId=${tid} 不在 scene 白名单里，改为 null`)
      } else {
        targetId = tid
      }
    }

    const reason = typeof o.reason === 'string' ? o.reason.slice(0, 80) : ''
    out.push({ orphanId, targetId, reason })
  }

  return { suggestions: out, warnings }
}

function extractList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const s = (raw as Record<string, unknown>).suggestions
    if (Array.isArray(s)) return s
  }
  return null
}

// ============================================================================
// 把 suggestions 融回已有 plan —— 复用 reconnectOrphans.applyReconnectPlan
// ============================================================================

/**
 * 把 AI 返回的 suggestions 覆盖到现有 plan：
 *   - plan 里已有该 orphanId 的 entry → 覆盖 targetSceneId
 *   - plan 里没有 → 新增
 *
 * 返回新的 plan 引用；suggestions 为空则返回原 plan。
 */
export function mergeSuggestionsIntoPlan(
  plan: ReconnectPlan,
  suggestions: ReconnectSuggestion[],
): ReconnectPlan {
  if (suggestions.length === 0) return plan
  const bySid = new Map<string, ReconnectEntry>()
  for (const e of plan.entries) bySid.set(e.sceneId, { ...e })
  for (const s of suggestions) {
    bySid.set(s.orphanId, {
      sceneId: s.orphanId,
      targetSceneId: s.targetId,
    })
  }
  return { entries: [...bySid.values()] }
}
