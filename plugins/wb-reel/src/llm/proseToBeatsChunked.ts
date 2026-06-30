/**
 * proseToBeatsChunked —— 长文档 → 全局索引 + 分段 beats 的两阶段抽取器（Phase 2）
 *
 * 总体形态：
 *   Pass 1（forgeScriptIndex）：扫一遍全文，产出极简全局索引（角色 / 场景 / logline / tone）
 *   Pass 2（forgeProseToBeatsForChunk）：每段并发抽 beats，强制使用 Pass 1 的 ID
 *   Pass 3（mergeBeatsAcrossChunks）：在客户端合并去重，输出有序 beats 数组
 *
 * 设计要点：
 *   - 任意一段失败不阻塞其他段；最终结果带 failures 列表让上游决定是否兜底
 *   - 全部走 streamOrFallback —— 与 forgeProseToBeats / forgeScriptFromOutline 对齐
 *   - 没有任何 React 依赖，纯 TS；测试用 fake LLM 即可覆盖
 *
 * 错误模型：
 *   [INDEX_PARSE]    Pass 1 JSON 解析失败
 *   [INDEX_EMPTY]    Pass 1 解析出来但 characters/scenes 全空
 *   [BEATS_CHUNK_*]  Pass 2 单段失败（带 chunkIndex，不抛到顶层）
 *   [CHUNKED_EMPTY]  全部 chunk 都失败（顶层）
 */

import { parseJSONLoose } from './parseJSONLoose'
import { SKILLS } from './skills'
import type { TextClient } from './types'
import { streamOrFallback } from './types'
import { runWithConcurrency } from './batchImageGen'
import { LLM_TEXT_BATCH_CONCURRENCY } from './concurrency'
import type { Chunk } from '../io/chunkPlanner'
import type { ForgeScenarioStreamOpts } from './promptForge'

// ============================================================================
// 1. 类型
// ============================================================================

export interface ScriptIndexCharacter {
  id: string
  displayName: string
  aliases: string[]
  anchor: string
}

export interface ScriptIndexScene {
  id: string
  displayName: string
  anchor: string
}

export interface ScriptIndex {
  title: string
  logline: string
  tone: string
  timelineKind: 'linear' | 'flashback' | 'dual_track' | 'non_linear'
  characters: ScriptIndexCharacter[]
  scenes: ScriptIndexScene[]
}

export interface ChunkedBeat {
  /** 形如 ch02_beat_01；chunkIndex 内单调递增 */
  id: string
  /** 来自哪个 chunk（0-based） */
  chunkIndex: number
  /** 4-8 字短标题 */
  title: string
  /** 30-80 字一句话节拍 */
  beat: string
  /** 原文逐字片段 */
  quote: string
  /** quote 在原 chunk 文本中的 codepoint 偏移；下游做 charStart 还原 */
  quoteOffset: number
  /** 还原到全文里的 codepoint 偏移（mergeBeatsAcrossChunks 填） */
  globalCharStart: number
  /** 引用全局索引里的角色 id */
  characterIds: string[]
  /** 引用全局索引里的场景 id；可能是空字符串 */
  sceneId: string
}

export interface ChunkBeatsResult {
  chunkIndex: number
  beats: ChunkedBeat[]
  /** 本段在 LLM 视角下出现了索引外的新角色 / 新场景；merge 阶段决定要不要并入索引 */
  newCharacters: ScriptIndexCharacter[]
  newScenes: ScriptIndexScene[]
}

export interface ChunkBeatsFailure {
  chunkIndex: number
  reason: string
}

export interface ProseToBeatsChunkedResult {
  index: ScriptIndex
  beats: ChunkedBeat[]
  /** 哪些 chunk 失败了；UI 用它做"重试 chunk N"的入口 */
  failures: ChunkBeatsFailure[]
  /** 哪些原本不在索引里、但 Pass 2 报告了的"新角色"被合并进了 index.characters */
  mergedCharacters: ScriptIndexCharacter[]
  mergedScenes: ScriptIndexScene[]
}

