import { describe, expect, it } from 'vitest'
import {
  applyReconnectPlan,
  defaultPlan,
  detectOrphans,
  type ReconnectPlan,
} from '../reconnectOrphans'
import type { Scenario } from '../types'

/**
 * 修复 branches 断链的纯函数测试。
 *
 * 场景：早期 clearSceneTimeline 误清了 branches，导致旧快照里出现
 * "中间节点出边为空"的脏数据。这组函数要能找出它们并给出修复计划。
 */

function makeScenario(scenes: Array<{
  id: string
  x: number
  y?: number
  branches?: Array<{ targetSceneId: string }>
  isEnding?: boolean
}>): Scenario {
  const dict: Scenario['scenes'] = {}
  for (const s of scenes) {
    dict[s.id] = {
      id: s.id,
      title: s.id,
      media: { kind: 'PLACEHOLDER' },
      durationMs: 1000,
      dialogue: [],
      branches: (s.branches ?? []).map((b, i) => ({
        id: `${s.id}-b${i}`,
        kind: 'auto',
        targetSceneId: b.targetSceneId,
      })),
      pos: { x: s.x, y: s.y ?? 0 },
      ...(s.isEnding ? { isEnding: true } : {}),
    }
  }
  return {
    id: 'test',
    title: 'test',
    rootSceneId: scenes[0]?.id ?? '',
    scenes: dict,
    characters: {},
    locations: {},
    defaultCharMs: 32,
    schemaVersion: 3,
  } as Scenario
}

describe('reconnectOrphans · detectOrphans', () => {
  it('所有场景出边齐全时 → orphans 为空', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200, branches: [{ targetSceneId: 'c' }] },
      { id: 'c', x: 400 }, // 终点允许
    ])
    // c 没有出边 —— 仍会被列出来让作者决定"结局 / 补"
    const orphans = detectOrphans(sc)
    expect(orphans).toHaveLength(1)
    expect(orphans[0]!.sceneId).toBe('c')
  })

  it('中间节点出边为空 → 按 x 推荐下一个同行场景', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, y: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200, y: 0 }, // 断头
      { id: 'c', x: 400, y: 0 },
      { id: 'd', x: 400, y: 500 }, // 不同行
    ])
    const orphans = detectOrphans(sc)
    const b = orphans.find((o) => o.sceneId === 'b')!
    expect(b.suggestedTargetId).toBe('c')
  })

  it('没有同行候选时 → 回退到全局下一个 x 更大的', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, y: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200, y: 0 }, // 断头
      { id: 'c', x: 400, y: 999 }, // y 相差很大仍然被选
    ])
    const orphans = detectOrphans(sc)
    const b = orphans.find((o) => o.sceneId === 'b')!
    expect(b.suggestedTargetId).toBe('c')
  })

  it('最右断头没有候选 → suggestedTargetId === null', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 500 }, // 最右 & 断头
    ])
    const orphans = detectOrphans(sc)
    const b = orphans.find((o) => o.sceneId === 'b')!
    expect(b.suggestedTargetId).toBeNull()
  })

  /*
   * v3.5 · "野指针" 断链 —— branches[] 不空但所有 target 都指向已删 scene。
   *
   * 为什么这么做：
   *   早期的 bug / 作者手动删场景 / 历史脏数据 都会留下 branches=[{target:'ghost'}]。
   *   肉眼看画布：节点 3 看着像"接好了"但线画不出来（画布会悄悄隐藏野指针边），
   *   Player 播到这里也直接停。原来 detectOrphans 只看 length，漏掉这类。
   *
   *   新规则：只要 branches[] 里**没有任何一条**指向仍然存在的 scene，就算断。
   */
  it('野指针断链 → branches 不空但所有 target 都不存在，也要算断头', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, y: 0, branches: [{ targetSceneId: 'b' }] },
      {
        id: 'b',
        x: 200,
        y: 0,
        // branches 表面上有一条，但目标 'ghost' 不存在于 scenes[] 里
        branches: [{ targetSceneId: 'ghost' }],
      },
      { id: 'c', x: 400, y: 0 },
    ])
    const orphans = detectOrphans(sc)
    expect(orphans.map((o) => o.sceneId)).toContain('b')
    const b = orphans.find((o) => o.sceneId === 'b')!
    expect(b.suggestedTargetId).toBe('c')
  })

  it('部分 branches 指向存在的 scene → 不算断头（作者设计的分支路径）', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, y: 0, branches: [{ targetSceneId: 'b' }] },
      {
        id: 'b',
        x: 200,
        y: 0,
        // 一条指 ghost 一条指真 scene —— 仍然是"有活路"，不算全断
        branches: [
          { targetSceneId: 'ghost' },
          { targetSceneId: 'c' },
        ],
      },
      { id: 'c', x: 400, y: 0 },
    ])
    const orphans = detectOrphans(sc)
    expect(orphans.map((o) => o.sceneId)).not.toContain('b')
  })

  /*
   * v3.5 · isEnding 显式结局 —— 作者在修复对话框里点"保持结局不连"后，
   * scene.isEnding = true 被写回。下次再打开对话框，这些 scene 应该不再
   * 作为 orphan 列出来（避免"看着没修好"的假象）。
   */
  it('isEnding === true 的场景不再列为 orphan', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200 }, // 普通断头 —— 仍然列出
      { id: 'c', x: 400, isEnding: true }, // 作者标结局 —— 跳过
    ])
    const orphans = detectOrphans(sc)
    const ids = orphans.map((o) => o.sceneId)
    expect(ids).toContain('b')
    expect(ids).not.toContain('c')
  })

  it('isEnding 作用于野指针场景 —— 同样跳过', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      {
        id: 'b',
        x: 200,
        branches: [{ targetSceneId: 'ghost' }],
        isEnding: true, // 作者明确认可的"HE / BE 野指针残留"
      },
    ])
    const orphans = detectOrphans(sc)
    expect(orphans.map((o) => o.sceneId)).not.toContain('b')
  })
})

