import { describe, it, expect, beforeEach } from 'vitest'
import { useShellStore, tabFromMode } from '../shellStore'

/**
 * shellStore 契约测试 ——
 *
 * 把 Tab 切换 / 抽屉开关 / focusIntent 的规则固化下来，避免以后重构时：
 *   - Tab 切换误触发 undo/redo（因为混进了 scenarioStore）
 *   - 同一个节点双击两次不聚焦（tick 忘记递增）
 *   - Player → Editor 回退时误跳到其他 tab
 *
 * 2026-05 重构：原 'storytree' 顶栏 tab 被吸收为 forge.tree 视图，
 * 默认 activeTab 改为 'forge'，focusSceneInStage 同时写 forgeView='tree'。
 */

function reset(): void {
  useShellStore.setState({
    activeTab: 'forge',
    forgeView: 'tree',
    imageSection: 'refs',
    inspectorOpen: false,
    sceneDetailOpen: false,
    stageSceneId: null,
    sceneExpanded: false,
    focusIntent: null,
    forgeProgress: null,
  })
}

describe('shellStore · activeTab', () => {
  beforeEach(reset)

  it('默认是 forge', () => {
    expect(useShellStore.getState().activeTab).toBe('forge')
  })

  it('setActiveTab 切换后字段更新', () => {
    useShellStore.getState().setActiveTab('player')
    expect(useShellStore.getState().activeTab).toBe('player')
    useShellStore.getState().setActiveTab('forge')
    expect(useShellStore.getState().activeTab).toBe('forge')
  })

  it('setActiveTab 收到非法值时静默归位 forge (老链接 / 第三方注入兜底)', () => {
    // 模拟控制台/老链接传入已经被砍掉的枚举 (storytree / editor / image)
    const api = useShellStore.getState()
    ;(api.setActiveTab as (t: string) => void)('storytree')
    expect(useShellStore.getState().activeTab).toBe('forge')
    ;(api.setActiveTab as (t: string) => void)('editor')
    expect(useShellStore.getState().activeTab).toBe('forge')
    ;(api.setActiveTab as (t: string) => void)('')
    expect(useShellStore.getState().activeTab).toBe('forge')
  })
})

describe('shellStore · forgeView', () => {
  beforeEach(reset)

  it('setForgeView 切换二级视图', () => {
    useShellStore.getState().setForgeView('script')
    expect(useShellStore.getState().forgeView).toBe('script')
    useShellStore.getState().setForgeView('image')
    expect(useShellStore.getState().forgeView).toBe('image')
    useShellStore.getState().setForgeView('tree')
    expect(useShellStore.getState().forgeView).toBe('tree')
  })

  it('forgeView 与 activeTab 互不干扰', () => {
    useShellStore.getState().setForgeView('script')
    useShellStore.getState().setActiveTab('player')
    // 切到 player 后 forgeView 不被清掉，回到 forge 还能延续
    expect(useShellStore.getState().forgeView).toBe('script')
  })

  it('setForgeView 收到非法值时静默归位 script', () => {
    const api = useShellStore.getState()
    ;(api.setForgeView as (v: string) => void)('storytree') // 老枚举
    expect(useShellStore.getState().forgeView).toBe('script')
    ;(api.setForgeView as (v: string) => void)('')
    expect(useShellStore.getState().forgeView).toBe('script')
  })
})

describe('shellStore · imageSection', () => {
  beforeEach(reset)

  it('默认是 refs', () => {
    expect(useShellStore.getState().imageSection).toBe('refs')
  })

  it('setImageSection 在 风格 / 参考图 / UI 间切换', () => {
    useShellStore.getState().setImageSection('style')
    expect(useShellStore.getState().imageSection).toBe('style')
    useShellStore.getState().setImageSection('ui')
    expect(useShellStore.getState().imageSection).toBe('ui')
    useShellStore.getState().setImageSection('refs')
    expect(useShellStore.getState().imageSection).toBe('refs')
  })

  it('imageSection 与 forgeView 互不干扰', () => {
    useShellStore.getState().setImageSection('ui')
    useShellStore.getState().setForgeView('tree')
    // 切走 image 视图后 imageSection 不被清掉，回到 image 还能延续
    expect(useShellStore.getState().imageSection).toBe('ui')
  })

  it('setImageSection 收到非法值时静默归位 refs', () => {
    const api = useShellStore.getState()
    ;(api.setImageSection as (v: string) => void)('legacy')
    expect(useShellStore.getState().imageSection).toBe('refs')
    ;(api.setImageSection as (v: string) => void)('')
    expect(useShellStore.getState().imageSection).toBe('refs')
  })
})

