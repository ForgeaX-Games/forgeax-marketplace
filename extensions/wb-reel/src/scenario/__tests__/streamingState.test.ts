import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario } from '../demoScenario'
import type { ActSkeleton } from '../streamingState'

/**
 * scenarioStore · 长文本分段管线 streaming 状态机契约（id: p3-store）
 *
 * 关心点：
 *   1. startStreamingBatch / clearStreamingState 的初始 / 收尾
 *   2. appendActProgressive：插 scenes、串 auto 边、登记 nodeStatus / acts
 *   3. patchNodePrompts：单调升迁 skeleton → prompts-ready，不回退 assets-ready
 *   4. markNodeAssetsReady：升迁 prompts-ready → assets-ready
 *   5. setStreamingActStatus：act 级状态机
 *   6. loadScenario / adoptForgedScenario 自动复位 streaming
 *   7. streaming 字段不进 zundo / exportJSON（不持久化保证）
 */

function reset(): void {
  useScenarioStore.setState({
    scenario: getDemoScenario(),
    selectedSceneId: 'intro',
    selection: { kind: 'scene', sceneId: 'intro' },
    mode: 'editor',
    streaming: null,
  })
  useScenarioStore.temporal.getState().clear()
}

function makeAct(actId: string, nodeIds: string[], linkFrom?: string): ActSkeleton {
  return {
    actId,
    title: `第${actId}幕`,
    beat: `${actId} 节拍`,
    linkFromSceneId: linkFrom,
    nodes: nodeIds.map((id, i) => ({
      sceneId: id,
      title: `${actId}_n${i + 1}`,
      beat: `${actId}_n${i + 1}_beat`,
    })),
  }
}

