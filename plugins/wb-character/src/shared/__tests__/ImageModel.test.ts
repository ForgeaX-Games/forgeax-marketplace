import { describe, it, expect } from 'vitest'
import { parseImageModelFromStorage, IMAGE_MODEL_STORAGE_KEY, type ImageModel } from '../ImageModel'

describe('parseImageModelFromStorage', () => {
  it('缺失 / 空串 时返回默认值 gemini（保持旧用户无感）', () => {
    expect(parseImageModelFromStorage(null)).toBe('gemini')
    expect(parseImageModelFromStorage('')).toBe('gemini')
    expect(parseImageModelFromStorage(undefined)).toBe('gemini')
  })

  it('识别合法值 gemini / gpt-image-2', () => {
    expect(parseImageModelFromStorage('gemini')).toBe('gemini')
    expect(parseImageModelFromStorage('gpt-image-2')).toBe('gpt-image-2')
  })

  it('遇到未知字符串回落到默认值，避免非法值污染后续 prompt 选择', () => {
    expect(parseImageModelFromStorage('nanobanana-pro')).toBe('gemini')
    expect(parseImageModelFromStorage('gpt-4o')).toBe('gemini')
    expect(parseImageModelFromStorage('junk')).toBe('gemini')
  })

  it('storage key 用独立的 namespace，不污染 character-editor:global-design', () => {
    // 显式锚定 key 名称——如果改名是 breaking change，测试必须先挂掉提醒我
    expect(IMAGE_MODEL_STORAGE_KEY).toBe('character-editor:image-model')
  })

  it('两个合法值共同构成 ImageModel 联合类型——编译期 + 运行期一致', () => {
    const allowed: ImageModel[] = ['gemini', 'gpt-image-2']
    for (const m of allowed) {
      expect(parseImageModelFromStorage(m)).toBe(m)
    }
  })
})
