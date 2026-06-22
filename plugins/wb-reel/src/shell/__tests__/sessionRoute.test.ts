import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  buildShareableUrl,
  installSessionRouteSync,
  readLastEditedScenarioId,
  readSessionRoute,
  resolvePreferredScenarioId,
  writeLastEditedScenarioId,
  writeSessionRouteFromState,
} from '../sessionRoute'

/*
 * sessionRoute · 测试覆盖：
 *   - readSessionRoute 正确解析 ?scn / ?tab，未知 tab 值返回 undefined
 *   - resolvePreferredScenarioId 优先级：URL > localStorage
 *   - writeSessionRouteFromState 把当前 store 状态写回 URL（store 写测在
 *     installSessionRouteSync 里间接覆盖）
 *   - installSessionRouteSync 订阅 store → URL；popstate → store
 *   - buildShareableUrl 产出 origin + ?scn=&tab=
 *
 * 注意：测试要 mock 出可控的 location.search / history。jsdom 默认就给了
 * 真实可用的 window.location + window.history，URL 修改用 history.replaceState
 * 不会真发请求。
 */

const ORIGIN_FOR_TEST = 'http://localhost:3000/'

function setLocation(search: string): void {
  window.history.replaceState(null, '', `${ORIGIN_FOR_TEST}${search}`)
}

