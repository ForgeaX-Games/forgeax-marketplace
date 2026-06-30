import { describe, expect, it, vi } from 'vitest'
import { forgeImageToStorySeed } from '../promptForge'
import { SKILLS } from '../skills'
import type { TextClient, TextRequest } from '../types'

/**
 * forgeImageToStorySeed 契约测试
 *
 * 关心：
 *   1. systemPrompt = imageToStorySeed skill（不能喂错）
 *   2. userPrompt 必须包含"图像证据"约束 + 安全 / 隐私铁律
 *   3. images[] 必须把 imageDataUrl 完整透传到 TextRequest
 *   4. temperature 中等（0.5-0.8 范围内合理；当前实现是 0.7）
 *   5. jsonMode = true
 *   6. hint 传了就会进 prompt，否则不出现"作者一句话提示"
 *   7. 输出复用 parseOutlineJSON：合法 → 返回 outline；空 acts → 抛
 *      [OUTLINE_EMPTY]
 *   8. imageDataUrl 不是 data URL → 抛 [IMAGE_SEED]，不发请求
 */

function mockClient(reply: string): TextClient & { lastReq: TextRequest | null } {
  const m = {
    lastReq: null as TextRequest | null,
    generate: vi.fn(async (req: TextRequest) => {
      m.lastReq = req
      return reply
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'mock-claude',
    getProviderName: () => 'mock',
  }
  return m as unknown as TextClient & { lastReq: TextRequest | null }
}

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`

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

describe('forgeImageToStorySeed · 契约', () => {
  it('systemPrompt = imageToStorySeed skill', async () => {
    const llm = mockClient(VALID_OUTLINE_REPLY)
    await forgeImageToStorySeed(llm, { imageDataUrl: PNG_DATA_URL })
    expect(llm.lastReq?.systemPrompt).toBe(SKILLS.imageToStorySeed)
  })

  it('userPrompt 包含"图像证据"约束 + JSON 输出约束', async () => {
    const llm = mockClient(VALID_OUTLINE_REPLY)
    await forgeImageToStorySeed(llm, { imageDataUrl: PNG_DATA_URL })
    const u = llm.lastReq?.userPrompt ?? ''
    expect(u).toMatch(/图像证据/)
    expect(u).toMatch(/外观要与图像证据一致/)
    expect(u).toMatch(/jsonMode/i)
  })

  it('images 数组里塞了 imageDataUrl + label', async () => {
    const llm = mockClient(VALID_OUTLINE_REPLY)
    await forgeImageToStorySeed(llm, {
      imageDataUrl: PNG_DATA_URL,
      imageLabel: 'concept.png',
    })
    expect(llm.lastReq?.images).toHaveLength(1)
    expect(llm.lastReq?.images?.[0]?.dataUrl).toBe(PNG_DATA_URL)
    expect(llm.lastReq?.images?.[0]?.label).toBe('concept.png')
  })

  it('temperature 在 0.5-0.8 之间（看图后顺势创作的中间档）', async () => {
    const llm = mockClient(VALID_OUTLINE_REPLY)
    await forgeImageToStorySeed(llm, { imageDataUrl: PNG_DATA_URL })
    const t = llm.lastReq?.temperature ?? -1
    expect(t).toBeGreaterThanOrEqual(0.5)
    expect(t).toBeLessThanOrEqual(0.8)
  })

  it('jsonMode = true', async () => {
    const llm = mockClient(VALID_OUTLINE_REPLY)
    await forgeImageToStorySeed(llm, { imageDataUrl: PNG_DATA_URL })
    expect(llm.lastReq?.jsonMode).toBe(true)
  })

  it('hint 传了 → 进 prompt；不传 → 不出现"作者一句话提示"段', async () => {
    const llm1 = mockClient(VALID_OUTLINE_REPLY)
    await forgeImageToStorySeed(llm1, {
      imageDataUrl: PNG_DATA_URL,
      hint: '我想要赛博朋克风格',
    })
    expect(llm1.lastReq?.userPrompt).toMatch(/作者一句话提示/)
    expect(llm1.lastReq?.userPrompt).toMatch(/赛博朋克风格/)

    const llm2 = mockClient(VALID_OUTLINE_REPLY)
    await forgeImageToStorySeed(llm2, { imageDataUrl: PNG_DATA_URL })
    expect(llm2.lastReq?.userPrompt).not.toMatch(/作者一句话提示/)
  })

  it('合法返回 → outline 形态正确（与 Outline 兼容）', async () => {
    const llm = mockClient(VALID_OUTLINE_REPLY)
    const { outline } = await forgeImageToStorySeed(llm, { imageDataUrl: PNG_DATA_URL })
    expect(outline.title).toBe('雨夜归人')
    expect(outline.acts).toHaveLength(3)
    expect(outline.acts[0]?.id).toBe('act_01')
    expect(outline.tone).toMatch(/港片|霓虹/)
    expect(outline.protagonist).toMatch(/灰风衣|左眼疤/)
  })

  it('imageDataUrl 不是 data URL → 抛 [IMAGE_SEED]，不发请求', async () => {
    const llm = mockClient(VALID_OUTLINE_REPLY)
    await expect(
      forgeImageToStorySeed(llm, { imageDataUrl: 'https://x.com/a.png' }),
    ).rejects.toThrow(/IMAGE_SEED/)
    expect(llm.lastReq).toBeNull()
  })

  it('LLM 返回空 acts → 抛 [OUTLINE_EMPTY]（复用 parseOutlineJSON）', async () => {
    const llm = mockClient(
      JSON.stringify({
        title: '空',
        synopsis: 's',
        tone: 't',
        protagonist: 'p',
        acts: [],
      }),
    )
    await expect(
      forgeImageToStorySeed(llm, { imageDataUrl: PNG_DATA_URL }),
    ).rejects.toThrow(/OUTLINE_EMPTY/)
  })

  it('LLM 返回非 JSON → 抛 [OUTLINE_PARSE]', async () => {
    const llm = mockClient('这不是 JSON，是普通文本。')
    await expect(
      forgeImageToStorySeed(llm, { imageDataUrl: PNG_DATA_URL }),
    ).rejects.toThrow(/OUTLINE_PARSE/)
  })

  it('保留 markdown 围栏的返回也能被解析', async () => {
    const llm = mockClient('```json\n' + VALID_OUTLINE_REPLY + '\n```')
    const { outline } = await forgeImageToStorySeed(llm, { imageDataUrl: PNG_DATA_URL })
    expect(outline.acts).toHaveLength(3)
  })
})
