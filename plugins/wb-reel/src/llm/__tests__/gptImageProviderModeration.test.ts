import { describe, it, expect } from 'vitest'
import {
  extractAzureRequestId,
  extractAuthorPromptSlice,
  getModerationContext,
  isModerationBlocked,
} from '../GptImageProvider'

/**
 * GptImageProvider 内 moderation 相关辅助函数测试。
 *
 * 这些 helper 是"错误诊断链路"的关键：Provider 抛 moderation 错时，UI
 * （ForgeWizard/BatchGenBar）凭它们决定是否展开 prompt 详情、是否把 Azure
 * request ID 画出来。跑偏会让作者看到空白错误或信息错配，所以这里的边界用例
 * （大小写、前后空格、非 UUID 字符）要覆盖到。
 */

describe('isModerationBlocked', () => {
  it('识别 moderation_blocked 响应', () => {
    expect(
      isModerationBlocked(
        400,
        '{"error":{"code":"moderation_blocked","message":"rejected by safety system"}}',
      ),
    ).toBe(true)
  })

  it('识别 safety system 文案', () => {
    expect(
      isModerationBlocked(
        400,
        '{"error":{"message":"Your request was rejected by the safety system."}}',
      ),
    ).toBe(true)
  })

  it('识别 content_policy_violation', () => {
    expect(
      isModerationBlocked(400, '{"error":{"code":"content_policy_violation"}}'),
    ).toBe(true)
  })

  it('非 400 状态不算 moderation', () => {
    expect(
      isModerationBlocked(
        429,
        '{"error":{"code":"moderation_blocked"}}',
      ),
    ).toBe(false)
  })

  it('400 但不是 moderation（例如参数错）不算', () => {
    expect(
      isModerationBlocked(
        400,
        '{"error":{"code":"invalid_parameter","message":"size is required"}}',
      ),
    ).toBe(false)
  })
})

describe('extractAzureRequestId', () => {
  it('从标准 Azure 错误消息中抽出 UUID', () => {
    const body = JSON.stringify({
      error: {
        message:
          'Your request was rejected by the safety system. If you believe this is an error, contact us at Azure support ticket and include the request ID 8170f6bd-e04d-4c6c-9c07-e19b56764cb8.',
        code: 'moderation_blocked',
      },
    })
    expect(extractAzureRequestId(body)).toBe(
      '8170f6bd-e04d-4c6c-9c07-e19b56764cb8',
    )
  })

  it('大小写不敏感，冒号/空格混合分隔也认', () => {
    const body = 'request ID: 6E5E39BE-82FA-4D56-BFE9-BCD765BAFDB4.'
    expect(extractAzureRequestId(body)?.toLowerCase()).toBe(
      '6e5e39be-82fa-4d56-bfe9-bcd765bafdb4',
    )
  })

  it('没有 UUID 时返回 undefined', () => {
    expect(extractAzureRequestId('some random error without id')).toBeUndefined()
  })

  it('UUID 格式不对（长度错）不误抓', () => {
    const body = 'request ID 1234-5678'
    expect(extractAzureRequestId(body)).toBeUndefined()
  })
})

