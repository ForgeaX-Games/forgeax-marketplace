import { describe, expect, it } from 'vitest'
import type { ReelMountHandle, ReelMountOptions } from '../mount'
import type { Scenario } from '../scenario/types'

/**
 * Workbench 集成契约 —— 编译期 + 轻量运行时检查。
 *
 * 完整 DOM mount 测试会把整棵 App 树拉起来（含 LLM provider、存储副作用），
 * 对单测开销过大；这里只做接口形状检查，保证 mount 导出与签名稳定。
 *
 * 真正的集成测试由 workbench 宿主自己跑端到端。
 */

describe('mount() export contract', () => {
  it('导出 mount 和 handle 类型（编译期检查）', async () => {
    const mod = await import('../mount')
    expect(typeof mod.mount).toBe('function')
    // 不实际 mount（会尝试渲染整棵树），只断言它是 function 即可
  })

  it('ReelMountOptions 允许仅传 initialScenario', () => {
    const opts: ReelMountOptions = {}
    expect(opts.persistence).toBeUndefined()
    const o2: ReelMountOptions = {
      initialScenario: {
        id: 'x',
        title: 'x',
        rootSceneId: 's1',
        scenes: {},
        defaultCharMs: 30,
        schemaVersion: 2,
      } as Scenario,
      persistence: 'memory',
    }
    expect(o2.persistence).toBe('memory')
  })

  it('ReelMountHandle 有 unmount / loadScenario / getSnapshot', () => {
    const fakeHandle: ReelMountHandle = {
      unmount: () => {},
      loadScenario: () => {},
      getSnapshot: () => ({
        scenario: {
          id: 'x',
          title: 'x',
          rootSceneId: 's1',
          scenes: {},
          defaultCharMs: 30,
          schemaVersion: 2,
        } as Scenario,
        activeTab: 'forge',
      }),
    }
    const snap = fakeHandle.getSnapshot()
    expect(snap.activeTab).toBe('forge')
    expect(() => fakeHandle.unmount()).not.toThrow()
  })
})
