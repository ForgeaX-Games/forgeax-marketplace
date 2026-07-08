import { describe, it, expect } from 'vitest'
import {
  buildAuditRecord,
  serializeAuditLine,
  defaultAuditFileName,
} from '../llmAuditLog'

describe('buildAuditRecord · 纯函数', () => {
  it('填充必填字段', () => {
    const rec = buildAuditRecord({
      kind: 'text',
      provider: 'azure-openai',
      model: 'gpt-4',
      status: 'ok',
      durationMs: 1234,
      now: new Date('2026-05-07T08:30:00.000Z'),
    })
    expect(rec.at).toBe('2026-05-07T08:30:00.000Z')
    expect(rec.kind).toBe('text')
    expect(rec.provider).toBe('azure-openai')
    expect(rec.model).toBe('gpt-4')
    expect(rec.status).toBe('ok')
    expect(rec.durationMs).toBe(1234)
    expect(rec.context).toEqual({})
    expect(rec.request).toEqual({ userPromptPreview: undefined })
    expect(rec.response).toEqual({ textPreview: undefined })
  })

  it('durationMs 负值夹到 0', () => {
    const rec = buildAuditRecord({
      kind: 'text',
      provider: 'p',
      model: 'm',
      status: 'ok',
      durationMs: -5,
    })
    expect(rec.durationMs).toBe(0)
  })

  it('preview 超 200 字截断 + 加省略号', () => {
    const longPrompt = 'x'.repeat(500)
    const rec = buildAuditRecord({
      kind: 'text',
      provider: 'p',
      model: 'm',
      status: 'ok',
      durationMs: 0,
      request: { userPromptPreview: longPrompt },
    })
    expect(rec.request.userPromptPreview!.length).toBe(200)
    expect(rec.request.userPromptPreview!.endsWith('…')).toBe(true)
  })

  it('200 字以内 preview 不截断', () => {
    const rec = buildAuditRecord({
      kind: 'text',
      provider: 'p',
      model: 'm',
      status: 'ok',
      durationMs: 0,
      request: { userPromptPreview: 'hello world' },
    })
    expect(rec.request.userPromptPreview).toBe('hello world')
  })

  it('context 透传', () => {
    const rec = buildAuditRecord({
      kind: 'plan',
      provider: 'p',
      model: 'm',
      status: 'ok',
      durationMs: 0,
      context: { scenarioId: 's1', sceneId: 'sc', shotId: 'sh', stage: 'storyboard' },
    })
    expect(rec.context).toEqual({ scenarioId: 's1', sceneId: 'sc', shotId: 'sh', stage: 'storyboard' })
  })

  it('失败状态保留 error', () => {
    const rec = buildAuditRecord({
      kind: 'image',
      provider: 'p',
      model: 'm',
      status: 'fail',
      durationMs: 100,
      response: { error: 'CORS blocked' },
    })
    expect(rec.status).toBe('fail')
    expect(rec.response.error).toBe('CORS blocked')
  })
})

describe('serializeAuditLine · JSONL 行', () => {
  it('产出可解析 JSON + 末尾 \\n', () => {
    const rec = buildAuditRecord({
      kind: 'text',
      provider: 'p',
      model: 'm',
      status: 'ok',
      durationMs: 1,
      now: new Date('2026-05-07T00:00:00.000Z'),
    })
    const line = serializeAuditLine(rec)
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line.trim())).toEqual(rec)
  })

  it('特殊字符不破坏 JSON', () => {
    const rec = buildAuditRecord({
      kind: 'text',
      provider: 'p',
      model: 'm',
      status: 'ok',
      durationMs: 0,
      request: { userPromptPreview: '带\n换行和"引号"的 prompt' },
    })
    const line = serializeAuditLine(rec)
    expect(() => JSON.parse(line.trim())).not.toThrow()
  })
})

describe('defaultAuditFileName · 按天切文件', () => {
  it('格式 YYYY-MM-DD.jsonl', () => {
    const name = defaultAuditFileName(new Date('2026-05-07T12:00:00.000Z'))
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/)
  })

  it('月/日用 0 pad', () => {
    // 注意：Date 内部基于本地时区；这里只检查格式而非具体值
    const name = defaultAuditFileName(new Date(2026, 0, 5)) // 2026-01-05
    expect(name).toBe('2026-01-05.jsonl')
  })

  it('不传参用当前时间', () => {
    const name = defaultAuditFileName()
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/)
  })
})