// ============================================================================
// 2. Pass 1 · forgeScriptIndex
// ============================================================================

export interface ForgeScriptIndexArgs {
  /** 整篇原文（trimmed） */
  fullText: string
}

export interface ForgeScriptIndexResult {
  index: ScriptIndex
  raw: string
}

/**
 * 扫一遍全文产出全局索引。
 *
 * 注意：fullText 可能很长（几十万字）。我们这里**不**对它做截断；
 * 上层 chunkPlanner 已经把长文限制在 SCRIPT_MAX_BYTES (2MB) 内，
 * 而 LLM 的输入 token 上限是 provider 自己的事（DeepSeek-128k / Claude-200k 都吃得下 2MB）。
 *
 * 温度 0.3 —— 索引不需要"创意发散"，需要"忠实登记"。
 */
export async function forgeScriptIndex(
  llm: TextClient,
  args: ForgeScriptIndexArgs,
  opts: ForgeScenarioStreamOpts = {},
): Promise<ForgeScriptIndexResult> {
  const text = args.fullText.trim()
  if (!text) {
    throw new Error('[INDEX] 输入原文为空')
  }

  const user =
    `【任务】下方 """..."""里是作者贴进来的长剧本/小说全文。\n` +
    `请按 skill 中"输出契约"返回 JSON 全局索引（characters ≤ 8，scenes ≤ 8，总和 ≤ 16）。\n\n` +
    `【作者原文】\n"""\n${text}\n"""\n\n` +
    `请按 skill 中"输出契约"返回 JSON（jsonMode 已开，外层不要 markdown 围栏）。`

  // index JSON 输出预算上限：8 角色 × 100 字 + 8 场景 × 60 字 + 元数据 ≈ 2k 字 ≈ 3k tok
  // 给到 4000，留 thinking 余量
  opts.onProgress?.({
    kind: 'stage',
    label: '调用模型',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · 全局索引 · 原文 ${text.length} 字`,
  })

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt: SKILLS.scriptIndexScanner,
      userPrompt: user,
      temperature: 0.3,
      maxTokens: 4000,
      jsonMode: true,
    },
    (ev) => {
      if (ev.type === 'text') {
        opts.onProgress?.({
          kind: 'delta',
          delta: ev.delta,
          cumulative: ev.cumulative,
        })
      } else if (ev.type === 'done') {
        opts.onProgress?.({
          kind: 'stage',
          label: '索引模型输出完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  const index = parseScriptIndexJSON(raw)
  return { index, raw }
}

export function parseScriptIndexJSON(raw: string): ScriptIndex {
  let stripped = raw.trim()
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }
  const parsed = parseJSONLoose(stripped)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      `[INDEX_PARSE] 全局索引 JSON 无法解析 · raw head=${raw.slice(0, 200)}`,
    )
  }
  const obj = parsed as Record<string, unknown>

  const charactersRaw = Array.isArray(obj.characters) ? obj.characters : []
  const scenesRaw = Array.isArray(obj.scenes) ? obj.scenes : []
  if (charactersRaw.length === 0 && scenesRaw.length === 0) {
    throw new Error(
      `[INDEX_EMPTY] 全局索引中 characters / scenes 全空 —— Pass 1 失败 · raw head=${raw.slice(0, 200)}`,
    )
  }

  const characters: ScriptIndexCharacter[] = charactersRaw.map((c, i) => {
    const co = (c ?? {}) as Record<string, unknown>
    return {
      id:
        typeof co.id === 'string' && co.id.trim()
          ? co.id.trim()
          : `char_${i + 1}`,
      displayName:
        typeof co.displayName === 'string' ? co.displayName.trim() : `角色${i + 1}`,
      aliases: Array.isArray(co.aliases)
        ? (co.aliases as unknown[])
            .filter((a): a is string => typeof a === 'string')
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
      anchor: typeof co.anchor === 'string' ? co.anchor.trim() : '原文未明示',
    }
  })

  const scenes: ScriptIndexScene[] = scenesRaw.map((s, i) => {
    const so = (s ?? {}) as Record<string, unknown>
    return {
      id:
        typeof so.id === 'string' && so.id.trim()
          ? so.id.trim()
          : `scene_${i + 1}`,
      displayName:
        typeof so.displayName === 'string' ? so.displayName.trim() : `场景${i + 1}`,
      anchor: typeof so.anchor === 'string' ? so.anchor.trim() : '原文未明示',
    }
  })

  const timelineRaw = typeof obj.timelineKind === 'string' ? obj.timelineKind : ''
  const timelineKind: ScriptIndex['timelineKind'] =
    timelineRaw === 'flashback' ||
    timelineRaw === 'dual_track' ||
    timelineRaw === 'non_linear'
      ? timelineRaw
      : 'linear'

  return {
    title: typeof obj.title === 'string' ? obj.title.trim() : '未命名',
    logline: typeof obj.logline === 'string' ? obj.logline.trim() : '',
    tone: typeof obj.tone === 'string' ? obj.tone.trim() : '原文未明示',
    timelineKind,
    characters,
    scenes,
  }
}

// ============================================================================
// 3. Pass 2 · forgeProseToBeatsForChunk
// ============================================================================

export interface ForgeChunkBeatsArgs {
  chunk: Chunk
  index: ScriptIndex
}

export async function forgeProseToBeatsForChunk(
  llm: TextClient,
  args: ForgeChunkBeatsArgs,
  opts: ForgeScenarioStreamOpts = {},
): Promise<ChunkBeatsResult> {
  const { chunk, index } = args

  const indexJsonForLLM = JSON.stringify(
    {
      logline: index.logline,
      tone: index.tone,
      timelineKind: index.timelineKind,
      characters: index.characters.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        aliases: c.aliases,
        anchor: c.anchor,
      })),
      scenes: index.scenes.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        anchor: s.anchor,
      })),
    },
    null,
    0,
  )

  const headingPathStr = chunk.headingPath.join(' / ')

  const user =
    `<global-index>${indexJsonForLLM}</global-index>\n\n` +
    `<heading-path>${headingPathStr}</heading-path>\n\n` +
    `<chunk-text>\n${chunk.text}\n</chunk-text>\n\n` +
    `chunkIndex = ${chunk.index}\n\n` +
    `请按 skill 中"输出契约"返回 JSON beats 清单（jsonMode 已开，外层不要 markdown 围栏）。\n` +
    `严格用 <global-index> 中已有的角色/场景 id；超出索引的新角色/新场景填进 newCharacters / newScenes。`

  // 单段输出预算：4 个 beat × 200 字（含 quote）≈ 1k 字 ≈ 1.5k tok；给 3000 留余量
  opts.onProgress?.({
    kind: 'stage',
    label: '调用模型',
    detail: `chunk #${chunk.index} · ${chunk.charCount} 字`,
  })

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt: SKILLS.proseToBeatsChunked,
      userPrompt: user,
      temperature: 0.3,
      maxTokens: 3000,
      jsonMode: true,
    },
    () => {
      // 单段不冒 delta（避免长文档下 UI 被刷屏）；只在外层 onChunkDone 报告
    },
    opts.signal,
  )

  return parseChunkBeatsJSON(raw, chunk)
}

