import { describe, it, expect } from 'vitest'
import { classifyImageForgeError } from '../imageForgeErrors'

/**
 * P4 路径错误分类的逃生口测试。
 *
 * 关心的是：每一类错误都给作者**可采取行动**的中文提示，
 * 而不是把 raw error message 直接糊到 UI 上。
 *
 * 关心三种"可识别错误 + 一条退路"的场景，加一条 unknown 兜底：
 *   1. provider 不支持 vision → 提示切 Claude / 退到 idea 模式
 *   2. 图片格式不支持（mime / data URL 坏）→ 提示重传
 *   3. forgeImageToStorySeed 入口校验失败 → 提示重传
 *   4. unknown 错误 → 透出 raw message 不吞
 */

describe('classifyImageForgeError · P4 逃生口', () => {
  it('MULTIMODAL_NOT_SUPPORTED → multimodal-unsupported · 提示切 Claude / 退到其他入口', () => {
    const report = classifyImageForgeError(
      new Error('[MULTIMODAL_NOT_SUPPORTED] GeminiProvider does not yet accept image inputs'),
    )
    expect(report.kind).toBe('multimodal-unsupported')
    expect(report.message).toMatch(/Claude/)
    expect(report.message).toMatch(/一句话想法|贴剧本/)
    // 不能把 raw 吞掉 —— 作者上报问题时还要看
    expect(report.raw).toMatch(/MULTIMODAL_NOT_SUPPORTED/)
    expect(report.message).toContain(report.raw)
  })

  it('MULTIMODAL_BAD_DATA_URL → image-invalid · 提示格式范围', () => {
    const report = classifyImageForgeError(
      new Error('[MULTIMODAL_BAD_DATA_URL] image #1 is not a base64 data URL'),
    )
    expect(report.kind).toBe('image-invalid')
    expect(report.message).toMatch(/png/)
    expect(report.message).toMatch(/jpeg/)
    expect(report.message).toMatch(/webp/)
  })

  it('MULTIMODAL_BAD_MIME → image-invalid · 提示格式范围', () => {
    const report = classifyImageForgeError(
      new Error('[MULTIMODAL_BAD_MIME] image/svg+xml not in {png,jpeg,gif,webp}'),
    )
    expect(report.kind).toBe('image-invalid')
    expect(report.message).toMatch(/png.*jpeg.*gif.*webp/)
  })

  it('IMAGE_SEED 入口校验 → image-invalid · 提示重新上传', () => {
    const report = classifyImageForgeError(
      new Error('[IMAGE_SEED] imageDataUrl 不是合法的 base64 data URL'),
    )
    expect(report.kind).toBe('image-invalid')
    expect(report.message).toMatch(/重新上传/)
  })

  it('未知错误 → unknown · 原 message 完整透传，不吞', () => {
    const report = classifyImageForgeError(
      new Error('[NET] Claude fetch failed: timeout after 30s'),
    )
    expect(report.kind).toBe('unknown')
    expect(report.message).toBe('[NET] Claude fetch failed: timeout after 30s')
    expect(report.raw).toBe('[NET] Claude fetch failed: timeout after 30s')
  })

  it('非 Error 对象（字符串、null、undefined）也能稳健处理', () => {
    expect(classifyImageForgeError('plain string err').raw).toBe('plain string err')
    expect(classifyImageForgeError(null).kind).toBe('unknown')
    expect(classifyImageForgeError(undefined).kind).toBe('unknown')
  })

  it('多个匹配关键词时，按优先级走第一条命中的分支', () => {
    // 故意构造一个同时含 NOT_SUPPORTED + BAD_MIME 的错误：vision 不支持优先
    const report = classifyImageForgeError(
      new Error('[MULTIMODAL_NOT_SUPPORTED] also has [MULTIMODAL_BAD_MIME]'),
    )
    expect(report.kind).toBe('multimodal-unsupported')
  })
})
