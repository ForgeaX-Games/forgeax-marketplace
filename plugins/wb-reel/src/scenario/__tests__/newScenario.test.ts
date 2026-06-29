import { describe, it, expect, beforeEach } from 'vitest'
import { makeBlankScenario } from '../blankScenario'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario } from '../demoScenario'
import { useSceneImageCache } from '../../media/sceneImageCache'
import {
  bootSceneCacheReset,
  __resetSceneCacheResetForTest,
} from '../../media/sceneCacheReset'

/**
 * "➕ 新的故事" 功能契约
 *
 * 作者在 TopBar 点左上的 + 图标 → 把当前剧本归档进历史，
 * 当前编辑区切换到一份干净的空剧本。旧的内存侧缓存（场景图 cache）必须清掉，
 * 否则新剧第一个场景会闪一帧旧剧的占位图。
 *
 * makeBlankScenario()：生成可立即 loadScenario 的空剧本。
 *   - id 唯一（与 getDemoScenario 的 'demo-001' 不冲突）
 *   - title '新的故事'（作者可改）
 *   - 至少 1 个占位 scene（rootSceneId 对得上）
 *   - characters / locations 都空，QTE / dialogue / branches 都空
 *   - schemaVersion 固定为最新（目前 = 5）
 */

describe('makeBlankScenario', () => {
  it('返回的剧本 id 每次都不一样（基于时间戳）', () => {
    const a = makeBlankScenario()
    const b = makeBlankScenario({ now: Date.now() + 1 })
    expect(a.id).not.toBe(b.id)
    // 生产路径 (不传 now) 会附随机后缀防同毫秒撞 id; 传固定 now 则不带后缀。
    // 两种形态都应以 'scn-' 开头并包含数字时间戳。
    expect(a.id).toMatch(/^scn-\d+(-[a-z0-9]+)?$/)
    expect(b.id).toMatch(/^scn-\d+$/)
  })

  it('默认 title 是"新的故事"，rootSceneId 对应到 scenes 里真实存在的 scene', () => {
    const s = makeBlankScenario()
    expect(s.title).toBe('新的故事')
    expect(s.scenes[s.rootSceneId]).toBeDefined()
  })

  it('完全空白：没有角色、没有 QTE、没有 dialogue、没有 branch', () => {
    const s = makeBlankScenario()
    expect(Object.keys(s.characters ?? {})).toHaveLength(0)
    expect(Object.keys(s.locations ?? {})).toHaveLength(0)
    const root = s.scenes[s.rootSceneId]!
    expect(root.dialogue).toEqual([])
    expect(root.branches).toEqual([])
    expect(root.qte).toBeUndefined()
  })

  it('是最新 schema 版本（避免首次加载就触发迁移）', () => {
    const s = makeBlankScenario()
    expect(s.schemaVersion).toBe(8)
  })

  it('传 title 覆盖默认值', () => {
    const s = makeBlankScenario({ title: '我的新故事' })
    expect(s.title).toBe('我的新故事')
  })
})

describe('scenarioStore · newScenario action', () => {
  beforeEach(() => {
    __resetSceneCacheResetForTest()
    useScenarioStore.setState({
      scenario: getDemoScenario(),
      selectedSceneId: 'intro',
      selection: { kind: 'scene', sceneId: 'intro' },
      mode: 'editor',
    })
    useScenarioStore.temporal.getState().clear()
    useSceneImageCache.setState({ records: {} })
  })

  it('切换到新的空白剧本：scenario.id 变了，scenes 只剩 1 个占位', () => {
    const oldId = useScenarioStore.getState().scenario.id
    useScenarioStore.getState().newScenario()
    const next = useScenarioStore.getState().scenario
    expect(next.id).not.toBe(oldId)
    expect(Object.keys(next.scenes)).toHaveLength(1)
    expect(next.title).toBe('新的故事')
  })

  it('选中态跟随切换：selectedSceneId = 新剧的 rootSceneId', () => {
    useScenarioStore.getState().newScenario()
    const next = useScenarioStore.getState()
    expect(next.selectedSceneId).toBe(next.scenario.rootSceneId)
  })

  it('清掉 sceneImageCache —— 避免旧剧占位图闪进新画布（需 bootSceneCacheReset 已挂载）', () => {
    // sceneImageCache 的清理通过订阅 scenarioStore.scenario.id 变化触发。
    // 这里显式挂一次订阅模拟 App boot 行为，然后验证 newScenario 后 cache 被清。
    bootSceneCacheReset()
    useSceneImageCache.setState({
      records: {
        intro: {
          status: 'ready',
          dataUrl: 'data:image/png;base64,AAAA',
          prompt: 'stale',
          latencyMs: 10,
        },
      },
    })
    useScenarioStore.getState().newScenario()
    expect(useSceneImageCache.getState().records).toEqual({})
  })

  it('支持自定义 title 透传', () => {
    useScenarioStore.getState().newScenario({ title: '雨夜迷踪' })
    expect(useScenarioStore.getState().scenario.title).toBe('雨夜迷踪')
  })
})