describe('scenarioStore · streaming 状态机', () => {
  beforeEach(reset)
  afterEach(reset)

  describe('startStreamingBatch / clearStreamingState', () => {
    it('开新批次 → streaming 非空，acts/nodeStatus 都为空', () => {
      useScenarioStore.getState().startStreamingBatch('batch_001')
      const st = useScenarioStore.getState().streaming
      expect(st).not.toBeNull()
      expect(st!.batchId).toBe('batch_001')
      expect(st!.acts).toEqual([])
      expect(st!.nodeStatus).toEqual({})
      expect(st!.startedAt).toBeGreaterThan(0)
    })

    it('clearStreamingState 把 streaming 复位为 null', () => {
      useScenarioStore.getState().startStreamingBatch('batch_x')
      useScenarioStore.getState().clearStreamingState()
      expect(useScenarioStore.getState().streaming).toBeNull()
    })

    it('clearStreamingState 在已 null 时不产生新引用', () => {
      const before = useScenarioStore.getState()
      useScenarioStore.getState().clearStreamingState()
      // streaming 仍是 null —— set 应该没触发（用 getState() 比较"streaming 同身"）
      expect(useScenarioStore.getState().streaming).toBe(before.streaming)
    })
  })

  describe('appendActProgressive', () => {
    it('插入空骨架 scenes，串成 auto 链', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore
        .getState()
        .appendActProgressive(makeAct('act01', ['act01_n1', 'act01_n2', 'act01_n3']))

      const scenes = useScenarioStore.getState().scenario.scenes
      expect(scenes['act01_n1']).toBeTruthy()
      expect(scenes['act01_n2']).toBeTruthy()
      expect(scenes['act01_n3']).toBeTruthy()
      expect(scenes['act01_n1']!.media.kind).toBe('PLACEHOLDER')

      // auto 边：n1 → n2、n2 → n3
      expect(scenes['act01_n1']!.branches[0]!.targetSceneId).toBe('act01_n2')
      expect(scenes['act01_n1']!.branches[0]!.kind).toBe('auto')
      expect(scenes['act01_n2']!.branches[0]!.targetSceneId).toBe('act01_n3')
      // 末节点不串下游
      expect(scenes['act01_n3']!.branches).toEqual([])
    })

    it('linkFromSceneId 命中 → 上 Act 末尾节点挂 auto 边到首节点', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore
        .getState()
        .appendActProgressive(makeAct('act01', ['a1_n1', 'a1_n2']))
      useScenarioStore
        .getState()
        .appendActProgressive(makeAct('act02', ['a2_n1', 'a2_n2'], 'a1_n2'))

      const a1n2 = useScenarioStore.getState().scenario.scenes['a1_n2']!
      expect(a1n2.branches.some((b) => b.targetSceneId === 'a2_n1')).toBe(true)
    })

    it('streaming.acts / nodeStatus 写入 skeleton', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore
        .getState()
        .appendActProgressive(makeAct('act01', ['x1', 'x2']))
      const st = useScenarioStore.getState().streaming!
      expect(st.acts).toHaveLength(1)
      expect(st.acts[0]!.actId).toBe('act01')
      expect(st.acts[0]!.status).toBe('queued')
      expect(st.acts[0]!.sceneIds).toEqual(['x1', 'x2'])
      expect(st.nodeStatus['x1']).toBe('skeleton')
      expect(st.nodeStatus['x2']).toBe('skeleton')
    })

    it('幂等：同 actId 重复 append 被忽略', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['p1']))
      const before = useScenarioStore.getState().streaming!
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['p1']))
      const after = useScenarioStore.getState().streaming!
      expect(after.acts).toHaveLength(1)
      expect(after).toBe(before) // 引用未变
    })

    it('未启动批次时 append 是 no-op（防御）', () => {
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['z1']))
      expect(useScenarioStore.getState().scenario.scenes['z1']).toBeUndefined()
      expect(useScenarioStore.getState().streaming).toBeNull()
    })
  })

  describe('patchNodePrompts', () => {
    it('在 streaming 状态下：写 prompts + 升迁到 prompts-ready', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      useScenarioStore
        .getState()
        .patchNodePrompts('n1', { scene: '雨夜门外·灯笼', video: '推近至门环' })

      const sc = useScenarioStore.getState().scenario.scenes['n1']!
      expect(sc.prompts?.scene).toBe('雨夜门外·灯笼')
      expect(sc.prompts?.video).toBe('推近至门环')
      // 同步写回 media.prompt
      expect(sc.media.prompt).toBe('雨夜门外·灯笼')
      // 状态机升迁
      expect(useScenarioStore.getState().streaming!.nodeStatus['n1']).toBe(
        'prompts-ready',
      )
    })

    it('assets-ready 不会被 patchNodePrompts 回退', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      useScenarioStore.getState().patchNodePrompts('n1', { scene: 'a' })
      useScenarioStore.getState().markNodeAssetsReady('n1')
      useScenarioStore.getState().patchNodePrompts('n1', { scene: 'b' })
      expect(useScenarioStore.getState().streaming!.nodeStatus['n1']).toBe(
        'assets-ready',
      )
      // prompts 仍可被改（不阻断后期编辑）
      expect(useScenarioStore.getState().scenario.scenes['n1']!.prompts?.scene).toBe(
        'b',
      )
    })

    it('未启动 streaming 时也能改 prompts（不动状态机）', () => {
      useScenarioStore.getState().patchNodePrompts('intro', { scene: 'demo' })
      expect(useScenarioStore.getState().scenario.scenes['intro']!.prompts?.scene).toBe(
        'demo',
      )
      expect(useScenarioStore.getState().streaming).toBeNull()
    })

    it('sceneId 不存在 → no-op', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      const before = useScenarioStore.getState().scenario
      useScenarioStore.getState().patchNodePrompts('ghost', { scene: 'x' })
      expect(useScenarioStore.getState().scenario).toBe(before)
    })
  })

  describe('markNodeAssetsReady', () => {
    it('从 prompts-ready 升迁到 assets-ready', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      useScenarioStore.getState().patchNodePrompts('n1', { scene: 'p' })
      useScenarioStore.getState().markNodeAssetsReady('n1')
      expect(useScenarioStore.getState().streaming!.nodeStatus['n1']).toBe(
        'assets-ready',
      )
    })

    it('已经是 assets-ready 时不产生新引用', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      useScenarioStore.getState().markNodeAssetsReady('n1')
      const before = useScenarioStore.getState().streaming
      useScenarioStore.getState().markNodeAssetsReady('n1')
      expect(useScenarioStore.getState().streaming).toBe(before)
    })

    it('未启动 streaming 时是 no-op', () => {
      useScenarioStore.getState().markNodeAssetsReady('intro')
      expect(useScenarioStore.getState().streaming).toBeNull()
    })
  })

  describe('setStreamingActStatus', () => {
    it('queued → forging → ready', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      useScenarioStore.getState().setStreamingActStatus('act01', 'forging')
      expect(useScenarioStore.getState().streaming!.acts[0]!.status).toBe('forging')
      useScenarioStore.getState().setStreamingActStatus('act01', 'ready')
      expect(useScenarioStore.getState().streaming!.acts[0]!.status).toBe('ready')
    })

    it('failed 携带 errorReason；切到非 failed 时 errorReason 被清', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      useScenarioStore
        .getState()
        .setStreamingActStatus('act01', 'failed', '模拟超时')
      expect(useScenarioStore.getState().streaming!.acts[0]!.status).toBe('failed')
      expect(useScenarioStore.getState().streaming!.acts[0]!.errorReason).toBe(
        '模拟超时',
      )
      useScenarioStore.getState().setStreamingActStatus('act01', 'ready')
      expect(useScenarioStore.getState().streaming!.acts[0]!.errorReason).toBeUndefined()
    })

    it('不存在的 actId → no-op', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      const before = useScenarioStore.getState().streaming
      useScenarioStore.getState().setStreamingActStatus('ghost', 'ready')
      expect(useScenarioStore.getState().streaming).toBe(before)
    })

    it('状态相同 → 不产生新引用', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      const before = useScenarioStore.getState().streaming
      useScenarioStore.getState().setStreamingActStatus('act01', 'queued')
      expect(useScenarioStore.getState().streaming).toBe(before)
    })
  })

  describe('loadScenario / adoptForgedScenario 自动复位', () => {
    it('loadScenario 后 streaming 被清', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      expect(useScenarioStore.getState().streaming).not.toBeNull()
      useScenarioStore.getState().loadScenario(getDemoScenario())
      expect(useScenarioStore.getState().streaming).toBeNull()
    })

    it('adoptForgedScenario 后 streaming 被清', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      expect(useScenarioStore.getState().streaming).not.toBeNull()
      useScenarioStore.getState().adoptForgedScenario(getDemoScenario())
      expect(useScenarioStore.getState().streaming).toBeNull()
    })
  })

  describe('不进入持久化字段（关键约束）', () => {
    it('exportJSON 输出不含 streaming 字段', () => {
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().appendActProgressive(makeAct('act01', ['n1']))
      const raw = useScenarioStore.getState().exportJSON()
      const obj = JSON.parse(raw)
      expect('streaming' in obj).toBe(false)
      // 也不应有 _streamingState / streamingState 之类残留
      expect('_streamingState' in obj).toBe(false)
    })

    it('streaming 变化不进 zundo 历史栈', () => {
      // partialize 只追 scenario；streaming 在根 set 也不会进栈
      const histBefore = useScenarioStore.temporal.getState().pastStates.length
      useScenarioStore.getState().startStreamingBatch('b1')
      useScenarioStore.getState().setStreamingActStatus('act01', 'forging')
      const histAfter = useScenarioStore.temporal.getState().pastStates.length
      expect(histAfter).toBe(histBefore)
    })
  })
})