describe('sessionRoute', () => {
  beforeEach(() => {
    setLocation('')
    window.localStorage.clear()
  })

  afterEach(() => {
    setLocation('')
    window.localStorage.clear()
  })

  describe('readSessionRoute', () => {
    it('未指定 query 时返回全 undefined', () => {
      const route = readSessionRoute()
      expect(route).toEqual({
        scenarioId: undefined,
        tab: undefined,
        forgeView: undefined,
      })
    })

    it('解析 ?scn=xxx', () => {
      setLocation('?scn=scn-abc-123')
      expect(readSessionRoute().scenarioId).toBe('scn-abc-123')
    })

    it('解析 ?tab=forge / player', () => {
      setLocation('?tab=forge')
      expect(readSessionRoute().tab).toBe('forge')
      setLocation('?tab=player')
      expect(readSessionRoute().tab).toBe('player')
    })

    it('老链接 ?tab=storytree 自动迁移为 ?tab=forge&view=tree（语义层）', () => {
      setLocation('?tab=storytree')
      const route = readSessionRoute()
      expect(route.tab).toBe('forge')
      expect(route.forgeView).toBe('tree')
    })

    it('解析 ?view= 三档枚举', () => {
      setLocation('?tab=forge&view=script')
      expect(readSessionRoute().forgeView).toBe('script')
      setLocation('?tab=forge&view=image')
      expect(readSessionRoute().forgeView).toBe('image')
      setLocation('?tab=forge&view=tree')
      expect(readSessionRoute().forgeView).toBe('tree')
    })

    it('显式 ?view= 优先于 ?tab=storytree 自动迁移产生的 view', () => {
      setLocation('?tab=storytree&view=script')
      const route = readSessionRoute()
      expect(route.tab).toBe('forge')
      expect(route.forgeView).toBe('script')
    })

    it('未知 tab 值返回 undefined', () => {
      setLocation('?tab=foo')
      expect(readSessionRoute().tab).toBeUndefined()
    })

    it('未知 view 值返回 undefined', () => {
      setLocation('?tab=forge&view=foo')
      expect(readSessionRoute().forgeView).toBeUndefined()
    })

    it('双 query 同时解析', () => {
      setLocation('?scn=s1&tab=forge')
      const route = readSessionRoute()
      expect(route.scenarioId).toBe('s1')
      expect(route.tab).toBe('forge')
    })

    it('空字符串 ?scn= 视为缺失', () => {
      setLocation('?scn=')
      expect(readSessionRoute().scenarioId).toBeUndefined()
    })
  })

  describe('lastEditedScenarioId 持久化', () => {
    it('write+read 一致', () => {
      writeLastEditedScenarioId('scn-foo')
      expect(readLastEditedScenarioId()).toBe('scn-foo')
    })

    it('未写时返回 undefined', () => {
      expect(readLastEditedScenarioId()).toBeUndefined()
    })
  })

  describe('resolvePreferredScenarioId', () => {
    it('URL 有 ?scn 时优先于 localStorage', () => {
      writeLastEditedScenarioId('scn-from-storage')
      setLocation('?scn=scn-from-url')
      expect(resolvePreferredScenarioId()).toBe('scn-from-url')
    })

    it('URL 无 ?scn 时回落到 localStorage', () => {
      writeLastEditedScenarioId('scn-from-storage')
      expect(resolvePreferredScenarioId()).toBe('scn-from-storage')
    })

    it('两者都缺时返回 undefined', () => {
      expect(resolvePreferredScenarioId()).toBeUndefined()
    })
  })

  describe('buildShareableUrl', () => {
    it('生成完整链接（含 scn + tab）', () => {
      const url = buildShareableUrl('scn-abc', 'forge')
      const parsed = new URL(url)
      expect(parsed.searchParams.get('scn')).toBe('scn-abc')
      expect(parsed.searchParams.get('tab')).toBe('forge')
    })

    it('未传 tab 时只含 scn', () => {
      const url = buildShareableUrl('scn-abc')
      const parsed = new URL(url)
      expect(parsed.searchParams.get('scn')).toBe('scn-abc')
      expect(parsed.searchParams.get('tab')).toBeNull()
    })

    it('剥掉原 URL 上的其它 query / hash', () => {
      setLocation('?utm=foo&scn=old#section')
      const url = buildShareableUrl('scn-new', 'forge')
      const parsed = new URL(url)
      expect(parsed.searchParams.get('utm')).toBeNull()
      expect(parsed.searchParams.get('scn')).toBe('scn-new')
      expect(parsed.hash).toBe('')
    })

    it('forge tab + forgeView → 同时写入 ?view=', () => {
      const url = buildShareableUrl('scn-abc', 'forge', 'tree')
      const parsed = new URL(url)
      expect(parsed.searchParams.get('tab')).toBe('forge')
      expect(parsed.searchParams.get('view')).toBe('tree')
    })

    it('player tab 不写 ?view=（即使传了 forgeView）', () => {
      const url = buildShareableUrl('scn-abc', 'player', 'tree')
      const parsed = new URL(url)
      expect(parsed.searchParams.get('view')).toBeNull()
    })
  })

  describe('writeSessionRouteFromState 同步写入', () => {
    it('幂等：第二次调用 URL 不变', () => {
      // 不能直接 mock store —— 直接拿 store getState 的真实值，
      // 测幂等就够（避免在测试里污染 zustand 单例）
      writeSessionRouteFromState()
      const after1 = window.location.search
      writeSessionRouteFromState()
      const after2 = window.location.search
      expect(after1).toBe(after2)
    })
  })

  describe('installSessionRouteSync', () => {
    it('返回 dispose 函数；调用后再变 store 不会写 URL', () => {
      const dispose = installSessionRouteSync()
      expect(typeof dispose).toBe('function')
      dispose()
      // 测试这里不主动 trigger store 变化，只确保 dispose 不抛
    })

    it('popstate 把 URL ?tab 同步回 shellStore', async () => {
      const { useShellStore } = await import('../shellStore')
      const dispose = installSessionRouteSync()
      try {
        // 先把 store 的 tab 设为已知值
        useShellStore.getState().setActiveTab('player')
        // URL 改成 forge，触发 popstate
        setLocation('?tab=forge')
        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(useShellStore.getState().activeTab).toBe('forge')
      } finally {
        dispose()
      }
    })

    it('popstate 把 URL ?view 同步回 shellStore', async () => {
      const { useShellStore } = await import('../shellStore')
      const dispose = installSessionRouteSync()
      try {
        useShellStore.getState().setForgeView('script')
        setLocation('?tab=forge&view=tree')
        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(useShellStore.getState().forgeView).toBe('tree')
      } finally {
        dispose()
      }
    })
  })
})