export function parseChunkBeatsJSON(raw: string, chunk: Chunk): ChunkBeatsResult {
  let stripped = raw.trim()
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }
  const parsed = parseJSONLoose(stripped)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      `[BEATS_CHUNK_PARSE] chunk #${chunk.index} JSON 无法解析 · raw head=${raw.slice(0, 200)}`,
    )
  }
  const obj = parsed as Record<string, unknown>

  const beatsRaw = Array.isArray(obj.beats) ? obj.beats : []
  if (beatsRaw.length === 0) {
    throw new Error(
      `[BEATS_CHUNK_EMPTY] chunk #${chunk.index} 没抽出任何 beat`,
    )
  }
  if (beatsRaw.length > 4) {
    // 不抛错，宽容截断到 4 项（skill 已硬限 1-4，多了说明 LLM 没遵守，截掉而已）
    beatsRaw.splice(4)
  }

  const beats: ChunkedBeat[] = beatsRaw.map((b, i) => {
    const bo = (b ?? {}) as Record<string, unknown>
    const idx = i + 1
    const padIdx = idx < 10 ? `0${idx}` : String(idx)
    const padCh = chunk.index < 10 ? `0${chunk.index}` : String(chunk.index)
    const id =
      typeof bo.id === 'string' && bo.id.trim()
        ? bo.id.trim()
        : `ch${padCh}_beat_${padIdx}`
    const quote = typeof bo.quote === 'string' ? bo.quote.trim() : ''
    const quoteOffset =
      typeof bo.quoteOffset === 'number' && Number.isFinite(bo.quoteOffset)
        ? Math.max(0, Math.floor(bo.quoteOffset))
        : 0
    return {
      id,
      chunkIndex: chunk.index,
      title: typeof bo.title === 'string' ? bo.title.trim() : `第 ${idx} 拍`,
      beat: typeof bo.beat === 'string' ? bo.beat.trim() : '',
      quote,
      quoteOffset,
      globalCharStart: 0,
      characterIds: Array.isArray(bo.characterIds)
        ? (bo.characterIds as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim())
            .filter(Boolean)
        : [],
      sceneId: typeof bo.sceneId === 'string' ? bo.sceneId.trim() : '',
    }
  })

  const newCharsRaw = Array.isArray(obj.newCharacters) ? obj.newCharacters : []
  const newScenesRaw = Array.isArray(obj.newScenes) ? obj.newScenes : []

  const newCharacters: ScriptIndexCharacter[] = newCharsRaw.map((c, i) => {
    const co = (c ?? {}) as Record<string, unknown>
    return {
      id:
        typeof co.id === 'string' && co.id.trim()
          ? co.id.trim()
          : `new_char_${chunk.index}_${i + 1}`,
      displayName:
        typeof co.displayName === 'string'
          ? co.displayName.trim()
          : `新角色${i + 1}`,
      aliases: Array.isArray(co.aliases)
        ? (co.aliases as unknown[])
            .filter((a): a is string => typeof a === 'string')
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
      anchor: typeof co.anchor === 'string' ? co.anchor.trim() : '原文未明示',
    }
  })

  const newScenes: ScriptIndexScene[] = newScenesRaw.map((s, i) => {
    const so = (s ?? {}) as Record<string, unknown>
    return {
      id:
        typeof so.id === 'string' && so.id.trim()
          ? so.id.trim()
          : `new_scene_${chunk.index}_${i + 1}`,
      displayName:
        typeof so.displayName === 'string'
          ? so.displayName.trim()
          : `新场景${i + 1}`,
      anchor: typeof so.anchor === 'string' ? so.anchor.trim() : '原文未明示',
    }
  })

  return {
    chunkIndex: chunk.index,
    beats,
    newCharacters,
    newScenes,
  }
}

