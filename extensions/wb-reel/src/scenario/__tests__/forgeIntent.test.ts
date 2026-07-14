import { describe, expect, it } from 'vitest'
import {
  inferAdoptMode,
  isBuiltinDemo,
  isPristineBlankScenario,
} from '../forgeIntent'
import { getDemoScenario } from '../demoScenario'
import { makeBlankScenario } from '../blankScenario'
import type { Scenario } from '../types'

describe('forgeIntent', () => {
  describe('isBuiltinDemo', () => {
    it('内置雨夜 demo 命中', () => {
      expect(isBuiltinDemo(getDemoScenario())).toBe(true)
    })

    it('id 对但 title 不对 → 视为已被用户改过 / 占用', () => {
      const sc = { ...getDemoScenario(), title: '我的故事' }
      expect(isBuiltinDemo(sc)).toBe(false)
    })

    it('title 对但 id 不对 → 不是 demo', () => {
      const sc = { ...getDemoScenario(), id: 'scn-other' }
      expect(isBuiltinDemo(sc)).toBe(false)
    })

    it('完全无关剧本不命中', () => {
      const sc = makeBlankScenario({ now: 12345 })
      expect(isBuiltinDemo(sc)).toBe(false)
    })
  })

  describe('isPristineBlankScenario', () => {
    it('makeBlankScenario 产物命中', () => {
      const sc = makeBlankScenario({ now: 99999 })
      expect(isPristineBlankScenario(sc)).toBe(true)
    })

    it('多于一个 scene → 不算 pristine', () => {
      const blank = makeBlankScenario({ now: 99999 })
      const sc: Scenario = {
        ...blank,
        scenes: {
          ...blank.scenes,
          'sc-extra': {
            ...blank.scenes[blank.rootSceneId]!,
            id: 'sc-extra',
          },
        },
      }
      expect(isPristineBlankScenario(sc)).toBe(false)
    })

    it('唯一 scene 已写过对话 → 不算 pristine', () => {
      const blank = makeBlankScenario({ now: 99999 })
      const root = blank.scenes[blank.rootSceneId]!
      const sc: Scenario = {
        ...blank,
        scenes: {
          [blank.rootSceneId]: {
            ...root,
            dialogue: [
              { id: 'd1', role: 'narration', text: 'hi', startMs: 0 },
            ],
          },
        },
      }
      expect(isPristineBlankScenario(sc)).toBe(false)
    })

    it('已写角色 → 不算 pristine', () => {
      const blank = makeBlankScenario({ now: 99999 })
      const sc: Scenario = {
        ...blank,
        characters: {
          ch1: { id: 'ch1', name: '甲', prompt: '' },
        },
      }
      expect(isPristineBlankScenario(sc)).toBe(false)
    })

    it('内置雨夜 demo 不算 pristine (有内容)', () => {
      expect(isPristineBlankScenario(getDemoScenario())).toBe(false)
    })
  })

  describe('inferAdoptMode', () => {
    it('内置 demo → create-new', () => {
      expect(inferAdoptMode(getDemoScenario())).toBe('create-new')
    })

    it('空白新故事 → create-new', () => {
      expect(inferAdoptMode(makeBlankScenario({ now: 99999 }))).toBe(
        'create-new',
      )
    })

    it('用户工作中的剧本 → replace-current', () => {
      const sc: Scenario = {
        ...makeBlankScenario({ now: 99999 }),
        characters: { ch1: { id: 'ch1', name: '甲', prompt: '' } },
      }
      expect(inferAdoptMode(sc)).toBe('replace-current')
    })
  })
})
