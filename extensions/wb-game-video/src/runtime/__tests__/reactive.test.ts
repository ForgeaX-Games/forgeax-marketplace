import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerComponent, unregisterComponent } from '../registry/component-registry'
import { isRenderOverlay } from '../engine/directives'
import type { RenderOverlayDirective } from '../engine/directives'
import type { GameGraph, Overlay } from '../schema/graph-schema'
import { node, scnOf } from './test-fixtures'

const COMPONENT_IDS = ['floatT']
beforeEach(() => {
  registerComponent('floatT', { role: 'presentation' })
})
afterEach(() => COMPONENT_IDS.forEach(unregisterComponent))

const dmgOverlay: Overlay = {
  id: 'hud',
  children: [{ id: 'dmgFloat', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
}

describe('watch reaction (数值变化 → spawn)', () => {
  it('spawns a transient float with abs(delta) when watched hp decreases', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -20 }] }] },
            { when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'dec' }, do: [{ kind: 'spawn', from: 'hud/dmgFloat', inputs: { amount: { expr: 'abs(delta)' } }, ttlMs: 800 }] },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, { ui: { overlays: { hud: dmgOverlay } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start() // baseline hp=300

    const dirs = rt.tick(600) // at 500 → hp-20 → watch(dec) → spawn
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn).toBeTruthy()
    expect(spawn!.component).toBe('floatT')
    expect(spawn!.inputs.amount).toBe(20)

    // ttl 到点自动回收
    const later = rt.tick(1600) // 600 + 800 = 1400 已过
    expect(later.some((d) => d.type === 'removeOverlay' && d.elementId === spawn!.elementId)).toBe(true)
  })

  it('spawns bossHitCheer with dmg=abs(delta) and remain=entity read (demo shape)', () => {
    const cheer: Overlay = {
      id: 'hitCheer',
      children: [{ id: 'banner', component: 'bossHitCheer', trigger: { when: 'enter' }, inputs: { heroName: '空藏' } }],
    }
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -40 }] }] },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      ui: { overlays: { hitCheer: cheer } },
      reactions: [
        { when: { type: 'watch', of: 'entity.ent-boss.attr.hp', on: 'dec' }, do: [{ kind: 'spawn', from: 'hitCheer/banner', inputs: { dmg: { expr: 'abs(delta)' }, remain: { expr: 'entity.ent-boss.attr.hp' }, heroName: '空藏' }, ttlMs: 3000 }] },
      ],
    })
    const rt = new GraphRuntime(scn.graph, scn) // boss hp=700
    rt.start()
    const dirs = rt.tick(600) // hp 700→660, dec
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn).toBeTruthy()
    expect(spawn!.component).toBe('bossHitCheer')
    expect(spawn!.inputs.dmg).toBe(40)
    expect(spawn!.inputs.remain).toBe(660)
    expect(spawn!.inputs.heroName).toBe('空藏')
  })

  it('heroName resolves dynamically from entity name via { ref } (rename-safe, not hardcoded)', () => {
    const cheer: Overlay = {
      id: 'hitCheer',
      children: [{ id: 'banner', component: 'bossHitCheer', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 }] }] },
            { when: { type: 'watch', of: 'entity.ent-boss.attr.hp', on: 'dec' }, do: [{ kind: 'spawn', from: 'hitCheer/banner', inputs: { heroName: { ref: 'entity.ent-player.name' } }, ttlMs: 3000 }] },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      ui: { overlays: { hitCheer: cheer } },
      entities: { 'ent-player': { id: 'ent-player', kind: 'player', name: '苏鹤', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } } },
    })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    const dirs = rt.tick(600)
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn!.inputs.heroName).toBe('苏鹤') // 跟随实体名，非写死
  })

  it('does not fire when direction mismatches (on=inc but value decreased)', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -20 }] }] },
            { when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'inc' }, do: [{ kind: 'spawn', from: 'hud/dmgFloat', ttlMs: 800 }] },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, { ui: { overlays: { hud: dmgOverlay } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    const dirs = rt.tick(600)
    expect(dirs.some((d) => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))).toBe(false)
  })
})

describe('container watch spans subflow (我方回合 场景)', () => {
  it('fires a watch declared on the subflow container while a child node deals damage', () => {
    const cheer: Overlay = {
      id: 'hitCheer',
      children: [{ id: 'banner', component: 'bossHitCheer', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        // 容器（我方回合）：下钻到技能节点 atk；容器上挂 watch。
        node('turn', {
          subFlow: 'atk',
          reactions: [
            { when: { type: 'watch', of: 'entity.ent-boss.attr.hp', on: 'dec' }, do: [{ kind: 'spawn', from: 'hitCheer/banner', inputs: { dmg: { expr: 'abs(delta)' } }, ttlMs: 3000 }] },
          ],
        }),
        node('atk', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -30 }] }] },
          ],
        }),
        node('done', {}),
      ],
      edges: [{ id: 'e', source: 'turn', target: 'done', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, { ui: { overlays: { hitCheer: cheer } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('atk') // 下钻进技能节点

    const dirs = rt.tick(600) // atk 扣 boss 30 → 容器 watch 生效 → spawn
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn).toBeTruthy()
    expect(spawn!.component).toBe('bossHitCheer')
    expect(spawn!.inputs.dmg).toBe(30)
  })
})

