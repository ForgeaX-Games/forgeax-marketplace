import { describe, it, expect } from 'vitest'
import {
  pickPromptForImageModel,
  apiModelIdForImageModel,
  turnaroundVendorForImageModel,
  type PromptBundle,
} from '../promptRouter'

describe('pickPromptForImageModel', () => {
  const bundle: PromptBundle<string> = {
    gemini: '(masterpiece:1.4), fantasy hero, booru tag style',
    'gpt-image-2': 'Fantasy hero character, natural language description.',
  }

  it('按 image model 选对应 prompt', () => {
    expect(pickPromptForImageModel(bundle, 'gemini')).toBe(bundle.gemini)
    expect(pickPromptForImageModel(bundle, 'gpt-image-2')).toBe(bundle['gpt-image-2'])
  })

  it('支持任意数据类型（不止字符串）—— 比如结构化 prompt payload', () => {
    type Payload = { prompt: string; aspect: string }
    const objBundle: PromptBundle<Payload> = {
      gemini: { prompt: 'g', aspect: '3:4' },
      'gpt-image-2': { prompt: 'p', aspect: '1024x1024' },
    }
    expect(pickPromptForImageModel(objBundle, 'gpt-image-2')).toEqual({ prompt: 'p', aspect: '1024x1024' })
  })

  it('两个分支值引用独立，修改一个不污染另一个', () => {
    const g = { data: ['a'] }
    const p = { data: ['b'] }
    const b: PromptBundle<{ data: string[] }> = { gemini: g, 'gpt-image-2': p }
    expect(pickPromptForImageModel(b, 'gemini').data).toEqual(['a'])
    expect(pickPromptForImageModel(b, 'gpt-image-2').data).toEqual(['b'])
  })
})

describe('apiModelIdForImageModel', () => {
  it('gemini → gemini-3-pro-image-preview（后端 forceGemini 识别前缀）', () => {
    expect(apiModelIdForImageModel('gemini')).toBe('gemini-3-pro-image-preview')
  })

  it('gpt-image-2 → gpt-image-2（后端走 Azure 分支）', () => {
    expect(apiModelIdForImageModel('gpt-image-2')).toBe('gpt-image-2')
  })

  it('返回的字符串必须显式、不能空 —— 空串会让后端 Azure-first 分支抢到非用户选择的模型', () => {
    const geminiId = apiModelIdForImageModel('gemini')
    const gptId = apiModelIdForImageModel('gpt-image-2')
    expect(geminiId.length).toBeGreaterThan(0)
    expect(gptId.length).toBeGreaterThan(0)
  })

  it('gemini 分支的返回值必须以 "gemini" 开头——后端 startsWith("gemini") 靠这个路由', () => {
    expect(apiModelIdForImageModel('gemini').startsWith('gemini')).toBe(true)
  })

  it('gpt-image-2 分支的返回值绝不能以 "gemini" 开头—— 否则会被后端 forceGemini 误判', () => {
    expect(apiModelIdForImageModel('gpt-image-2').startsWith('gemini')).toBe(false)
  })
})

describe('turnaroundVendorForImageModel', () => {
  it('gpt-image-2 → azure-gpt-image (edits path)', () => {
    expect(turnaroundVendorForImageModel('gpt-image-2')).toBe('azure-gpt-image')
  })

  it('gemini → nano-banana', () => {
    expect(turnaroundVendorForImageModel('gemini')).toBe('nano-banana')
  })
})
