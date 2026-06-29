import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForgeChatStore } from '../forgeChatStore'
import {
  abortStage,
  runStageLogline,
  runStageOutline,
  runStageStyle,
  runStageSynopsis,
} from '../runStages'
import type { TextClient, TextRequest } from '../../llm/types'

/**
 * runStages 单测 ——
 *
 * runStages 是 PR5 模块化锻造管道的"调度脊椎"：每个 runStageX 干三件事
 *   1. 进入 envelope: setPending / beginStageAttempt / setStageStatus('running')
 *   2. 调 LLM, 解析返回, setStageDraft
 *   3. 离开: setStageStatus('await-confirm') 或 'failed', clearPending
 *
 * 这套单测只断言"形状层"——
 *   - 调用了 LLM 且 systemPrompt 命中对应 skill
 *   - 解析后写入 draft 的字段对得上
 *   - 异常分支落 'failed' + 写 error
 *   - patch 模式把作者诉求带进 user prompt
 *   - upstream context (已 confirm 的 stage) 进入 user prompt
 *
 * 不验语义 (LLM 真不真讲故事), 那是 skillHygiene + 实跑.
 */

const SCN = 'scn-test'

function mockClient(replies: string[]): TextClient & { calls: TextRequest[] } {
  const m = {
    calls: [] as TextRequest[],
    generate: vi.fn(async (req: TextRequest) => {
      m.calls.push(req)
      const i = m.calls.length - 1
      if (i >= replies.length) {
        throw new Error(`mock 没有第 ${i + 1} 次 generate 的回复`)
      }
      return replies[i]
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'mock-opus',
    getProviderName: () => 'mock',
  }
  return m as unknown as TextClient & { calls: TextRequest[] }
}

function failingClient(err: Error): TextClient {
  return {
    generate: vi.fn(async () => {
      throw err
    }),
    ping: vi.fn(async () => ({ ok: false, latencyMs: 1 })),
    getModel: () => 'mock',
    getProviderName: () => 'mock',
  }
}

beforeEach(() => {
  // 把 store 重置到空, 让每个 it 干净起步
  useForgeChatStore.setState({ sessions: {} }, false)
})
afterEach(() => {
  // 关掉残余 abort, 防止跨 test 影响
  abortStage(SCN)
})

// ─── runStageStyle ───────────────────────────────────────────────────────────

describe('runStageStyle', () => {
  const goodReply = JSON.stringify({
    director: '王家卫 —— 雨夜母题贴合',
    writer: '金宇澄 —— 上海腔碎句',
    visualPreset: '90s 港片霓虹 · 偏蓝绿噪点 · 雨夜潮湿沥青',
    notes: '节奏天然慢',
  })

  it('成功路径: systemPrompt 命中 styleCurator skill, draft 写入 store, status=await-confirm', async () => {
    const llm = mockClient([goodReply])
    await runStageStyle({ scenarioId: SCN, llm, idea: '雨夜男人' })

    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0]!.systemPrompt).toMatch(/风格策展人|style/i)
    expect(llm.calls[0]!.userPrompt).toContain('雨夜男人')
    expect(llm.calls[0]!.jsonMode).toBe(true)

    const sess = useForgeChatStore.getState().getSession(SCN)
    const rec = sess.stages.records['await-style']
    expect(rec?.status).toBe('await-confirm')
    expect(rec?.draft.director).toContain('王家卫')
    expect(rec?.draft.writer).toContain('金宇澄')
    expect(rec?.draft.visualPreset).toContain('霓虹')
    expect(sess.pending).toBeNull()
  })

  it('patch 模式: instruction 进入 user prompt + 当前 draft 也进入', async () => {
    // 先放一份 await-style 的 draft 进 store, 模拟"作者已经看到一版, 想改"
    const llm1 = mockClient([goodReply])
    await runStageStyle({ scenarioId: SCN, llm: llm1, idea: '雨夜男人' })

    const llm2 = mockClient([
      JSON.stringify({
        director: '是枝裕和 —— 家庭日常派',
        writer: '朱天文',
        visualPreset: '南方老厨房 · 自然光',
      }),
    ])
    await runStageStyle({
      scenarioId: SCN,
      llm: llm2,
      instruction: '换成温馨日系家庭风',
    })
    const userPrompt = llm2.calls[0]!.userPrompt
    expect(userPrompt).toContain('温馨日系家庭风')
    expect(userPrompt).toContain('王家卫')
  })

  it('异常路径: LLM 抛错 → status=failed + error 字段写入 + pending 清空', async () => {
    const llm = failingClient(new Error('Azure 555420 内容安全拦截'))
    await runStageStyle({ scenarioId: SCN, llm, idea: 'x' })

    const sess = useForgeChatStore.getState().getSession(SCN)
    const rec = sess.stages.records['await-style']
    expect(rec?.status).toBe('failed')
    expect(rec?.error).toContain('555420')
    expect(sess.pending).toBeNull()
  })

  it('异常路径: 解析不出 JSON, 字段为 undefined 但 status 仍为 await-confirm', async () => {
    const llm = mockClient(['这不是 JSON, 是闲话'])
    await runStageStyle({ scenarioId: SCN, llm, idea: 'x' })

    const sess = useForgeChatStore.getState().getSession(SCN)
    const rec = sess.stages.records['await-style']
    expect(rec?.status).toBe('await-confirm')
    expect(rec?.draft.director).toBeUndefined()
    expect(rec?.draft.writer).toBeUndefined()
  })
})

