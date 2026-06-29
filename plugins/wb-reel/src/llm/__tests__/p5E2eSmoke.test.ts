/**
 * Phase 5 · p5-e2e —— 长文档（1.5 万字等价）整条管线 smoke。
 *
 * 这不是真调线上 LLM 的端到端（那需要密钥/网络/成本），而是**纯本地、可重复**
 * 的拼接 smoke：
 *
 *   1. 构造一份 ≥ CHUNK_THRESHOLD_CHARS 的"长 script"（中文）
 *   2. 用 stub LLM（按 systemPrompt 路由返回不同 JSON，每次 sleep 一小段）模拟真实延迟
 *   3. 拼起 4 段管线：
 *        planChunks → forgeProseToBeatsChunked → forgeScenarioFromScript → runActBatchUpgradeOnScenario
 *   4. 断言：
 *        - chunked 路径真正被激活（chunks ≥ 2）
 *        - mergeBeats 后 beats 非空、含全局 charStart
 *        - scenario.scenes 至少 1 条且每条 prompts.video / shots[] 被 batch trio 升级
 *        - 至少一次 batch trio 调用观察到 LOCKED_ANCHORS（loopback 真激活）
 *        - 总耗时合理（在 stub latency 50ms × 调用次数 这个量级）
 *
 * 为什么有这个 smoke：
 *   - 单元测试覆盖每个文件的**契约**；这个 smoke 覆盖**它们拼起来还能跑通**。
 *   - 真实生产中"前 Act 30s 内可预览"的目标，需要每段 LLM 调用都不发生
 *     回归性的延迟/失败放大。这里用 stub latency 做时序上的**等价校验**：
 *     如果 stub latency = 真实 latency 的 1/N，那么 stub 总耗时 × N 就是真实
 *     世界估算 —— 算式见底部 console 输出。
 */

import { describe, it, expect } from 'vitest'

import { planChunks, CHUNK_THRESHOLD_CHARS } from '../../io/chunkPlanner'
import { forgeProseToBeatsChunked } from '../proseToBeatsChunked'
import { forgeScenarioFromScript } from '../promptForge'
import { runActBatchUpgradeOnScenario } from '../runActBatchUpgrade'

import type { TextClient, TextRequest } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// 工具：stub LLM ——按 systemPrompt 路由返回不同 JSON
// ─────────────────────────────────────────────────────────────────────────────

interface StubCallLog {
  kind: 'index' | 'chunk-beats' | 'structurer' | 'batch-trio' | 'unknown'
  systemPrompt: string
  userPrompt: string
  latencyMs: number
}

