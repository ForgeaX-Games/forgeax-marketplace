import { describe, expect, it, vi } from 'vitest'
import {
  forgeScenarioFromIdea,
  forgeScenarioFromScript,
  type ForgeProgress,
} from '../promptForge'
import type { TextClient, TextRequest, StreamEvent } from '../types'

/**
 * 覆盖：forgeScenarioFromIdea / forgeScenarioFromScript 的 onProgress 回调，
 * 确保 PendingBubble 能拿到
 *   1. "调用模型" / "模型输出完成" / "解析 JSON" / "构建剧情树" 这些 stage
 *   2. 流式 token 的 delta（无论 provider 支持 stream 与否，fallback 也必须发）
 */

const MINIMAL_REPLY = JSON.stringify({
  title: 'T',
  synopsis: 'S',
  uiStyle: { prompt: 'u' },
  characters: [{ id: 'char_a', name: 'A', prompt: '' }],
  rootSceneId: 's1',
  scenes: [
    {
      id: 's1',
      title: '01',
      durationMs: 1000,
      characterIds: ['char_a'],
      dialogue: [],
      prompts: { scene: '' },
      branches: [],
    },
  ],
})

function streamingMock(reply: string, chunks = 4): TextClient {
  return {
    getModel: () => 'mock',
    getProviderName: () => 'mock-stream',
    async generate(_req: TextRequest) {
      return reply
    },
    async generateStream(_req, onEvent, _signal) {
      onEvent({ type: 'open' } as StreamEvent)
      const size = Math.ceil(reply.length / chunks)
      let cumulative = ''
      for (let i = 0; i < reply.length; i += size) {
        const delta = reply.slice(i, i + size)
        cumulative += delta
        onEvent({ type: 'text', delta, cumulative } as StreamEvent)
      }
      onEvent({ type: 'done', full: reply, latencyMs: 0 } as StreamEvent)
      return reply
    },
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
  }
}

function nonStreamingMock(reply: string): TextClient {
  return {
    getModel: () => 'mock',
    getProviderName: () => 'mock-plain',
    async generate(_req: TextRequest) {
      return reply
    },
    // 刻意不实现 generateStream，验证 streamOrFallback 能顶上
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
  }
}

describe('promptForge onProgress', () => {
  it('forgeScenarioFromIdea —— streaming provider 下发出 open/text/done + stage', async () => {
    const llm = streamingMock(MINIMAL_REPLY, 3)
    const events: ForgeProgress[] = []
    await forgeScenarioFromIdea(
      llm,
      { idea: '测试想法' },
      { onProgress: (ev) => events.push(ev) },
    )

    const stageLabels = events
      .filter((e): e is Extract<ForgeProgress, { kind: 'stage' }> => e.kind === 'stage')
      .map((e) => e.label)
    expect(stageLabels).toContain('调用模型')
    expect(stageLabels).toContain('模型输出完成')
    expect(stageLabels).toContain('解析 JSON')
    expect(stageLabels).toContain('构建剧情树')

    const deltas = events.filter(
      (e): e is Extract<ForgeProgress, { kind: 'delta' }> => e.kind === 'delta',
    )
    expect(deltas.length).toBeGreaterThan(0)
    // 累积文本等于完整 reply
    const last = deltas[deltas.length - 1]!
    expect(last.cumulative).toBe(MINIMAL_REPLY)
  })

  it('forgeScenarioFromScript —— 非 streaming provider 走 fallback，也能拿到 delta（一次性全量）', async () => {
    const llm = nonStreamingMock(MINIMAL_REPLY)
    const events: ForgeProgress[] = []
    await forgeScenarioFromScript(
      llm,
      { script: '【场景 01】\n他走进门。' },
      { onProgress: (ev) => events.push(ev) },
    )

    const stages = events
      .filter((e): e is Extract<ForgeProgress, { kind: 'stage' }> => e.kind === 'stage')
      .map((e) => e.label)
    expect(stages).toContain('调用模型')
    expect(stages).toContain('模型输出完成')
    expect(stages).toContain('解析 JSON')

    const deltas = events.filter(
      (e): e is Extract<ForgeProgress, { kind: 'delta' }> => e.kind === 'delta',
    )
    // fallback 至少合成一次 delta（= 全量）
    expect(deltas.length).toBeGreaterThanOrEqual(1)
    expect(deltas[deltas.length - 1]!.cumulative).toBe(MINIMAL_REPLY)
  })

  it('不传 onProgress 也能正常运行（opts 为可选）', async () => {
    const llm = streamingMock(MINIMAL_REPLY, 2)
    await expect(
      forgeScenarioFromIdea(llm, { idea: 'x' }),
    ).resolves.toBeDefined()
  })

  // v3.9.11 回归：作者反馈"maxOutputTokens=7000 截断，已生成 8232 字符"。
  //   7000 对中文整棵剧本树 JSON（含 5 场景 + 3 角色 + 台词 + prompt）远远不够，
  //   Gemini 3.x forced-thinking 还要吞掉一部分 thought tokens。对齐
  //   forgeScenarioFromScript 的 32000 这一档。
  it('forgeScenarioFromIdea · maxTokens ≥ 32000（防整树 JSON 截断）', async () => {
    let captured: TextRequest | undefined
    const llm: TextClient = {
      getModel: () => 'mock',
      getProviderName: () => 'mock-capture',
      async generate(req: TextRequest) {
        captured = req
        return MINIMAL_REPLY
      },
      ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    }
    await forgeScenarioFromIdea(llm, { idea: '一个在末日沙漠里找可乐的偏执狂' })
    expect(captured?.maxTokens ?? 0).toBeGreaterThanOrEqual(32000)
  })
})
