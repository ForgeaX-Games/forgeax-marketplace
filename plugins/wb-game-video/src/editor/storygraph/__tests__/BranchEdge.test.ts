import { describe, expect, it } from 'vitest'
import type { BranchKind } from '../../../scenario/types'
import {
  BRANCH_EDGE_STYLES,
  UNIFIED_BRANCH_EDGE_STYLE,
  resolveBranchEdgeStyle,
} from '../BranchEdge'

/**
 * BranchEdge —— 纯渲染组件；测试集中在统一连线样式的契约上。
 *
 * 视频游戏里分支只是「连到哪个 scene」，视觉上不再按 qte_pass/fail 分色。
 * branch.kind 仍保留在数据里供运行时路由。
 */
describe('BranchEdge styles', () => {
  const ALL_KINDS: BranchKind[] = ['choice', 'qte_pass', 'qte_fail', 'auto']

  it('覆盖所有 BranchKind', () => {
    for (const k of ALL_KINDS) {
      expect(BRANCH_EDGE_STYLES[k]).toBeDefined()
    }
  })

  it('各 kind 映射到原型连线色 #9aa7b4', () => {
    for (const k of ALL_KINDS) {
      expect(resolveBranchEdgeStyle(k).stroke).toBe('#9aa7b4')
      expect(resolveBranchEdgeStyle(k).strokeWidth).toBe(2.5)
    }
  })

  it('不在连线上放 glyph / labelFallback', () => {
    for (const k of ALL_KINDS) {
      const s = BRANCH_EDGE_STYLES[k]
      expect(s.glyph).toBe('')
      expect(s.labelFallback).toBe('')
    }
  })

  it('统一为实线（不设 dasharray）', () => {
    for (const k of ALL_KINDS) {
      expect(resolveBranchEdgeStyle(k).strokeDasharray).toBeUndefined()
    }
  })
})