describe('scenarioStore · adoptForgedScenario action', () => {
  /*
   * 语义契约：
   *   forge 流程（IdeaForge / ForgeChatPanel）生成的 scenario 拥有自己的 scn-<ts> id，
   *   但作者的心智模型是"在当前工程里生成"——不应该切到一个新的历史条目。
   *   adoptForgedScenario 的作用就是：内容全换，id 留当前的。
   *
   * 这几条测试锁住行为，防止有人回退成 loadScenario 让"跳新工程"的 bug 回来。
   */
  beforeEach(() => {
    __resetSceneCacheResetForTest()
    useScenarioStore.setState({
      scenario: getDemoScenario(),
      selectedSceneId: 'intro',
      selection: { kind: 'scene', sceneId: 'intro' },
      mode: 'editor',
    })
    useScenarioStore.temporal.getState().clear()
    useSceneImageCache.setState({ records: {} })
  })

  function makeForgeProduct(id: string, title: string) {
    // 最小可用 scenario —— 只要求 loadScenario/adopt 能跑通即可
    return {
      id,
      title,
      rootSceneId: 'sc1',
      scenes: {
        sc1: {
          id: 'sc1',
          title: 'Forged Scene',
          durationMs: 3000,
          media: { kind: 'IMAGE_PROMPT' as const, prompt: 'a room' },
          prompts: { scene: 'a room' },
          characterIds: [],
          dialogue: [],
          branches: [],
        },
      },
      defaultCharMs: 50,
      schemaVersion: 3 as const,
      originIdea: '一段 forge 出来的剧情',
    }
  }

  it('保留当前 scenario.id（关键契约：不产生"新工程"）', () => {
    const keptId = useScenarioStore.getState().scenario.id
    const forged = makeForgeProduct('scn-from-llm-999', '从 LLM 来的新剧本')
    useScenarioStore.getState().adoptForgedScenario(forged)
    const next = useScenarioStore.getState().scenario
    expect(next.id).toBe(keptId)
    expect(next.id).not.toBe(forged.id)
  })

  it('内容字段取 forge 产物：title / scenes / originIdea 被替换', () => {
    const forged = makeForgeProduct('scn-from-llm-999', '从 LLM 来的新剧本')
    useScenarioStore.getState().adoptForgedScenario(forged)
    const next = useScenarioStore.getState().scenario
    expect(next.title).toBe('从 LLM 来的新剧本')
    expect(Object.keys(next.scenes)).toEqual(['sc1'])
    expect(next.rootSceneId).toBe('sc1')
    expect(next.originIdea).toBe('一段 forge 出来的剧情')
  })

  it('选中态跟随 forge 产物的 rootSceneId，不会留在旧 intro', () => {
    const forged = makeForgeProduct('scn-from-llm-999', 't')
    useScenarioStore.getState().adoptForgedScenario(forged)
    const s = useScenarioStore.getState()
    expect(s.selectedSceneId).toBe('sc1')
    expect(s.selection).toEqual({ kind: 'scene', sceneId: 'sc1' })
  })

  /*
   * v6.8 新增: mode='create-new' 路径 ——
   *   适用于"用户在内置 demo / 空白上锻造新剧本", 应该独立 id, 不覆盖样板。
   */
  describe('mode: create-new', () => {
    it('沿用 forge 产物自己带的 id (LLM 生成的 scn-xxx)', () => {
      const forged = makeForgeProduct('scn-from-llm-999', '新剧本')
      useScenarioStore
        .getState()
        .adoptForgedScenario(forged, { mode: 'create-new' })
      const next = useScenarioStore.getState().scenario
      expect(next.id).toBe('scn-from-llm-999')
      expect(next.id).not.toBe('demo-001')
    })

    it('forge 产物 id 等于 current.id 时 (异常重叠) 自动生成新 scn-<ts>', () => {
      const currentId = useScenarioStore.getState().scenario.id
      // forged.id 故意撞 current.id, 模拟"LLM 复用了 current id"或"id 缺失被填默认"
      const forged = makeForgeProduct(currentId, '新剧本')
      useScenarioStore
        .getState()
        .adoptForgedScenario(forged, { mode: 'create-new' })
      const next = useScenarioStore.getState().scenario
      expect(next.id).not.toBe(currentId)
      expect(next.id.startsWith('scn-')).toBe(true)
    })

    it('forge 产物没 id 时也生成新 id', () => {
      const forged = makeForgeProduct('', '新剧本')
      useScenarioStore
        .getState()
        .adoptForgedScenario(forged, { mode: 'create-new' })
      const next = useScenarioStore.getState().scenario
      expect(next.id).toBeTruthy()
      expect(next.id.startsWith('scn-')).toBe(true)
      expect(next.id).not.toBe('demo-001')
    })
  })

  describe('mode: replace-current (默认)', () => {
    it('显式传 replace-current 与不传保持一致行为', () => {
      const keptId = useScenarioStore.getState().scenario.id
      const forged = makeForgeProduct('scn-from-llm-999', '新剧本')
      useScenarioStore
        .getState()
        .adoptForgedScenario(forged, { mode: 'replace-current' })
      expect(useScenarioStore.getState().scenario.id).toBe(keptId)
    })
  })
})
