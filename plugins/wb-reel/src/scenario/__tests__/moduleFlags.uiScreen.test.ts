import { describe, it, expect } from 'vitest'
import { isModuleEnabled, effectiveUIScreens } from '../moduleFlags'
import { makeBlankScenario } from '../blankScenario'
import type { Scenario, UIScreen } from '../types'

function blankScenario(): Scenario {
  return makeBlankScenario()
}

function makeScreen(id: string): UIScreen {
  return { id, name: id, kind: 'inventory' }
}

function withScreens(screens: Record<string, UIScreen>): Scenario {
  return { ...blankScenario(), uiScreens: screens }
}

describe('moduleFlags · uiScreen(全屏页面开关)', () => {
  it('空剧本(无全屏页面)默认关 —— 避免凭空塞背包/游戏化主界面', () => {
    const s = blankScenario()
    expect(isModuleEnabled({ modules: s.modules, uiScreens: s.uiScreens }, 'uiScreen')).toBe(false)
  })

  it('作者已搭过全屏页面 → 默认开(我做过的东西不能是关的)', () => {
    const s = withScreens({ a: makeScreen('a') })
    expect(isModuleEnabled({ modules: s.modules, uiScreens: s.uiScreens }, 'uiScreen')).toBe(true)
  })

  it('显式关掉即使有页面也视为关', () => {
    const s = withScreens({ a: makeScreen('a') })
    s.modules = { ...(s.modules ?? {}), uiScreen: false }
    expect(isModuleEnabled({ modules: s.modules, uiScreens: s.uiScreens }, 'uiScreen')).toBe(false)
  })

  it('effectiveUIScreens：关掉时返回空表(菜单入口/时间轴触发都失效)', () => {
    const s = withScreens({ a: makeScreen('a'), b: makeScreen('b') })
    s.modules = { ...(s.modules ?? {}), uiScreen: false }
    expect(effectiveUIScreens(s)).toEqual({})
  })

  it('effectiveUIScreens：开启时透传全部页面', () => {
    const s = withScreens({ a: makeScreen('a') })
    expect(Object.keys(effectiveUIScreens(s))).toEqual(['a'])
  })

  it('单页开关：enabled===false 的页面被剔除,其余保留(背包留、主界面关)', () => {
    const bag = { ...makeScreen('bag'), kind: 'inventory' as const }
    const menu = { ...makeScreen('menu'), kind: 'mainMenu' as const, enabled: false }
    const s = withScreens({ bag, menu })
    expect(Object.keys(effectiveUIScreens(s))).toEqual(['bag'])
  })

  it('单页开关：enabled 缺省视为开', () => {
    const s = withScreens({ a: makeScreen('a') })
    expect('enabled' in (s.uiScreens?.a ?? {})).toBe(false)
    expect(Object.keys(effectiveUIScreens(s))).toEqual(['a'])
  })

  it('总闸关时,单页即使 enabled 也全空', () => {
    const s = withScreens({ a: { ...makeScreen('a'), enabled: true } })
    s.modules = { ...(s.modules ?? {}), uiScreen: false }
    expect(effectiveUIScreens(s)).toEqual({})
  })

  it('剧情树不受该开关影响(始终可用)', () => {
    const s = blankScenario()
    // 未定义 treeTheme 也应能正常播放,uiScreen 关不影响剧情树导航。
    expect(isModuleEnabled({ modules: s.modules, uiScreens: s.uiScreens }, 'uiScreen')).toBe(false)
    expect(s.rootSceneId).toBeTruthy()
  })
})