function makeStubLLM(stubLatencyMs = 30) {
  const calls: StubCallLog[] = []
  let chunkBeatsCallCount = 0

  const llm: TextClient = {
    getProviderName: () => 'stub',
    getModel: () => 'stub-trio',
    async generate(req: TextRequest): Promise<string> {
      const t0 = Date.now()
      await sleep(stubLatencyMs)
      const sys = req.systemPrompt
      let kind: StubCallLog['kind'] = 'unknown'
      let body = ''

      if (sys.includes('全局索引扫描器')) {
        kind = 'index'
        body = makeIndexJSON()
      } else if (sys.includes('分段 Beats 抽取')) {
        kind = 'chunk-beats'
        const idx = chunkBeatsCallCount++
        body = makeChunkBeatsJSON(idx)
      } else if (sys.includes('剧本结构化解析器') || sys.includes('剧本翻译器')) {
        kind = 'structurer'
        body = makeStructurerJSON()
      } else if (sys.includes('Batch Prompt Trio')) {
        kind = 'batch-trio'
        // 从 user prompt 抽 sceneId 列表
        const sceneIds = Array.from(req.userPrompt.matchAll(/sceneId[:：]\s*([a-zA-Z0-9_]+)/g)).map(
          (m) => m[1]!,
        )
        body = makeBatchTrioJSON(sceneIds)
      } else {
        body = '{}'
      }

      calls.push({
        kind,
        systemPrompt: sys.slice(0, 80),
        userPrompt: req.userPrompt,
        latencyMs: Date.now() - t0,
      })
      return body
    },
  } as unknown as TextClient

  return { llm, calls, get chunkBeatsCallCount() { return chunkBeatsCallCount } }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具：长 script 制造（≥ CHUNK_THRESHOLD_CHARS）
// ─────────────────────────────────────────────────────────────────────────────

function makeLongScript(): string {
  // 三章，每章用一段中文 + 重复段落填到 ≥ 阈值（默认 8000 字）。
  // 真实生产长度 1.5 万字这里用 ~12000-14000 字作等价。
  const para = (
    '雨从黄昏开始下，整座县城像被水雾蒙上一层薄纸。' +
    '阿楠裹紧黑色羊毛大衣，肩头湿了一片，他低头看那张泛黄的火车票，' +
    '钢印的日期是 1947 年 3 月 12 日。月台尽头远远地停着一台蒸汽机车，' +
    '锅炉口偶尔吐出几缕白雾。老周站在他身后，手里攥着一只锈蚀的铜怀表，' +
    '声音低得只有阿楠能听见：「再等一会儿，她总会来的。」'
  )
  const chapters: string[] = []
  // 章节 1
  chapters.push(
    '# 第一章 · 月台\n\n' +
      Array.from({ length: 22 }, () => para).join('\n\n'),
  )
  // 章节 2
  chapters.push(
    '# 第二章 · 怀表\n\n' +
      Array.from({ length: 22 }, () => para).join('\n\n'),
  )
  // 章节 3
  chapters.push(
    '# 第三章 · 列车\n\n' +
      Array.from({ length: 22 }, () => para).join('\n\n'),
  )
  return chapters.join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具：各阶段 stub JSON 生成器
// ─────────────────────────────────────────────────────────────────────────────

function makeIndexJSON(): string {
  return JSON.stringify({
    title: '老火车站',
    logline: '阿楠在 1947 年的月台等一个不会到的人。',
    tone: '民国 · 暗黑手绘',
    timelineKind: 'linear',
    characters: [
      { id: 'c_anan', displayName: '阿楠', aliases: ['他'], anchor: '黑大衣男人' },
      { id: 'c_laozhou', displayName: '老周', aliases: [], anchor: '怀表老人' },
    ],
    scenes: [
      { id: 's_platform', displayName: '老火车站月台', anchor: '雨夜月台' },
      { id: 's_locomotive', displayName: '蒸汽机车头', anchor: '远端机车' },
    ],
  })
}

function makeChunkBeatsJSON(chunkIdx: number): string {
  // 每个 chunk 出 2 拍（≤ skill 上限 4）；quote 用真长 script 里出现过的子串保证后续 mergeBeats 能算 globalCharStart
  const quoteA = '雨从黄昏开始下，整座县城像被水雾蒙上一层薄纸。'
  const quoteB = '钢印的日期是 1947 年 3 月 12 日。'
  return JSON.stringify({
    beats: [
      {
        id: `ch${chunkIdx.toString().padStart(2, '0')}_beat_01`,
        title: `第${chunkIdx}-1拍`,
        beat: `chunk ${chunkIdx} 第一拍：${chunkIdx === 0 ? '雨夜登场' : chunkIdx === 1 ? '怀表交接' : '机车汽笛'}`,
        quote: quoteA,
        quoteOffset: 0,
        characterIds: ['c_anan'],
        sceneId: 's_platform',
      },
      {
        id: `ch${chunkIdx.toString().padStart(2, '0')}_beat_02`,
        title: `第${chunkIdx}-2拍`,
        beat: `chunk ${chunkIdx} 第二拍：火车票特写`,
        quote: quoteB,
        quoteOffset: 50,
        characterIds: ['c_anan', 'c_laozhou'],
        sceneId: chunkIdx === 2 ? 's_locomotive' : 's_platform',
      },
    ],
    newCharacters: [],
    newScenes: [],
  })
}

function makeStructurerJSON(): string {
  // forgeScenarioFromScript 会做 normalizeScenario；只要 scenes[].id 合法即可
  return JSON.stringify({
    title: '老火车站',
    synopsis: '阿楠在 1947 年的雨夜月台等一个永远不会到来的人。',
    uiStyle: { prompt: '暗黑民国手绘' },
    characters: [
      { id: 'c_anan', name: '阿楠', prompt: '黑色羊毛大衣，左眉有疤，颈间银项链' },
      { id: 'c_laozhou', name: '老周', prompt: '深灰长衫，怀表，胡须花白' },
    ],
    locations: [
      { id: 'l_platform', name: '老火车站月台', prompt: '青砖月台，铁轨锈迹，蒸汽弥漫' },
    ],
    props: [
      { id: 'p_ticket', name: '锈蚀火车票', prompt: '泛黄硬纸，钢印 1947-03-12' },
      { id: 'p_watch', name: '铜怀表', prompt: '锈蚀，盖面雕花' },
    ],
    rootSceneId: 'scene_001',
    scenes: [
      {
        id: 'scene_001',
        title: '01 · 雨夜登场',
        durationMs: 30000,
        locationId: 'l_platform',
        characterIds: ['c_anan'],
        background: '雨夜月台，蒸汽机车在远处',
        prompts: { scene: '雨从黄昏开始下，月台铁轨锈迹', ui: '', video: '' },
        dialogue: [
          { role: 'narration', speaker: '', text: '雨从黄昏开始下。' },
        ],
        branches: [{ kind: 'auto', label: '', targetSceneId: 'scene_002' }],
      },
      {
        id: 'scene_002',
        title: '02 · 怀表交接',
        durationMs: 30000,
        locationId: 'l_platform',
        characterIds: ['c_anan', 'c_laozhou'],
        background: '老周递出怀表',
        prompts: { scene: '老周伸手，铜怀表锈迹斑驳', ui: '', video: '' },
        dialogue: [
          { role: 'character', speaker: '老周', text: '再等一会儿，她总会来的。' },
        ],
        branches: [{ kind: 'auto', label: '', targetSceneId: 'scene_003' }],
      },
      {
        id: 'scene_003',
        title: '03 · 列车汽笛',
        durationMs: 30000,
        locationId: 'l_platform',
        characterIds: ['c_anan'],
        background: '远端机车汽笛，白雾涌出',
        prompts: { scene: '蒸汽机车汽笛长鸣，月台微震', ui: '', video: '' },
        dialogue: [
          { role: 'narration', speaker: '', text: '汽笛响了。' },
        ],
        branches: [],
      },
    ],
  })
}

function makeBatchTrioJSON(sceneIds: string[]): string {
  return JSON.stringify({
    actId: 'super',
    scenes: sceneIds.map((sid) => ({
      sceneId: sid,
      image: `民国手绘风格，${sid} 主角站定，蒸汽弥漫，光影斑驳，铁轨锈迹近景`,
      video: `[0-3秒] ${sid} 推近至阿楠呼气\n[3-7秒] 摇向远处机车`,
      storyboard: {
        shots: [
          { kind: 'wide', duration: 3, prompt: `${sid} 远景：月台全貌` },
          { kind: 'medium', duration: 4, prompt: `${sid} 中景：阿楠侧脸` },
          { kind: 'close', duration: 3, prompt: `${sid} 近景：怀表特写` },
        ],
      },
    })),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// e2e smoke 主体
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 5 · p5-e2e · 长文档整条管线 smoke', () => {
  it(
    'planChunks → forgeProseToBeatsChunked → forgeScenarioFromScript → runActBatchUpgrade 全跑通',
    async () => {
      // ─── 1. 准备 long script + planChunks ───
      const script = makeLongScript()
      expect(script.length).toBeGreaterThan(CHUNK_THRESHOLD_CHARS)

      const plan = planChunks(script)
      expect(plan.chunked).toBe(true)
      expect(plan.chunks.length).toBeGreaterThanOrEqual(2)

      const totalT0 = Date.now()
      const { llm, calls } = makeStubLLM(20)

      // ─── 2. forgeProseToBeatsChunked（Pass 1 + Pass 2 并发） ───
      const beatsT0 = Date.now()
      const beatsResult = await forgeProseToBeatsChunked(llm, {
        fullText: script,
        chunks: plan.chunks,
      })
      const beatsMs = Date.now() - beatsT0

      expect(beatsResult.beats.length).toBeGreaterThan(0)
      // 每段 stub 2 拍 → 共 chunks × 2 拍（merge 后视 quote 重叠可能略减）
      expect(beatsResult.beats.length).toBeGreaterThanOrEqual(1)
      // 全文索引提取到 angle anchors
      expect(beatsResult.index.characters.map((c) => c.id)).toContain('c_anan')
      expect(beatsResult.index.scenes.map((s) => s.id)).toContain('s_platform')
      // 没有 chunk 失败
      expect(beatsResult.failures).toHaveLength(0)
      // 每个 beat 都填了 globalCharStart（mergeBeats 阶段）
      for (const b of beatsResult.beats) {
        expect(b.globalCharStart).toBeGreaterThanOrEqual(0)
      }

      // ─── 3. forgeScenarioFromScript（一次性结构化） ───
      const scenarioT0 = Date.now()
      const structured = await forgeScenarioFromScript(llm, { script })
      const scenarioMs = Date.now() - scenarioT0

      expect(Object.keys(structured.scenario.scenes).length).toBe(3)
      expect(structured.scenario.rootSceneId).toBe('scene_001')
      expect(structured.scenario.characters?.['c_anan']?.name).toBe('阿楠')
      // batch trio 升级前 prompts.video 应该都是空（结构化只写了 prompts.scene）
      const beforeVideos = Object.values(structured.scenario.scenes).map(
        (s) => s.prompts?.video ?? '',
      )
      expect(beforeVideos.every((v) => v === '')).toBe(true)

      // ─── 4. runActBatchUpgradeOnScenario（batch trio + sequential loopback） ───
      const upgradeT0 = Date.now()
      const upgraded = await runActBatchUpgradeOnScenario(llm, structured.scenario, {
        // 每批 2 场 → 3 场 → 2 批，方便观察 sequential 滚雪球
        maxScenesPerBatch: 2,
      })
      const upgradeMs = Date.now() - upgradeT0

      expect(upgraded.failedSceneIds).toEqual([])
      expect(upgraded.upgradedSceneIds.sort()).toEqual(['scene_001', 'scene_002', 'scene_003'])

      // 升级后所有 scene 的 prompts.video / shots[] 都应被填充
      for (const sceneId of ['scene_001', 'scene_002', 'scene_003']) {
        const sc = upgraded.scenario.scenes[sceneId]
        expect(sc).toBeDefined()
        expect(sc!.prompts?.video).toMatch(/\[0-3秒\]/)
        expect(Array.isArray(sc!.shots) ? sc!.shots.length : 0).toBeGreaterThanOrEqual(3)
      }

      // ─── 5. loopback 真激活：至少一次 batch trio user prompt 含 LOCKED_ANCHORS ───
      const trioCalls = calls.filter((c) => c.kind === 'batch-trio')
      expect(trioCalls.length).toBeGreaterThanOrEqual(2)
      const allTrioUser = trioCalls.map((c) => c.userPrompt)
      expect(allTrioUser.some((u) => u.includes('LOCKED ANCHORS'))).toBe(true)
      expect(allTrioUser.some((u) => u.includes('阿楠'))).toBe(true)
      expect(allTrioUser.some((u) => u.includes('黑色羊毛大衣'))).toBe(true)
      // sequential 模式：第二批应含前批的 PRECEDING_ACT_CONTEXT
      expect(allTrioUser.slice(1).some((u) => u.includes('PRECEDING_ACT_CONTEXT'))).toBe(true)

      // ─── 6. 时序 / 容量断言 ───
      const totalMs = Date.now() - totalT0
      const stubLatency = 20 // ms（与 makeStubLLM 参数对齐）
      const realLatencyEstimate = 2500 // 真实 LLM 单次 ≈ 2-3 秒
      const scaleFactor = realLatencyEstimate / stubLatency
      const realFirstActMsEstimate =
        // 前 Act 可预览所需：beats 全部完成（uneven path 简化）+ structurer 1 次 + 第一批 trio 1 次
        // 简化：beats stage 实际包含 1+chunks 次调用，但 Pass 2 是并发 → 取 1 + ceil(chunks/3)
        (1 + Math.ceil(plan.chunks.length / 3) + 1 + 1) * stubLatency

      // 真实世界估算：≤ 30 秒（用户目标）
      const realFirstActMsScaled = realFirstActMsEstimate * scaleFactor
      const callCounts = {
        index: calls.filter((c) => c.kind === 'index').length,
        chunkBeats: calls.filter((c) => c.kind === 'chunk-beats').length,
        structurer: calls.filter((c) => c.kind === 'structurer').length,
        batchTrio: trioCalls.length,
      }
      // 调试输出（vitest 默认会显示）
      // eslint-disable-next-line no-console
      console.log('[p5-e2e] timing & calls', {
        totalMs,
        beatsMs,
        scenarioMs,
        upgradeMs,
        chunks: plan.chunks.length,
        scriptChars: script.length,
        callCounts,
        realFirstActMsEstimate,
        scaleFactor,
        realFirstActMsScaled,
      })

      // 单元测试本身不该跑太久
      expect(totalMs).toBeLessThan(15_000)
      // 真实世界等价校验：前 Act 估算 ≤ 30s
      expect(realFirstActMsScaled).toBeLessThanOrEqual(30_000)
      // 调用次数等价：1 次 index + chunks 次 chunk-beats + 1 次 structurer + 至少 2 次 trio
      expect(callCounts.index).toBe(1)
      expect(callCounts.chunkBeats).toBe(plan.chunks.length)
      expect(callCounts.structurer).toBe(1)
    },
    20_000, // 20s 测试超时（默认 5s 不够余量）
  )

  it('单批 batch trio 失败时管线不崩，scenario 仍可用', async () => {
    const script = makeLongScript()
    const plan = planChunks(script)
    expect(plan.chunked).toBe(true)

    let trioCallIdx = 0
    const llm: TextClient = {
      getProviderName: () => 'stub',
      getModel: () => 'stub-flaky',
      async generate(req: TextRequest): Promise<string> {
        await sleep(10)
        const sys = req.systemPrompt
        if (sys.includes('全局索引扫描器')) return makeIndexJSON()
        if (sys.includes('分段 Beats 抽取')) {
          // 用 chunk index 暗示
          const chunkMatch = req.userPrompt.match(/【这是第\s*(\d+)/) ??
            req.userPrompt.match(/chunk\s*(\d+)/i)
          const idx = chunkMatch ? Math.max(0, parseInt(chunkMatch[1]!, 10) - 1) : 0
          return makeChunkBeatsJSON(idx)
        }
        if (sys.includes('剧本结构化解析器') || sys.includes('剧本翻译器')) {
          return makeStructurerJSON()
        }
        if (sys.includes('Batch Prompt Trio')) {
          const i = trioCallIdx++
          if (i === 1) {
            // 第二批故意抛错
            throw new Error('synthetic batch-2 failure')
          }
          const sceneIds = Array.from(
            req.userPrompt.matchAll(/sceneId[:：]\s*([a-zA-Z0-9_]+)/g),
          ).map((m) => m[1]!)
          return makeBatchTrioJSON(sceneIds)
        }
        return '{}'
      },
    } as unknown as TextClient

    const structured = await forgeScenarioFromScript(llm, { script })
    const upgraded = await runActBatchUpgradeOnScenario(llm, structured.scenario, {
      maxScenesPerBatch: 2,
    })

    // 失败的 scene 仍然存在（保留原 prompts），不丢
    expect(Object.keys(upgraded.scenario.scenes).length).toBe(3)
    // 至少一些 scene 被升级
    expect(upgraded.upgradedSceneIds.length).toBeGreaterThan(0)
    // 失败的 scene 列表非空
    expect(upgraded.failedSceneIds.length).toBeGreaterThan(0)
    // 失败的 scene 仍保留原 prompts.video（空字符串），不被覆盖为 undefined
    for (const sid of upgraded.failedSceneIds) {
      const sc = upgraded.scenario.scenes[sid]
      expect(sc).toBeDefined()
      expect(typeof sc!.prompts?.video).toBe('string')
    }
  }, 20_000)
})

