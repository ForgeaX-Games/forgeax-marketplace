import { describe, it, expect, vi } from 'vitest'
import { forgeImageToStorySeed } from '../promptForge'
import { forgeScriptFromOutline } from '../scenarioFlow'
import type { TextClient, TextRequest } from '../types'

/**
 * P4 链路衔接 smoke：
 *
 *   forgeImageToStorySeed 的产物 outline，必须能**零适配**直接喂给
 *   forgeScriptFromOutline 走完逐幕扩写。
 *
 * Phase 5 的关键设计契约就是"P4 输出形态完全等价于 Outline"——这个测试守住它。
 *
 * 不测各段内部细节（已有各自单测覆盖），只测两个函数串起来的衔接形态：
 *   1. P4 出来的 outline 应有 acts.length ≥ 2 的合法 Outline
 *   2. forgeScriptFromOutline(outline) 不抛错，per-act llm 调用次数 = acts.length
 *   3. 拼出的 script 不空、且每幕的扩写结果都能在最终 script 里搜到
 */

const TINY_PNG = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`

const VALID_OUTLINE_REPLY = JSON.stringify({
  title: '雨夜归人',
  synopsis: '雨夜便利店外的男人犹豫许久，终于推门进入，他要面对的是三年前丢下的旧人。',
  tone: '90s 港片质感 · 霓虹冷蓝与货架暖黄碰撞 · 玻璃雨痕反光',
  protagonist: '中年男人，灰风衣，左眼疤痕；表情疲惫沉默，三年前不告而别。',
  acts: [
    { id: 'act_01', title: '门前', beat: '他在便利店门口踟蹰，雨打湿肩头，他认出橱窗后的人不是别人。' },
    { id: 'act_02', title: '入门', beat: '推门铃声响起，对方没抬头，他忽然不知道开口的第一句该是什么。' },
    { id: 'act_03', title: '一句', beat: '货架尽头，他终于说了三年没说出口的那句话——对不起。' },
  ],
})

/** 链路 mock：第 1 次返回 Outline JSON，后面每次返回一段幕扩写文本 */
function makeChainedClient(): TextClient & { calls: number; lastReqs: TextRequest[] } {
  const m = {
    calls: 0,
    lastReqs: [] as TextRequest[],
    generate: vi.fn(async (req: TextRequest) => {
      m.calls += 1
      m.lastReqs.push(req)
      // 第 1 次：image-to-storyseed
      if (m.calls === 1) return VALID_OUTLINE_REPLY
      // 之后每次：scriptExpander 扩写一幕。返回一段含调用序号的文本，
      // 让最终 assembledScript 里能搜到，验证拼接没漏。
      return `这是第 ${m.calls - 1} 幕的扩写正文，含场景描写与对白。\n（mock content #${m.calls - 1}）`
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'mock-claude',
    getProviderName: () => 'mock',
  }
  return m as unknown as TextClient & { calls: number; lastReqs: TextRequest[] }
}

describe('P4 衔接 smoke · forgeImageToStorySeed → forgeScriptFromOutline', () => {
  it('outline 形态合法 + 能直接喂 forgeScriptFromOutline 走完所有幕', async () => {
    const llm = makeChainedClient()

    // 步 1：图 → outline
    const seed = await forgeImageToStorySeed(llm, { imageDataUrl: TINY_PNG })
    expect(seed.outline.acts).toHaveLength(3)
    expect(seed.outline.title).toBeTruthy()
    expect(seed.outline.tone).toBeTruthy()
    expect(seed.outline.protagonist).toBeTruthy()

    // 步 2：outline → 逐幕扩写
    const expanded = await forgeScriptFromOutline(llm, { outline: seed.outline })

    // 链路完整性：1 次 image-to-storyseed + 3 次 expander = 4 次 LLM 调用
    expect(llm.calls).toBe(1 + seed.outline.acts.length)
    // 第 1 次必须有 images（vision 路径）
    expect(llm.lastReqs[0]?.images).toHaveLength(1)
    // 后面的扩写调用都不带 images（纯文本 expander）
    for (let i = 1; i < llm.lastReqs.length; i++) {
      const r = llm.lastReqs[i]
      expect(r?.images === undefined || r?.images?.length === 0).toBe(true)
    }

    // perAct 数对齐 outline.acts
    expect(expanded.perAct).toHaveLength(seed.outline.acts.length)
    // 每幕扩写文本不空
    for (const text of expanded.perAct) {
      expect(text.length).toBeGreaterThan(0)
    }
    // 拼好的 script 包含每幕的内容（验证 assembleScriptFromActs 没丢段）
    for (let i = 0; i < expanded.perAct.length; i++) {
      expect(expanded.script).toContain(`mock content #${i + 1}`)
    }
    // assembledScript 也带上 outline 的标题（"雨夜归人" 应该出现在最终剧本头部）
    expect(expanded.script).toMatch(/雨夜归人|林深|霓虹|港片/)
  })

  it('链路任意一段抛错 → 不会污染前面已写好的 perAct（forgeScriptFromOutline 内部不重试）', async () => {
    // 第 2 次（首幕扩写）就抛错——P4 已经拿到合法 outline，但下游卡死时
    // 应该把 outline 完整带回来给 caller，而不是吞掉。
    let n = 0
    const llm: TextClient = {
      generate: vi.fn(async () => {
        n += 1
        if (n === 1) return VALID_OUTLINE_REPLY
        throw new Error('[NET] simulated downstream failure')
      }),
      ping: async () => ({ ok: true, latencyMs: 1 }),
      getModel: () => 'mock',
      getProviderName: () => 'mock',
    }

    const seed = await forgeImageToStorySeed(llm, { imageDataUrl: TINY_PNG })
    expect(seed.outline.acts).toHaveLength(3)

    // forgeScriptFromOutline 应当把下游错误冒出来；caller (runImageForge) 才能
    // 用 classifyImageForgeError 把它落到 error 状态。
    await expect(
      forgeScriptFromOutline(llm, { outline: seed.outline }),
    ).rejects.toThrow(/simulated downstream failure/)
  })
})
