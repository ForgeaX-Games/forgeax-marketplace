import { describe, it, expect } from 'vitest'
import {
  PERSONAS,
  DEFAULT_DIRECTOR_STYLE,
  resolveDirectorPersona,
  serializePersonaToPrompt,
  listDirectorStyleOptions,
} from '../directorPersonas'

describe('directorPersonas', () => {
  describe('PERSONAS 字典', () => {
    it('7 个经典流派都存在', () => {
      expect(PERSONAS['hitchcock-suspense']).toBeDefined()
      expect(PERSONAS['fincher-noir']).toBeDefined()
      expect(PERSONAS['villeneuve-epic']).toBeDefined()
      expect(PERSONAS['wong-karwai']).toBeDefined()
      expect(PERSONAS['shinkai-anime']).toBeDefined()
      expect(PERSONAS['miller-kinetic']).toBeDefined()
      expect(PERSONAS['cyberpunk-neonoir']).toBeDefined()
    })

    it('每条 persona 四段字段都非空', () => {
      for (const [id, p] of Object.entries(PERSONAS)) {
        expect(p.id, `${id} id`).toBe(id)
        expect(p.displayName.length, `${id} displayName`).toBeGreaterThan(0)
        expect(p.tagline.length, `${id} tagline`).toBeGreaterThan(0)
        expect(p.identity.length, `${id} identity`).toBeGreaterThan(20)
        expect(p.editingGrammar.length, `${id} editingGrammar`).toBeGreaterThan(20)
        expect(p.cameraLanguage.length, `${id} cameraLanguage`).toBeGreaterThan(20)
        expect(p.pacing.length, `${id} pacing`).toBeGreaterThan(20)
      }
    })

    it('默认流派指向的 persona 存在', () => {
      expect(DEFAULT_DIRECTOR_STYLE).toBe('villeneuve-epic')
      expect(PERSONAS[DEFAULT_DIRECTOR_STYLE as 'villeneuve-epic']).toBeDefined()
    })
  })

  describe('resolveDirectorPersona', () => {
    it('给定合法 id → 返回对应 persona', () => {
      const p = resolveDirectorPersona('fincher-noir')
      expect(p.id).toBe('fincher-noir')
      expect(p.displayName).toBe('芬奇 · 黑色惊悚')
    })

    it('id 未定义 → 回退 default', () => {
      const p = resolveDirectorPersona(undefined)
      expect(p.id).toBe(DEFAULT_DIRECTOR_STYLE)
    })

    it('id 为 custom 且有 custom 文本 → 返回 custom persona 且 identity = 自定义文本', () => {
      const customText = '我是专门做默片致敬的复古导演，所有镜头都用黑白胶片、慢速对焦'
      const p = resolveDirectorPersona('custom', customText)
      expect(p.id).toBe('custom')
      expect(p.identity).toBe(customText)
    })

    it('id 为 custom 但 custom 文本为空 → 回退 default（不返回空 persona）', () => {
      const p = resolveDirectorPersona('custom', '   ')
      expect(p.id).toBe(DEFAULT_DIRECTOR_STYLE)
    })

    it('id 为 custom 但 custom 文本未传 → 回退 default', () => {
      const p = resolveDirectorPersona('custom')
      expect(p.id).toBe(DEFAULT_DIRECTOR_STYLE)
    })
  })

  describe('serializePersonaToPrompt', () => {
    it('输出 4 段固定标题（身份/剪辑语法/镜头语言/节奏偏好），顺序稳定', () => {
      const text = serializePersonaToPrompt(PERSONAS['hitchcock-suspense'])
      const idxIdentity = text.indexOf('**身份**')
      const idxGrammar = text.indexOf('**剪辑语法**')
      const idxCamera = text.indexOf('**镜头语言**')
      const idxPacing = text.indexOf('**节奏偏好**')
      expect(idxIdentity).toBeGreaterThanOrEqual(0)
      expect(idxGrammar).toBeGreaterThan(idxIdentity)
      expect(idxCamera).toBeGreaterThan(idxGrammar)
      expect(idxPacing).toBeGreaterThan(idxCamera)
    })

    it('header 含 displayName 和 tagline', () => {
      const text = serializePersonaToPrompt(PERSONAS['villeneuve-epic'])
      expect(text).toContain('维伦纽瓦 · 史诗')
      expect(text).toContain('超广角建立镜')
    })

    it('两次调用输出稳定（纯函数、无时间戳）', () => {
      const a = serializePersonaToPrompt(PERSONAS['shinkai-anime'])
      const b = serializePersonaToPrompt(PERSONAS['shinkai-anime'])
      expect(a).toBe(b)
    })
  })

  describe('listDirectorStyleOptions', () => {
    it('返回 8 项（7 预设 + custom）', () => {
      const list = listDirectorStyleOptions()
      expect(list).toHaveLength(8)
    })

    it('首项是默认流派（维伦纽瓦）', () => {
      const list = listDirectorStyleOptions()
      expect(list[0]?.id).toBe('villeneuve-epic')
    })

    it('末项是 custom', () => {
      const list = listDirectorStyleOptions()
      expect(list[list.length - 1]?.id).toBe('custom')
    })

    it('每项都有 displayName 和 tagline', () => {
      const list = listDirectorStyleOptions()
      for (const opt of list) {
        expect(opt.displayName.length).toBeGreaterThan(0)
        expect(opt.tagline.length).toBeGreaterThan(0)
      }
    })
  })
})
