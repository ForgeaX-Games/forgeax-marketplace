import { describe, expect, it, vi } from 'vitest'
import { forgeCuratedScript } from '../promptForge'
import { SKILLS } from '../skills'
import type { TextClient, TextRequest } from '../types'

/**
 * forgeCuratedScript 契约测试
 *
 * 这一层我们关心的是"调用 LLM 时塞了什么"和"输出怎么 cleanup"，
 * 不关心模型生成逻辑（那是 LLM 自己的事）。
 *
 * 所以 mock TextClient 的 generate 直接返回我们想看的字符串，
 * 然后断言：
 *   1. systemPrompt = scriptCurator skill（不能错喂别的 skill）
 *   2. userPrompt 里包含了原文（用三引号包住）
 *   3. userPrompt 里包含了 hints（如果传了的话）
 *   4. cleanupCuratedMarkdown 能正确去掉 ``` 围栏 / 元话语 / 多余空行
 *   5. stats 长度计算正确，ratio 异常会抛错
 */

function mockClient(reply: string): TextClient & { lastReq: TextRequest | null } {
  const m = {
    lastReq: null as TextRequest | null,
    generate: vi.fn(async (req: TextRequest) => {
      m.lastReq = req
      return reply
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'mock-opus',
    getProviderName: () => 'mock',
  }
  return m as unknown as TextClient & { lastReq: TextRequest | null }
}

const SAMPLE_SCRIPT = `# 雨夜
## 第一幕
| 时间 | 角色 | 动作 | 台词 |
|---|---|---|---|
| 21:30 | 林深 | 站在门前 | 你来了？ |
雨更大了。`

/** 用于 cleanup 类测试的极短脚本，确保 reply 容易 ≥ 60% 守门通过 */
const TINY_SCRIPT = '# A\n\n## 1\n林深：你来了？'

/** 通用够长的合法整理稿（≥ SAMPLE_SCRIPT 60% 长度）防被 ratio 守门拦 */
const LONG_OK_REPLY = '## 第一幕\n\n21:30 — 林深站在门前。\n林深：「你来了？」\n\n阿芸推开门。\n阿芸：「我一直都在等你。」\n\n## 第二幕\n\n雨更大了。'

describe('forgeCuratedScript · 契约测试', () => {
  it('喂的是 scriptCurator skill，且原文被三引号包住', async () => {
    const client = mockClient(LONG_OK_REPLY)
    await forgeCuratedScript(client, { script: SAMPLE_SCRIPT })

    expect(client.lastReq).not.toBeNull()
    expect(client.lastReq?.systemPrompt).toBe(SKILLS.scriptCurator)
    // 原文必须出现在 userPrompt 里（三引号包围）
    expect(client.lastReq?.userPrompt).toContain('"""')
    expect(client.lastReq?.userPrompt).toContain(SAMPLE_SCRIPT)
    // 输出契约提示要求"不要 ``` 围栏"
    expect(client.lastReq?.userPrompt).toMatch(/不要.*围栏/)
  })

  it('hints 有值时塞到 userPrompt（kind + reasons）', async () => {
    const client = mockClient(LONG_OK_REPLY)
    await forgeCuratedScript(client, {
      script: SAMPLE_SCRIPT,
      hints: {
        kind: 'mixed-with-tables',
        reasons: ['含 markdown 表格', '段落均长偏短'],
      },
    })
    const u = client.lastReq?.userPrompt ?? ''
    expect(u).toContain('mixed-with-tables')
    expect(u).toContain('含 markdown 表格')
    expect(u).toContain('段落均长偏短')
  })

  it('hints 缺省也能跑（不抛错）', async () => {
    const client = mockClient(LONG_OK_REPLY)
    const res = await forgeCuratedScript(client, { script: 'a'.repeat(100) })
    expect(res.curated.length).toBeGreaterThan(0)
  })

  it('温度极低（0.2）以减少模型发挥', async () => {
    const client = mockClient(LONG_OK_REPLY)
    await forgeCuratedScript(client, { script: SAMPLE_SCRIPT })
    // skill curate 是确定性任务，不应该高温
    expect(client.lastReq?.temperature).toBeLessThanOrEqual(0.3)
  })

  it('jsonMode 必须是 false（输出是 Markdown 文本）', async () => {
    const client = mockClient(LONG_OK_REPLY)
    await forgeCuratedScript(client, { script: SAMPLE_SCRIPT })
    expect(client.lastReq?.jsonMode).toBe(false)
  })

  it('cleanup 能去掉首尾 ``` 围栏', async () => {
    const body = '## 1\n林深：你来了？\n\n阿芸：我等你。'
    const reply = '```markdown\n' + body + '\n```'
    const client = mockClient(reply)
    const res = await forgeCuratedScript(client, { script: TINY_SCRIPT })
    expect(res.curated.startsWith('```')).toBe(false)
    expect(res.curated.endsWith('```')).toBe(false)
    expect(res.curated).toContain('## 1')
    expect(res.curated).toContain('林深：你来了？')
  })

  it('cleanup 能去掉常见元话语前言', async () => {
    const body = '## 1\n雨夜，门前。\n\n## 2\n推门，警惕。'
    const reply = '以下是整理后的剧本：\n\n' + body
    const client = mockClient(reply)
    const res = await forgeCuratedScript(client, { script: TINY_SCRIPT })
    expect(res.curated.startsWith('以下是')).toBe(false)
    expect(res.curated.startsWith('## 1')).toBe(true)
  })

  it('cleanup 把 3+ 连续空行压成 2 行（保留段落分隔）', async () => {
    const reply = '## A\n\n\n\n\n林深站在门前。\n\n\n\n## B\n\n阿芸推门。'
    const client = mockClient(reply)
    const res = await forgeCuratedScript(client, { script: TINY_SCRIPT })
    // 不应再出现 3 个连续换行
    expect(res.curated).not.toMatch(/\n{3,}/)
    expect(res.curated).toContain('## A')
    expect(res.curated).toContain('## B')
  })

  it('stats 给出原文/整理后长度 + ratio', async () => {
    const reply = '## 第一幕\n\n这是一段整理后的内容，长度差不多。'
    const original = '# 第一幕\n\n这是一段整理前的内容长度差不多'
    const client = mockClient(reply)
    const res = await forgeCuratedScript(client, { script: original })
    expect(res.stats.originalLength).toBe(original.length)
    expect(res.stats.curatedLength).toBe(res.curated.length)
    expect(res.stats.ratio).toBeGreaterThan(0)
    expect(res.stats.ratio).toBeLessThan(2)
  })

  it('ratio < 0.6 视为"删了内容"，抛 [CURATE_SHRUNK] 错', async () => {
    const reply = '太短' // 极短 → ratio 远低于 0.6
    const client = mockClient(reply)
    await expect(
      forgeCuratedScript(client, { script: 'a'.repeat(500) }),
    ).rejects.toThrow(/CURATE_SHRUNK/)
  })

  it('空输入直接抛错（防止白调一次 LLM）', async () => {
    const client = mockClient('xx')
    await expect(forgeCuratedScript(client, { script: '   ' })).rejects.toThrow(/CURATE/)
    // 不应当真的调到 LLM
    expect((client.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('userPrompt 里强调"故事一字不改"的铁律措辞', async () => {
    const client = mockClient('整理稿足够长以通过 ratio 守门'.repeat(20))
    await forgeCuratedScript(client, { script: 'a'.repeat(500) })
    const u = client.lastReq?.userPrompt ?? ''
    expect(u).toContain('一字不改')
  })
})