// ============================================================================
// 4. orchestrator + merge
// ============================================================================

export interface ForgeProseToBeatsChunkedArgs {
  /** 完整原文（trimmed） */
  fullText: string
  /** 由 chunkPlanner.planChunks 切好的段；调用方必须保证 chunked === true */
  chunks: Chunk[]
  /** 单段开始 / 完成回调（用于 UI 进度条） */
  onChunkStart?: (chunkIndex: number, totalChunks: number) => void
  onChunkDone?: (
    chunkIndex: number,
    result: ChunkBeatsResult,
    totalChunks: number,
  ) => void
  onChunkFail?: (chunkIndex: number, error: Error, totalChunks: number) => void
  /** Pass 1 完成回调（让 UI 立刻能看到角色/场景名册） */
  onIndexReady?: (index: ScriptIndex) => void
  /** 并发度，默认 LLM_TEXT_BATCH_CONCURRENCY (3) */
  concurrency?: number
  signal?: AbortSignal
}

export async function forgeProseToBeatsChunked(
  llm: TextClient,
  args: ForgeProseToBeatsChunkedArgs,
): Promise<ProseToBeatsChunkedResult> {
  const { fullText, chunks } = args
  if (!chunks || chunks.length === 0) {
    throw new Error('[CHUNKED_EMPTY] 没有可处理的 chunk')
  }

  // ---- Pass 1: 全局索引 ----
  const idxRes = await forgeScriptIndex(llm, { fullText }, { signal: args.signal })
  args.onIndexReady?.(idxRes.index)

  // ---- Pass 2: 各段并发抽 beats ----
  const concurrency = Math.max(
    1,
    args.concurrency ?? LLM_TEXT_BATCH_CONCURRENCY,
  )

  const total = chunks.length
  const chunkResults: ChunkBeatsResult[] = []
  const failures: ChunkBeatsFailure[] = []

  await runWithConcurrency(
    chunks,
    async (chunk) => {
      args.onChunkStart?.(chunk.index, total)
      try {
        const r = await forgeProseToBeatsForChunk(
          llm,
          { chunk, index: idxRes.index },
          { signal: args.signal },
        )
        chunkResults.push(r)
        args.onChunkDone?.(chunk.index, r, total)
        return r
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        failures.push({ chunkIndex: chunk.index, reason: err.message })
        args.onChunkFail?.(chunk.index, err, total)
        throw err
      }
    },
    {
      concurrency,
      ...(args.signal ? { signal: args.signal } : {}),
    },
  )

  if (chunkResults.length === 0) {
    throw new Error(
      `[CHUNKED_EMPTY] 全部 ${total} 段抽 beats 都失败了；reason=${failures
        .map((f) => `#${f.chunkIndex}: ${f.reason}`)
        .join(' | ')}`,
    )
  }

  // ---- Pass 3: 合并 ----
  const merged = mergeBeatsAcrossChunks(chunkResults, idxRes.index, chunks)

  return {
    index: merged.index,
    beats: merged.beats,
    failures,
    mergedCharacters: merged.mergedCharacters,
    mergedScenes: merged.mergedScenes,
  }
}

// ============================================================================
// 5. mergeBeatsAcrossChunks —— 跨段去重 + 还原全文偏移 + 收编新角色/场景
// ============================================================================

interface MergeOutput {
  index: ScriptIndex
  beats: ChunkedBeat[]
  mergedCharacters: ScriptIndexCharacter[]
  mergedScenes: ScriptIndexScene[]
}

/**
 * 把各 chunk 的 beats 拼起来，附带：
 *   1. 还原 globalCharStart：beat.quoteOffset + chunk.charStart
 *   2. 收编 Pass 2 报告的 newCharacters / newScenes 进 index（id 冲突时跳过）
 *   3. 跨段去重：相邻 chunk 边界处若两个 beat 的 quote 重叠 ≥ 60% 字面相似 → 合并保前者
 *   4. 按 globalCharStart 升序排序
 */
export function mergeBeatsAcrossChunks(
  chunkResults: ChunkBeatsResult[],
  index: ScriptIndex,
  chunks: Chunk[],
): MergeOutput {
  // 索引 chunk by index
  const chunkByIndex = new Map<number, Chunk>()
  for (const c of chunks) chunkByIndex.set(c.index, c)

  // ---- step 1: 收编新角色/新场景到 index ----
  const charIds = new Set(index.characters.map((c) => c.id))
  const sceneIds = new Set(index.scenes.map((s) => s.id))
  const mergedCharacters: ScriptIndexCharacter[] = []
  const mergedScenes: ScriptIndexScene[] = []

  for (const cr of chunkResults) {
    for (const c of cr.newCharacters) {
      if (!charIds.has(c.id)) {
        charIds.add(c.id)
        mergedCharacters.push(c)
      }
    }
    for (const s of cr.newScenes) {
      if (!sceneIds.has(s.id)) {
        sceneIds.add(s.id)
        mergedScenes.push(s)
      }
    }
  }

  const enrichedIndex: ScriptIndex = {
    ...index,
    characters: [...index.characters, ...mergedCharacters],
    scenes: [...index.scenes, ...mergedScenes],
  }

  // ---- step 2: 还原 globalCharStart ----
  const allBeats: ChunkedBeat[] = []
  for (const cr of chunkResults) {
    const chunk = chunkByIndex.get(cr.chunkIndex)
    if (!chunk) continue
    for (const b of cr.beats) {
      const offset =
        Number.isFinite(b.quoteOffset) && b.quoteOffset >= 0
          ? b.quoteOffset
          : findFallbackOffset(chunk.text, b.quote)
      allBeats.push({
        ...b,
        globalCharStart: chunk.charStart + offset,
      })
    }
  }

  // ---- step 3: 排序 ----
  allBeats.sort((a, b) => a.globalCharStart - b.globalCharStart)

  // ---- step 4: 跨段去重 ----
  const dedup: ChunkedBeat[] = []
  for (const beat of allBeats) {
    const last = dedup[dedup.length - 1]
    if (
      last &&
      last.chunkIndex !== beat.chunkIndex && // 同段不合并 —— 同段是 LLM 自己分的拍
      quoteOverlapRatio(last.quote, beat.quote) >= 0.6
    ) {
      // 合并：保前者，丢后者；如果后者 characterIds 更全则补到前者上
      const mergedChars = new Set([...last.characterIds, ...beat.characterIds])
      last.characterIds = [...mergedChars]
      continue
    }
    dedup.push(beat)
  }

  return {
    index: enrichedIndex,
    beats: dedup,
    mergedCharacters,
    mergedScenes,
  }
}

/**
 * 当 LLM 没给 quoteOffset（或填了 0 / 负数）时，做一次客户端兜底 search：
 * 取 quote 头 30 字在 chunk.text 里 indexOf。找不到返 0（保守值，让 sort 稳定）。
 */
function findFallbackOffset(chunkText: string, quote: string): number {
  if (!quote) return 0
  const head = quote.slice(0, 30).replace(/……/g, '')
  if (!head) return 0
  const idx = chunkText.indexOf(head)
  return idx >= 0 ? idx : 0
}

/**
 * 估算两段 quote 的"字面相似度"——用最长公共子串长度 / 较短串长度。
 *
 * 不是严谨的莱文斯坦，但对"chunk 边界处一段 quote 被切给两段，二者高度重叠"这个场景
 * 已经足够：
 *   - 重叠 60% 以上 → 我们认为是"作者同一段被两个 chunk 都抓到了"，去重一份
 *   - 完全不同的 quote → 0.0，不会误合并
 *
 * 实现上为了避免 O(n²) 在长 quote 上慢，做了 cap：超过 200 字的 quote 取头 200 字比较。
 */
export function quoteOverlapRatio(a: string, b: string): number {
  if (!a || !b) return 0
  const sa = a.replace(/[\s……]/g, '').slice(0, 200)
  const sb = b.replace(/[\s……]/g, '').slice(0, 200)
  if (!sa || !sb) return 0
  const lcs = longestCommonSubstring(sa, sb)
  const denom = Math.min(sa.length, sb.length)
  return denom === 0 ? 0 : lcs / denom
}

function longestCommonSubstring(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return 0
  // 滚动数组：prev[j] 表示 a[i-1] 与 b[j-1] 结尾的 LCS 长度
  let prev = new Array<number>(n + 1).fill(0)
  let curr = new Array<number>(n + 1).fill(0)
  let best = 0
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        curr[j] = (prev[j - 1] ?? 0) + 1
        if (curr[j]! > best) best = curr[j]!
      } else {
        curr[j] = 0
      }
    }
    const tmp = prev
    prev = curr
    curr = tmp
    curr.fill(0)
  }
  return best
}