describe('shellStore · inspector drawer', () => {
  beforeEach(reset)

  it('默认关闭', () => {
    expect(useShellStore.getState().inspectorOpen).toBe(false)
  })

  it('toggleInspector 每次翻转', () => {
    useShellStore.getState().toggleInspector()
    expect(useShellStore.getState().inspectorOpen).toBe(true)
    useShellStore.getState().toggleInspector()
    expect(useShellStore.getState().inspectorOpen).toBe(false)
  })

  it('setInspectorOpen 覆盖任意当前值', () => {
    useShellStore.getState().setInspectorOpen(true)
    useShellStore.getState().setInspectorOpen(true) // idempotent
    expect(useShellStore.getState().inspectorOpen).toBe(true)
  })
})

describe('shellStore · focusIntent 替代 FOCUS_STAGE_EVENT', () => {
  beforeEach(reset)

  it('focusSceneInStage 打开场景详情浮层 + 切到 forge.tree + 写入 intent', () => {
    useShellStore.getState().setForgeView('script')
    useShellStore.getState().focusSceneInStage('scene-a')
    const s = useShellStore.getState()
    expect(s.activeTab).toBe('forge')
    expect(s.forgeView).toBe('tree')
    expect(s.sceneDetailOpen).toBe(true)
    expect(s.stageSceneId).toBe('scene-a')
    expect(s.focusIntent?.sceneId).toBe('scene-a')
    expect(s.focusIntent?.tick).toBe(1)
  })

  it('同一 sceneId 连点两次 tick 递增 —— 订阅者能区分"新一次聚焦"', () => {
    const api = useShellStore.getState()
    api.focusSceneInStage('scene-a')
    api.focusSceneInStage('scene-a')
    expect(useShellStore.getState().focusIntent?.tick).toBe(2)
  })

  it('closeSceneDetail 只关浮层，不清 focusIntent / stageSceneId', () => {
    const api = useShellStore.getState()
    api.focusSceneInStage('scene-a')
    api.closeSceneDetail()
    const s = useShellStore.getState()
    expect(s.sceneDetailOpen).toBe(false)
    // stageSceneId 保留 —— 重新打开时还能回到这个场景
    expect(s.stageSceneId).toBe('scene-a')
    expect(s.focusIntent?.sceneId).toBe('scene-a')
  })

  it('clearFocusIntent 清空但不动详情浮层开关', () => {
    const api = useShellStore.getState()
    api.focusSceneInStage('scene-a')
    api.clearFocusIntent()
    const s = useShellStore.getState()
    expect(s.focusIntent).toBeNull()
    expect(s.sceneDetailOpen).toBe(true)
  })
})

describe('shellStore · sceneExpanded / forgeProgress', () => {
  beforeEach(reset)

  it('sceneExpanded 独立翻转', () => {
    expect(useShellStore.getState().sceneExpanded).toBe(false)
    useShellStore.getState().setSceneExpanded(true)
    expect(useShellStore.getState().sceneExpanded).toBe(true)
  })

  it('forgeProgress 支持 null / 对象结构', () => {
    useShellStore.getState().setForgeProgress({ done: 3, total: 10 })
    expect(useShellStore.getState().forgeProgress).toEqual({
      done: 3,
      total: 10,
    })
    useShellStore.getState().setForgeProgress(null)
    expect(useShellStore.getState().forgeProgress).toBeNull()
  })
})

describe('tabFromMode · 兼容旧 setMode 调用', () => {
  it('player mode 永远映射到 player tab', () => {
    expect(tabFromMode('player', 'forge')).toBe('player')
    expect(tabFromMode('player', 'player')).toBe('player')
  })

  it('editor mode + 当前非 player tab → 保留当前 tab', () => {
    expect(tabFromMode('editor', 'forge')).toBe('forge')
  })

  it('editor mode + 当前在 player tab → 退回 forge', () => {
    expect(tabFromMode('editor', 'player')).toBe('forge')
  })
})
