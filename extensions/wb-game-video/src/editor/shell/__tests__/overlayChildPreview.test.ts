/**
 * 回归：时间轴预览必须能画挂载方案里的新规格组件。
 * 表现层统一走 overlay 表 + skinCtx 绘制时 resolve。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createCoreSkinRegistry, registerCoreSkins } from '../../../runtime/component-host/components'
import { renderOverlayChildPreview } from '../overlayChildPreview'
import type { SkinCtx } from '../../../runtime/component-host/rendererRegistry'
import type { OverlayChild } from '../../../runtime/schema/graph-schema'

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

function openingTagForClass(html: string, className: string): string {
  const classMarker = `class="${className}"`
  const classIndex = html.indexOf(classMarker)
  expect(classIndex).toBeGreaterThanOrEqual(0)
  const tagStart = html.lastIndexOf('<', classIndex)
  const tagEnd = html.indexOf('>', classIndex)
  return html.slice(tagStart, tagEnd + 1)
}

function expectFitTargetOn(html: string, className: string): void {
  expect(openingTagForClass(html, className)).toContain('data-overlay-fit-target="true"')
}

function expectPartialCurrentFill(html: string, className: string): void {
  const tag = openingTagForClass(html, className)
  expect(tag).toContain('style="width:')
  expect(tag).not.toContain('width:100%')
}

describe('overlayChildPreview · 时间轴预览', () => {
  it('我方新规格血条以完整血槽单元作为 fit target', () => {
    const reg = createCoreSkinRegistry()
    const child: OverlayChild = {
      id: 'hp-player',
      component: 'BattlePlayerHpBar',
      inputs: { current: 72, max: 100, label: '我方', qi: 3, qiMax: 5 },
    }
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 0) as ReactElement,
    )
    expect(html).toContain('ks-hud-hp')
    expect(html).toContain('我方')
    expectPartialCurrentFill(html, 'ks-hud-hp-fill me')
    expectFitTargetOn(html, 'ks-hud-hp ks-hud-me-unit')
  })

  it('敌方新规格血条以完整血槽单元作为 fit target', () => {
    const reg = createCoreSkinRegistry()
    const child: OverlayChild = {
      id: 'hp-boss',
      component: 'BattleEnemyHpBar',
      inputs: { current: 58, max: 100, label: '敌方' },
    }
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 0) as ReactElement,
    )
    expect(html).toContain('ks-hud-boss')
    expect(html).toContain('敌方')
    expectPartialCurrentFill(html, 'ks-hud-boss-fill foe')
    expectFitTargetOn(html, 'ks-hud-boss ks-hud-foe-unit')
  })

  it('伤害与增益飘字暂停时冻结在对应局部动画帧', () => {
    const reg = createCoreSkinRegistry()
    for (const component of ['DamageFloatText', 'GainFloatText']) {
      const child: OverlayChild = { id: component, component, inputs: {} }
      const html = renderToStaticMarkup(
        renderOverlayChildPreview(child, reg, ctx, 400) as ReactElement,
      )
      expect(html).toContain('is-preview-frozen')
      expect(html).toContain('--preview-t:400ms')
      expect(html).toContain('data-overlay-fit-target')
    }
  })

  it('伤害与增益飘字播放时执行与试玩相同的动画', () => {
    const reg = createCoreSkinRegistry()
    for (const component of ['DamageFloatText', 'GainFloatText']) {
      const child: OverlayChild = { id: component, component, inputs: {} }
      const html = renderToStaticMarkup(
        renderOverlayChildPreview(child, reg, ctx, 400, undefined, true) as ReactElement,
      )
      expect(html).not.toContain('is-preview-frozen')
      expect(html).not.toContain('--preview-t')
      expect(html).toContain('data-overlay-fit-target')
    }
  })
})

describe('overlayChildPreview · 泛用预览时钟（preview/previewTimeMs 透传）', () => {
  it('新规格 inkYingMo 预览冻结交互且按钮禁用', () => {
    const reg = createCoreSkinRegistry()
    const child: OverlayChild = { id: 'c1', component: 'InkYingMo', inputs: {}, window: { startMs: 1000 } }
    // 播放头 1300ms、child 于 1000ms 进场 → localMs = 300ms。
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 1300) as ReactElement,
    )
    expect(html).toContain('is-frozen')
    expect(html).toContain('--preview-t:300ms')
    expect(html).toContain('disabled=""')
  })

  it('新规格 inkKou 预览冻结交互', () => {
    const reg = createCoreSkinRegistry()
    const child: OverlayChild = { id: 'c2', component: 'InkKou', inputs: {} }
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 400) as ReactElement,
    )
    expect(html).toContain('is-frozen')
    expect(html).toContain('--preview-t:400ms')
    expect(html).toContain('disabled=""')
  })

  it('新规格 inkKou 播放预览时保留交互保护但不冻结动画', () => {
    const reg = createCoreSkinRegistry()
    const child: OverlayChild = { id: 'c3', component: 'InkKou', inputs: {} }
    const html = renderToStaticMarkup(
      renderOverlayChildPreview(child, reg, ctx, 400, undefined, true) as ReactElement,
    )
    expect(html).not.toContain('is-frozen')
    expect(html).not.toContain('--preview-t')
    expect(html).toContain('disabled=""')
  })
})
