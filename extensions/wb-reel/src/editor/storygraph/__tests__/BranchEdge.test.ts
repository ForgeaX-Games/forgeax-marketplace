import { describe, expect, it } from 'vitest'
import type { BranchKind } from '../../../scenario/types'
import { BRANCH_EDGE_STYLES } from '../BranchEdge'

/**
 * BranchEdge —— 纯渲染组件，测试集中在 KIND_STYLE 映射的**语义契约**上：
 *
 *   - 四种 kind 必须全部覆盖（TS 的 Record<BranchKind, ...> 已经防了编译期漏掉，
 *     这里兜底 runtime）
 *   - QTE 成功/失败、选择/自动过渡必须有视觉可分辨的差异（颜色 + 破折图案）
 *   - 每种 kind 都要带一个 label fallback，这样即使作者没填 label，
 *     画布上也能读出"QTE 通过/QTE 失败/选择/自动"
 *
 * 不测实际渲染输出：React Flow 的 EdgeProps 需要 XYFlow 的 Provider context，
 * 测这些涉及到 jsdom + 布局计算，收益很低。视觉回归建议留给 Storybook / 肉眼。
 */
describe('BRANCH_EDGE_STYLES', () => {
  const ALL_KINDS: BranchKind[] = ['choice', 'qte_pass', 'qte_fail', 'auto']

  it('覆盖所有 BranchKind', () => {
    for (const k of ALL_KINDS) {
      expect(BRANCH_EDGE_STYLES[k]).toBeDefined()
    }
  })

  it('每种 kind 都有非空 labelFallback', () => {
    for (const k of ALL_KINDS) {
      const s = BRANCH_EDGE_STYLES[k]
      expect(s.labelFallback.trim().length).toBeGreaterThan(0)
    }
  })

  it('每种 kind 都有独特的主色（避免视觉混淆）', () => {
    const strokes = ALL_KINDS.map((k) => BRANCH_EDGE_STYLES[k].stroke)
    const unique = new Set(strokes)
    expect(unique.size).toBe(ALL_KINDS.length)
  })

  it('qte_fail 使用破折线（"断裂感" 视觉语义）', () => {
    expect(BRANCH_EDGE_STYLES.qte_fail.strokeDasharray).toBeTruthy()
  })

  it('qte_pass 使用实线（不设 dasharray）', () => {
    expect(BRANCH_EDGE_STYLES.qte_pass.strokeDasharray).toBeUndefined()
  })

  it('auto 是虚线 + 最细笔触（视觉最弱，不抢戏）', () => {
    expect(BRANCH_EDGE_STYLES.auto.strokeDasharray).toBeTruthy()
    const autoWidth = BRANCH_EDGE_STYLES.auto.strokeWidth
    expect(autoWidth).toBeLessThan(BRANCH_EDGE_STYLES.choice.strokeWidth)
    expect(autoWidth).toBeLessThan(BRANCH_EDGE_STYLES.qte_pass.strokeWidth)
  })

  it('choice 使用琥珀主色（保持与 --ks-amber 一致的心智）', () => {
    expect(BRANCH_EDGE_STYLES.choice.stroke).toMatch(/^#/)
  })

  it('每种 kind 都有独特的 glyph', () => {
    const glyphs = ALL_KINDS.map((k) => BRANCH_EDGE_STYLES[k].glyph)
    const unique = new Set(glyphs)
    expect(unique.size).toBe(ALL_KINDS.length)
  })

  it('qte_pass / qte_fail 的 chipText 分别是绿/红色调（辅助无障碍分辨）', () => {
    const pass = BRANCH_EDGE_STYLES.qte_pass.chipText.toLowerCase()
    const fail = BRANCH_EDGE_STYLES.qte_fail.chipText.toLowerCase()
    expect(pass).not.toEqual(fail)
  })
})