describe('getModerationContext', () => {
  it('从带 kind=moderation_blocked 的 Error 中读出上下文', () => {
    const err = new Error('[MODERATION] blocked')
    Object.assign(err, {
      kind: 'moderation_blocked',
      prompt: 'A violent scene depicting ...',
      azureRequestId: 'abcd1234-5678-90ab-cdef-0123456789ab',
    })
    const ctx = getModerationContext(err)
    expect(ctx).toEqual({
      kind: 'moderation_blocked',
      prompt: 'A violent scene depicting ...',
      azureRequestId: 'abcd1234-5678-90ab-cdef-0123456789ab',
    })
  })

  it('没有 kind 字段时返回 undefined（例如普通 HTTP 错）', () => {
    const err = new Error('[HTTP 429] Too Many Requests')
    expect(getModerationContext(err)).toBeUndefined()
  })

  it('kind 错误（例如 network_error）时返回 undefined', () => {
    const err = new Error('[NET] timeout')
    Object.assign(err, { kind: 'network_error', prompt: 'x' })
    expect(getModerationContext(err)).toBeUndefined()
  })

  it('prompt 不是 string 时返回 undefined（防脏数据）', () => {
    const err = new Error('[MODERATION] blocked')
    Object.assign(err, { kind: 'moderation_blocked', prompt: 42 })
    expect(getModerationContext(err)).toBeUndefined()
  })

  it('azureRequestId 缺失也能正常返回', () => {
    const err = new Error('[MODERATION] blocked')
    Object.assign(err, { kind: 'moderation_blocked', prompt: 'x' })
    expect(getModerationContext(err)).toEqual({
      kind: 'moderation_blocked',
      prompt: 'x',
      azureRequestId: undefined,
      likelyStyleInteraction: undefined,
    })
  })

  it('likelyStyleInteraction=true 透传', () => {
    const err = new Error('[MODERATION] blocked')
    Object.assign(err, {
      kind: 'moderation_blocked',
      prompt: 'x',
      likelyStyleInteraction: true,
    })
    expect(getModerationContext(err)?.likelyStyleInteraction).toBe(true)
  })

  it('likelyStyleInteraction 非 boolean 时丢弃（防脏数据）', () => {
    const err = new Error('[MODERATION] blocked')
    Object.assign(err, {
      kind: 'moderation_blocked',
      prompt: 'x',
      likelyStyleInteraction: 'true',
    })
    expect(getModerationContext(err)?.likelyStyleInteraction).toBeUndefined()
  })

  it('非 Error 输入返回 undefined（null/undefined/字符串）', () => {
    expect(getModerationContext(null)).toBeUndefined()
    expect(getModerationContext(undefined)).toBeUndefined()
    expect(getModerationContext('some string')).toBeUndefined()
    expect(getModerationContext(42)).toBeUndefined()
  })
})

describe('extractAuthorPromptSlice', () => {
  it('短 prompt 原样返回，不加省略号', () => {
    const p = 'Short prompt.'
    expect(extractAuthorPromptSlice(p, 500)).toBe(p)
  })

  it('命中 Description: 锚点时从该处开始截，前缀加 …', () => {
    const visualPrefix = 'X'.repeat(600)
    const body = 'Description: 一段作者自己写的场景描述，含具体细节'
    const tail = ' Cinematic framing, high detail, no text.'
    const full = `${visualPrefix}\n${body}\n${tail}`
    const out = extractAuthorPromptSlice(full, 500)
    expect(out.startsWith('…Description:')).toBe(true)
    expect(out).toContain('一段作者自己写的场景描述')
  })

  it('多个锚点时取文本中最早出现的那个', () => {
    const prefix = 'Y'.repeat(600)
    const full = `${prefix}\nLocation: 小巷. Details: 道具说明.`
    const out = extractAuthorPromptSlice(full, 500)
    expect(out.startsWith('…Location:')).toBe(true)
    expect(out).toContain('Details:')
  })

  it('没有任何锚点时退回裸截前 N 字 + …', () => {
    const raw = 'Z'.repeat(1000)
    const out = extractAuthorPromptSlice(raw, 50)
    expect(out).toBe(`${'Z'.repeat(50)}…`)
  })

  it('锚点在开头时前缀不加 …', () => {
    const full = `Description: 从头开始的作者描述.${' filler.'.repeat(100)}`
    const out = extractAuthorPromptSlice(full, 80)
    expect(out.startsWith('…')).toBe(false)
    expect(out.startsWith('Description:')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })

  it('锚点触发但总长度未超 maxLen 时，末尾不加 …', () => {
    const full = 'Location: 小巷. Description: 雨夜、霓虹反光.'
    const out = extractAuthorPromptSlice(full, 500)
    expect(out).toBe(full)
    expect(out.endsWith('…')).toBe(false)
  })

  it('大小写不敏感地识别锚点', () => {
    const prefix = 'A'.repeat(300)
    const full = `${prefix} DESCRIPTION: author content here and more`
    const out = extractAuthorPromptSlice(full, 100)
    expect(out.startsWith('…DESCRIPTION')).toBe(true)
  })

  it('中文锚点"描述："也能命中', () => {
    const prefix = 'B'.repeat(250)
    const full = `${prefix} 描述：刀光剑影的街头打斗`
    const out = extractAuthorPromptSlice(full, 80)
    expect(out).toContain('描述：')
    expect(out).toContain('刀光剑影')
  })
})