// ─── runStageLogline ─────────────────────────────────────────────────────────

describe('runStageLogline', () => {
  const goodReply = JSON.stringify({
    text: '三年前抛下她的男人雨夜回到旧居, 想敲门道歉, 又怕屋里另有他人.',
    alternatives: ['替代 1', '替代 2', '替代 3'],
    rationale: 'why',
  })

  it('成功路径: text + alternatives 都写入 draft', async () => {
    const llm = mockClient([goodReply])
    await runStageLogline({ scenarioId: SCN, llm, idea: '雨夜归人' })

    const rec = useForgeChatStore.getState().getSession(SCN).stages.records[
      'logline'
    ]
    expect(rec?.status).toBe('await-confirm')
    expect(rec?.draft.text).toContain('雨夜')
    expect(rec?.draft.alternatives).toHaveLength(3)
    expect(llm.calls[0]!.systemPrompt).toMatch(/logline/i)
  })

  it('alternatives 缺失也不抛错', async () => {
    const llm = mockClient([JSON.stringify({ text: '简化版' })])
    await runStageLogline({ scenarioId: SCN, llm, idea: 'x' })
    const rec = useForgeChatStore.getState().getSession(SCN).stages.records[
      'logline'
    ]
    expect(rec?.draft.text).toBe('简化版')
    expect(rec?.draft.alternatives).toBeUndefined()
  })
})

// ─── runStageSynopsis / runStageOutline ─────────────────────────────────────

describe('runStageSynopsis', () => {
  it('text + beats 写入 draft', async () => {
    const llm = mockClient([
      JSON.stringify({
        text: '梗概一段话.',
        beats: ['节拍 1', '节拍 2', '节拍 3'],
        keyImage: '雨夜门口',
      }),
    ])
    await runStageSynopsis({ scenarioId: SCN, llm })
    const rec = useForgeChatStore.getState().getSession(SCN).stages.records[
      'synopsis'
    ]
    expect(rec?.status).toBe('await-confirm')
    expect(rec?.draft.text).toBe('梗概一段话.')
    expect(rec?.draft.beats).toEqual(['节拍 1', '节拍 2', '节拍 3'])
  })
})

describe('runStageOutline', () => {
  it('outline-architect 的 acts[] 字段被翻译为 chapters[] (id/title/summary)', async () => {
    const llm = mockClient([
      JSON.stringify({
        title: '雨夜归人',
        synopsis: 'x',
        tone: 'y',
        protagonist: 'z',
        acts: [
          { id: 'act_01', title: '门前', beat: '他到达' },
          { id: 'act_02', title: '门内', beat: '她出现' },
        ],
      }),
    ])
    await runStageOutline({ scenarioId: SCN, llm })
    const rec = useForgeChatStore.getState().getSession(SCN).stages.records[
      'outline'
    ]
    expect(rec?.status).toBe('await-confirm')
    expect(rec?.draft.chapters).toHaveLength(2)
    expect(rec?.draft.chapters[0]!.id).toBe('act_01')
    expect(rec?.draft.chapters[0]!.title).toBe('门前')
    expect(rec?.draft.chapters[0]!.summary).toBe('他到达')
  })

  it('upstream context: 已 confirm 的 logline 进入 user prompt', async () => {
    // 先放一份已 confirm 的 logline
    useForgeChatStore.setState({
      sessions: {
        [SCN]: {
          messages: [],
          attachments: {},
          draft: '',
          draftAttachmentIds: [],
          pending: null,
          stages: {
            current: 'outline',
            records: {
              logline: {
                kind: 'logline',
                status: 'confirmed',
                draft: { text: '雨夜归人核心冲突' },
                updatedAt: Date.now(),
                attempts: [],
              },
            },
            history: [],
          },
        },
      },
    })

    const llm = mockClient([
      JSON.stringify({
        title: 't',
        acts: [{ id: 'a1', title: 'x', beat: 'y' }],
      }),
    ])
    await runStageOutline({ scenarioId: SCN, llm })
    expect(llm.calls[0]!.userPrompt).toContain('雨夜归人核心冲突')
  })
})
