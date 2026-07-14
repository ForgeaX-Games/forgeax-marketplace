import { describe, it, expect } from 'vitest'
import {
  PERSONAS,
  DEFAULT_DIRECTOR_STYLE,
  resolveDirectorPersona,
  serializePersonaToPrompt,
  listDirectorStyleOptions,
  coerceDirectorStyleId,
} from '../config/directorPersonas'

describe('directorPersonas', () => {
  describe('PERSONAS 字典', () => {
    it('10 个流派（原创 slug）都存在', () => {
      expect(PERSONAS['foreknowledge-suspense']).toBeDefined()
      expect(PERSONAS['precision-noir']).toBeDefined()
      expect(PERSONAS['minimal-epic']).toBeDefined()
      expect(PERSONAS['mood-neon']).toBeDefined()
      expect(PERSONAS['luminous-anime']).toBeDefined()
      expect(PERSONAS['kinetic-clarity']).toBeDefined()
      expect(PERSONAS['cyberpunk-neonoir']).toBeDefined()
      expect(PERSONAS['unseen-horror']).toBeDefined()
      expect(PERSONAS['nonlinear-scifi']).toBeDefined()
      expect(PERSONAS['pulp-dialogue']).toBeDefined()
    })

    it('每条 persona 六段字段都非空（含新增下游绑定 / 海报）', () => {
      for (const [id, p] of Object.entries(PERSONAS)) {
        expect(p.id, `${id} id`).toBe(id)
        expect(p.displayName.length, `${id} displayName`).toBeGreaterThan(0)
        expect(p.tagline.length, `${id} tagline`).toBeGreaterThan(0)
        expect(p.identity.length, `${id} identity`).toBeGreaterThan(20)
        expect(p.editingGrammar.length, `${id} editingGrammar`).toBeGreaterThan(20)
        expect(p.cameraLanguage.length, `${id} cameraLanguage`).toBeGreaterThan(20)
        expect(p.pacing.length, `${id} pacing`).toBeGreaterThan(20)
        expect(p.downstreamBinding.length, `${id} downstreamBinding`).toBeGreaterThan(20)
        expect(p.posterPrompt.length, `${id} posterPrompt`).toBeGreaterThan(20)
      }
    })

    it('默认流派指向的 persona 存在', () => {
      expect(DEFAULT_DIRECTOR_STYLE).toBe('minimal-epic')
      expect(PERSONAS[DEFAULT_DIRECTOR_STYLE as 'minimal-epic']).toBeDefined()
    })
  })

  describe('resolveDirectorPersona', () => {
    it('给定合法 id → 返回对应 persona', () => {
      const p = resolveDirectorPersona('precision-noir')
      expect(p.id).toBe('precision-noir')
      expect(p.displayName).toBe('冷峻精算 · 克制黑色')
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
      const text = serializePersonaToPrompt(PERSONAS['foreknowledge-suspense'])
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
      const text = serializePersonaToPrompt(PERSONAS['minimal-epic'])
      expect(text).toContain('极简史诗 · 以小写大')
      expect(text).toContain('以渺小反衬宏大')
    })

    it('两次调用输出稳定（纯函数、无时间戳）', () => {
      const a = serializePersonaToPrompt(PERSONAS['luminous-anime'])
      const b = serializePersonaToPrompt(PERSONAS['luminous-anime'])
      expect(a).toBe(b)
    })

    it('含新增「下游绑定」段 + 通用「镜头调度通则」', () => {
      const text = serializePersonaToPrompt(PERSONAS['unseen-horror'])
      expect(text).toContain('下游绑定')
      expect(text).toContain('镜头调度通则')
      // 下游绑定排在节奏偏好之后
      expect(text.indexOf('下游绑定')).toBeGreaterThan(text.indexOf('**节奏偏好**'))
    })
  })

  describe('listDirectorStyleOptions', () => {
    it('返回 11 项（10 预设 + custom）', () => {
      const list = listDirectorStyleOptions()
      expect(list).toHaveLength(11)
    })

    it('首项是默认流派（极简史诗）', () => {
      const list = listDirectorStyleOptions()
      expect(list[0]?.id).toBe('minimal-epic')
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

  describe('coerceDirectorStyleId（接线：LLM 字符串 → 合法库 id）', () => {
    it('命中预设库 id → 原样返回', () => {
      expect(coerceDirectorStyleId('unseen-horror')).toBe('unseen-horror')
      expect(coerceDirectorStyleId(' nonlinear-scifi ')).toBe('nonlinear-scifi')
    })

    it('custom / 未知 / 非字符串 → undefined', () => {
      expect(coerceDirectorStyleId('custom')).toBeUndefined()
      expect(coerceDirectorStyleId('unknown-director')).toBeUndefined()
      expect(coerceDirectorStyleId('')).toBeUndefined()
      expect(coerceDirectorStyleId(undefined)).toBeUndefined()
      expect(coerceDirectorStyleId(123)).toBeUndefined()
    })
  })
})