describe('non-blocking component events (回合按钮面板)', () => {
  it('container-mounted panel: click routes to mount event reaction (spawn / effect), 不阻塞', () => {
    const panel: Overlay = {
      id: 'hpPanel',
      children: [
        { id: 'panelA', component: 'floatT', trigger: { when: 'enter' }, inputs: {} },
        { id: 'panelB', component: 'floatT', trigger: { when: 'enter' }, inputs: {} },
      ],
    }
    const readouts: Overlay = {
      id: 'readouts',
      children: [{ id: 'bossHp', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        node('turn', {
          subFlow: 'atk',
          overlayNodes: [{
            overlay: 'hpPanel',
            reactions: [
              { when: { type: 'event', id: 'A' }, do: [{ kind: 'spawn', from: 'readouts/bossHp', inputs: { text: { expr: 'entity.ent-boss.attr.hp' } }, ttlMs: 1500 }] },
              { when: { type: 'event', id: 'B2' }, do: [{ kind: 'effect', effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 2 }] }] },
            ],
          }],
        }),
        node('atk', { durationMs: 5000 }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, { ui: { overlays: { hpPanel: panel, readouts } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('atk') // 下钻进技能节点，turn 在调用栈

    // 面板由容器挂载 → 在子流程节点内可见（childrenOf 继承容器 children）
    expect(rt['childrenOf'](rt['node']('atk')).some((c: { id: string }) => c.id === 'hpPanel/panelA')).toBe(true)

    // 点击 A → 非阻塞事件 → spawn boss 血量读数
    const dirsA = rt.emitComponentEvent('hpPanel/panelA', 'A')
    const spawn = dirsA.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.elementId.startsWith('spawn:'))
    expect(spawn).toBeTruthy()
    expect(spawn!.inputs.text).toBe(700) // 小怪当前血量
    expect(rt.state.phase).toBe('playing') // 未阻塞

    // 点击 B2 → 英雄气力 +2
    rt.emitComponentEvent('hpPanel/panelB', 'B2')
    expect(rt.state.vars.qi).toBe(2)
  })

  it('panel button with goto: click jumps to target node (硬跳转)', () => {
    const panel: Overlay = {
      id: 'hpPanel',
      children: [{ id: 'panelB', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        node('turn', {
          subFlow: 'atk',
          overlayNodes: [{ overlay: 'hpPanel', reactions: [{ when: { type: 'event', id: 'B3' }, do: [{ kind: 'advance', edgeId: 'e-drink' }] }] }],
        }),
        node('atk', { durationMs: 5000 }),
        node('drink', {}),
      ],
      edges: [{ id: 'e-drink', source: 'turn', target: 'drink', sourceHandle: 'B3', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, { ui: { overlays: { hpPanel: panel } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('atk')
    rt.emitComponentEvent('hpPanel/panelB', 'B3') // → goto drink
    expect(rt.state.currentNodeId).toBe('drink')
    expect(rt.state.callStack).toEqual([]) // 硬跳转清栈
  })
})

describe('lifecycle reactions (shown / hidden)', () => {
  it('fires shown on mount and hidden on node exit', () => {
    const overlay: Overlay = {
      id: 'hud2',
      children: [{ id: 'banner', component: 'floatT', trigger: { when: 'enter' }, inputs: {} }],
    }
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 100,
          overlayNodes: [{ overlay: 'hud2' }],
          reactions: [
            { when: { type: 'shown', of: 'banner' }, do: [{ kind: 'effect', effects: [{ id: 's', kind: 'var', varId: 'qi', op: 'set', value: 1 }] }] },
            { when: { type: 'hidden', of: 'banner' }, do: [{ kind: 'effect', effects: [{ id: 'h', kind: 'var', varId: 'qi', op: 'set', value: 5 }] }] },
          ],
        }),
        node('b', {}),
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, { ui: { overlays: { hud2: overlay } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start() // banner mount → shown
    expect(rt.state.vars.qi).toBe(1)

    rt.onPerformanceEnd() // 演出结束 → 走边 → runExit(a) → banner unmount → hidden
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.vars.qi).toBe(5)
  })
})
