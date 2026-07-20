/**
 * 回归：挂载「静态组件方案」后，血条/气力必须能经 overlayMounts 渲染出来。
 *
 * 根因：引擎把 battleHpBar 放进 overlayMounts，但 SkinRegistry 的 HUD 皮肤在 hud 表；
 * renderOverlayMount 若不接 SkinCtx 会静默丢弃 → 试玩看不见挂载的 HUD。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraphSession } from '../engine/session'
import { registerCoreComponents } from '../registry/core-components'
import { createCoreSkinRegistry } from '../skins/components'
import { makeNodiaDemo } from '../../editor/demo/demo'
import { ensureBuiltinSchemes, SCHEME_STATIC_ID } from '../../editor/demo/builtin-schemes'

beforeAll(() => {
  registerCoreComponents()
})

describe('挂载静态方案 · HUD 进试玩', () => {
  it('enter 后 overlayMounts 含 battleHpBar，且带 skinCtx 时能渲出血条 DOM', () => {
    const overlays = ensureBuiltinSchemes({})
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
                  overlayNodes: [{ overlay: SCHEME_STATIC_ID }, ...(n.data.overlayNodes ?? [])],
                },
              }
            : n,
        ),
      },
    }

    const session = new GraphSession(scn)
    const snap = session.start()
    expect(snap.currentNodeId).toBe('n_open')

    const hudChildren = snap.overlayMounts
      .flatMap((m) => m.children)
      .filter((c) => c.component === 'battleHpBar')
    expect(hudChildren.map((c) => c.inputs.bind)).toEqual(['ent-player', 'ent-boss'])

    const skins = createCoreSkinRegistry()
    const mount = snap.overlayMounts.find((m) => m.mountId === SCHEME_STATIC_ID)
    expect(mount).toBeTruthy()

    // 无 ctx：HUD 无法渲染（历史 bug 路径）
    const withoutCtx = renderToStaticMarkup(skins.renderOverlayMount(mount!) as ReactElement)
    expect(withoutCtx).not.toContain('ks-hud-hp')
    expect(withoutCtx).not.toContain('ks-hud-boss')

    // 有 ctx：血条 + 气力珠出场
    const withCtx = renderToStaticMarkup(
      skins.renderOverlayMount(mount!, undefined, { hud: snap.hud }) as ReactElement,
    )
    expect(withCtx).toContain('ks-hud-hp')
    expect(withCtx).toContain('ks-hud-boss')
    expect(withCtx).toContain('ks-hud-rage') // 气力珠（vars.qi 为 number 即显示）
    expect(withCtx).toContain('我方')
    expect(withCtx).toContain('敌方')

    // 回归：无 layout 的 HUD 挂载盒必须铺满舞台（inset:0），不能塌成 fit-content 左上角 0×0——
    // 否则血条的角锚定（right/bottom/left:50%）相对 0×0 盒解析会跑到屏幕外/挤到左上角，试玩看不见。
    expect(withCtx).toContain('inset:0')
    expect(withCtx).not.toContain('fit-content')
  })
})