describe('reconnectOrphans · applyReconnectPlan', () => {
  it('按 plan 给每个断头加一条 auto 边，目标存在且源尚无出边', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, y: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200, y: 0 }, // 断
      { id: 'c', x: 400, y: 0 }, // 断
      { id: 'd', x: 600, y: 0 },
    ])
    const plan: ReconnectPlan = {
      entries: [
        { sceneId: 'b', targetSceneId: 'c' },
        { sceneId: 'c', targetSceneId: 'd' },
      ],
    }
    const next = applyReconnectPlan(sc, plan, {
      idMaker: (sid) => `fix-${sid}`,
    })
    expect(next.scenes.b!.branches).toEqual([
      { id: 'fix-b', kind: 'auto', targetSceneId: 'c', label: '' },
    ])
    expect(next.scenes.c!.branches).toEqual([
      { id: 'fix-c', kind: 'auto', targetSceneId: 'd', label: '' },
    ])
    // 没动到的保持原引用
    expect(next.scenes.a).toBe(sc.scenes.a)
    expect(next.scenes.d).toBe(sc.scenes.d)
  })

  it('targetSceneId === null 的条目被跳过（作者标为结局）', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200 },
    ])
    const plan: ReconnectPlan = {
      entries: [{ sceneId: 'b', targetSceneId: null }],
    }
    const next = applyReconnectPlan(sc, plan)
    expect(next).toBe(sc) // 没动 → 原引用
  })

  it('目标场景不存在时跳过', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200 },
    ])
    const plan: ReconnectPlan = {
      entries: [{ sceneId: 'b', targetSceneId: 'ghost' }],
    }
    const next = applyReconnectPlan(sc, plan)
    expect(next).toBe(sc)
  })

  it('源场景已有 branches 时不再追加（幂等安全）', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200, branches: [{ targetSceneId: 'a' }] },
    ])
    const plan: ReconnectPlan = {
      entries: [{ sceneId: 'a', targetSceneId: 'b' }],
    }
    const next = applyReconnectPlan(sc, plan)
    expect(next).toBe(sc)
  })

  /*
   * v3.5 · 修 "野指针" 的关键 case。
   * 如果源场景 branches 里全是指向已删 scene 的野指针，apply 时要**替换**
   * 这组脏 branches，而不是跳过。否则 detect 出来了也没法修。
   */
  it('野指针 branches → apply 时替换整个 branches[] 而不是跳过', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      {
        id: 'b',
        x: 200,
        branches: [{ targetSceneId: 'ghost-1' }, { targetSceneId: 'ghost-2' }],
      },
      { id: 'c', x: 400 },
    ])
    const plan: ReconnectPlan = {
      entries: [{ sceneId: 'b', targetSceneId: 'c' }],
    }
    const next = applyReconnectPlan(sc, plan, { idMaker: (sid) => `fix-${sid}` })
    expect(next.scenes.b!.branches).toEqual([
      { id: 'fix-b', kind: 'auto', targetSceneId: 'c', label: '' },
    ])
  })

  it('野指针 + 有效 branch 并存 apply → 不动（仍有活路，不是断头）', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      {
        id: 'b',
        x: 200,
        branches: [
          { targetSceneId: 'ghost' },
          { targetSceneId: 'c' },
        ],
      },
      { id: 'c', x: 400 },
    ])
    const plan: ReconnectPlan = {
      entries: [{ sceneId: 'b', targetSceneId: 'c' }],
    }
    const next = applyReconnectPlan(sc, plan)
    expect(next).toBe(sc)
  })

  /*
   * v3.5 · markEnding —— 作者保持"结局·不连"并点应用时，把 scene.isEnding=true
   * 写回，下次不再列为 orphan。这是 UI 应用按钮在 fillableCount===0 也能可点
   * 的前提。
   */
  it('entry.markEnding=true → 把 scene.isEnding 写回 true', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200 }, // 断头 + 作者 confirm 为结局
    ])
    const plan: ReconnectPlan = {
      entries: [{ sceneId: 'b', targetSceneId: null, markEnding: true }],
    }
    const next = applyReconnectPlan(sc, plan)
    expect(next).not.toBe(sc)
    expect(next.scenes.b!.isEnding).toBe(true)
    // branches 保持空
    expect(next.scenes.b!.branches).toEqual([])
  })

  it('markEnding=true + scene 已经 isEnding=true → 幂等不写（引用不变）', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200, isEnding: true },
    ])
    const plan: ReconnectPlan = {
      entries: [{ sceneId: 'b', targetSceneId: null, markEnding: true }],
    }
    const next = applyReconnectPlan(sc, plan)
    expect(next).toBe(sc)
  })

  it('targetSceneId!=null 时 markEnding 被忽略（优先补边）', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200 },
      { id: 'c', x: 400 },
    ])
    const plan: ReconnectPlan = {
      entries: [
        { sceneId: 'b', targetSceneId: 'c', markEnding: true },
      ],
    }
    const next = applyReconnectPlan(sc, plan, { idMaker: (sid) => `fix-${sid}` })
    expect(next.scenes.b!.isEnding).toBeUndefined()
    expect(next.scenes.b!.branches).toHaveLength(1)
  })
})

describe('reconnectOrphans · defaultPlan', () => {
  it('从 detect 结果直接复制推荐作为默认计划', () => {
    const sc = makeScenario([
      { id: 'a', x: 0, y: 0, branches: [{ targetSceneId: 'b' }] },
      { id: 'b', x: 200, y: 0 }, // 断 → 推荐 c
      { id: 'c', x: 400, y: 0 }, // 断 → 最右无候选 = null
    ])
    const plan = defaultPlan(detectOrphans(sc))
    expect(plan.entries).toEqual([
      { sceneId: 'b', targetSceneId: 'c' },
      { sceneId: 'c', targetSceneId: null },
    ])
  })
})
