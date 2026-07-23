/**
 * 回归：时间轴预览必须能画挂载方案里的组件（含 battleHpBar）。
 * 表现层统一走 overlay 表 + skinCtx 绘制时 resolve。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createCoreSkinRegistry, registerCoreSkins } from '../../../runtime/component-host/components'
import { battleHpBarPreset } from '../../../runtime/component-host/components/BattleHpBar'
import { inkKouPreset } from '../../../runtime/component-host/components/InkKouLayer'
import { inkYingMoPreset } from '../../../runtime/component-host/components/InkYingMoLayer'
import { renderOverlayChildPreview } from '../overlayChildPreview'
import type { SkinCtx } from '../../../runtime/component-host/rendererRegistry'

beforeAll(() => {
    registerCoreSkins()
})

function hudEnt(hp: number, maxHp: number) {
  return { hp, maxHp, attrs: { hp }, attrMax: { hp: maxHp } }
}

const ctx: SkinCtx = {
  hud: {
    entities: {
      'ent-player': hudEnt(72, 100),
      'ent-boss': hudEnt(58, 100),
    },
    vars: { qi: 3 },
    flags: {},
    score: 0,
  },
}

describe('overlayChildPreview · 时间轴预览', () => {
  it('battleHpBar 能渲出 DOM（overlay 表 + ctx resolve）', () => {
    const reg = createCoreSkinRegistry()
    const child = battleHpBarPreset('hp-player', { bind: 'ent-player', label: '我方' })
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 0) as ReactElement,
    )
    expect(html).toContain('ks-hud-hp')
    expect(html).toContain('我方')
  })

  it('敌方血条同样可预览', () => {
    const reg = createCoreSkinRegistry()
    const child = battleHpBarPreset('hp-boss', { bind: 'ent-boss', label: '敌方' })
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 0) as ReactElement,
    )
    expect(html).toContain('ks-hud-boss')
    expect(html).toContain('敌方')
  })
})

describe('overlayChildPreview · 泛用预览时钟（preview/previewTimeMs 透传）', () => {
  it('inkYingMo（挂了 window.startMs）：is-frozen + 按 localMs 算的 --preview-t，且按钮禁用', () => {
    const reg = createCoreSkinRegistry()
    const child = { ...inkYingMoPreset('c1'), window: { startMs: 1000 } }
    // 播放头 1300ms、child 于 1000ms 进场 → localMs = 300ms。
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 1300) as ReactElement,
    )
    expect(html).toContain('is-frozen')
    expect(html).toContain('--preview-t:300ms')
    expect(html).toContain('disabled=""')
  })

  it('inkKou（QTE cues 走 appearAt 绝对帧，无 window）：localMs 原样 = 播放头，不因引入时钟而漂移', () => {
    const reg = createCoreSkinRegistry()
    const child = inkKouPreset('c2')
    // 默认 cue：appearAt 0 ~ endAt 1000；playhead=400 落在窗内才会渲出按钮。
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 400) as ReactElement,
    )
    expect(html).toContain('is-frozen')
    expect(html).toContain('--preview-t:400ms')
  })
})
