import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../BlueprintGameplayPanel.tsx'),
  'utf8',
)

describe('BlueprintGameplayPanel presentation controls', () => {
  it('exposes battle skill bar as a first-class choice UI control backed by ext.choiceUi', () => {
    expect(SOURCE).toContain('setChoiceUi')
    expect(SOURCE).toContain('choiceUi')
    expect(SOURCE).toContain('battleSkillBar')
    expect(SOURCE).toContain('战斗技能栏')
  })

  it('keeps gameplay panel focused — no subflow return / video gen / ext editor blocks', () => {
    expect(SOURCE).not.toContain('function VideoGenSection')
    expect(SOURCE).not.toContain('function ExtAttrsSection')
    expect(SOURCE).not.toContain('returnsToCaller: e.target.checked')
    expect(SOURCE).not.toContain('>视频生成<')
    expect(SOURCE).not.toContain('>扩展属性<')
  })

  it('exposes battle parry as a first-class QTE UI control backed by ext.qteUi', () => {
    expect(SOURCE).toContain('setQteUi')
    expect(SOURCE).toContain('qteUi')
    expect(SOURCE).toContain('battleParry')
    expect(SOURCE).toContain('战斗防反按键')
  })

  it('maps prototype calc group to scene.calcType with readonly settlement preview', () => {
    expect(SOURCE).toContain('function CalcSection')
    expect(SOURCE).toContain('计算类型')
    expect(SOURCE).toContain('scene.calcType')
    expect(SOURCE).toContain('listPerformanceSettlements')
    expect(SOURCE).toContain('branchOutcomeLabels')
    expect(SOURCE).toContain('演出飘字')
    expect(SOURCE).not.toContain('PerformanceCuesSection')
    expect(SOURCE).not.toContain('>判定<')
  })

  it('routes time/visual option fields to video timeline, not blueprint panel', () => {
    expect(SOURCE).not.toContain('function ChoiceHotspotsSection')
    expect(SOURCE).not.toContain('windowStartMs: e.target.value')
    expect(SOURCE).not.toContain('windowEndMs: e.target.value')
    expect(SOURCE).toContain('时间轴选中「选项」控件编辑')
    expect(SOURCE).toContain('QTE 窗口')
  })

  it('labels timed_qte section as QTE interaction not choice list', () => {
    expect(SOURCE).toContain("'timed_qte' ? 'QTE 交互'")
    expect(SOURCE).toContain('QTE 按键点')
  })

  it('shows QTE branches and read-only cue list for timed_qte nodes', () => {
    expect(SOURCE).toContain("b.kind === 'qte_pass' || b.kind === 'qte_fail'")
    expect(SOURCE).toContain('ks-bgp-qte-cue-list')
    expect(SOURCE).toContain('判定针对')
    expect(SOURCE).toContain('battleParryMultiCue')
  })

  it('supports VarEffect.once toggle in numeric attrs section', () => {
    expect(SOURCE).toContain('once: once || undefined')
    expect(SOURCE).toContain('首次')
  })

  it('exposes ink narrative variants (inkKou / inkYingMo / narrative)', () => {
    expect(SOURCE).toContain('inkKou')
    expect(SOURCE).toContain('inkYingMo')
    expect(SOURCE).toContain('narrative')
    expect(SOURCE).toContain('叩')       // qteUi option 文案
    expect(SOURCE).toContain('应默')     // choiceUi option 文案
  })
})
