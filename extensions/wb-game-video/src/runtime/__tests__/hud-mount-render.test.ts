/**
 * 回归：挂载「静态组件方案」后，血条须经 overlayMounts + OverlayComponent 渲出。
 * 新规格玩家/敌方血条走 overlay 表，参数来自正式 ComponentDef.inputs。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraphSession } from '../engine/session'
import { createCoreSkinRegistry, registerCoreSkins } from '../component-host/components'
import { makeNodiaDemo } from '../../editor/demo/demo'
import { BUILTIN_SCHEMES, ensureBuiltinSchemes, SCHEME_STATIC_ID } from '../../editor/demo/builtin-schemes'
import { STAGE_FILL_LAYOUT } from '../schema/layout'

beforeAll(() => {
  registerCoreSkins()
})

describe('挂载静态方案 · 血条进试玩', () => {
  it('enter 后 overlayMounts 含两种新规格血条并能渲出 DOM', () => {
    const overlays = ensureBuiltinSchemes(Object.fromEntries(
      BUILTIN_SCHEMES.map((scheme) => [scheme.id, structuredClone(scheme)]),
    ))
    const base = makeNodiaDemo()
    const scn = {
      ...base,
      ui: { ...base.ui, overlays: { ...base.ui?.overlays, ...overlays } },
      graph: {
        ...base.graph,
        nodes: base.graph.nodes.map((n) =>
          n.id === 'n_open'
            ? {
                ...n,
                data: {
                  ...n.data,
                  overlayNodes: [
                    { overlay: SCHEME_STATIC_ID, layout: { ...STAGE_FILL_LAYOUT } },
                    ...(n.data.overlayNodes ?? []),
                  ],
                },
              }
            : n,
        ),
      },
    }

    const session = new GraphSession(scn)
    const snap = session.start()
    expect(snap.currentNodeId).toBe('n_open')

    const hudChildren = snap.overlayMounts.flatMap((m) => m.children)
    expect(hudChildren.map((c) => c.component)).toEqual(
      expect.arrayContaining(['BattlePlayerHpBar', 'BattleEnemyHpBar']),
    )

    const skins = createCoreSkinRegistry()
    const mount = snap.overlayMounts.find((m) => m.mountId === SCHEME_STATIC_ID)
    expect(mount).toBeTruthy()

    // 新规格血条不再通过 inputs.bind 解释位置/实体，缺 ctx 也使用参数默认值稳定预览。
    const withoutCtx = renderToStaticMarkup(skins.renderOverlayMount(mount!) as ReactElement)
    expect(withoutCtx).toContain('ks-hud-hp')
    expect(withoutCtx).toContain('ks-hud-boss')

    // 有 ctx：血条 + 气力珠出场
    const withCtx = renderToStaticMarkup(
      skins.renderOverlayMount(mount!, undefined, { hud: snap.hud }) as ReactElement,
    )
    expect(withCtx).toContain('ks-hud-hp')
    expect(withCtx).toContain('ks-hud-boss')
    expect(withCtx).toContain('ks-hud-rage')
    expect(withCtx).toContain('我方')
    expect(withCtx).toContain('敌方')

    // 挂载/子件 STAGE_FILL → 宽高百分比铺满，不能塌成 fit-content
    expect(withCtx).toContain('width:100%')
    expect(withCtx).toContain('height:100%')
    expect(withCtx).not.toContain('fit-content')
  })
})
