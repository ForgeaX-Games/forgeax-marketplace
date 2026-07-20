import { describe, it, expect } from 'vitest'
import {
  placeholderBgClass,
  PLACEHOLDER_BG_ANIMATION_NONE,
} from '../placeholderBg'

/**
 * 视觉回归：IMAGE_PROMPT 场景没有预生成图时，Player 会渲染占位底。
 * 曾经 pending/error 态叠着 4s 循环的扫描条动画 + 青蓝径向渐变，
 * 切场景时看起来是"一直闪蓝"。本测试锁住三条契约：
 *   1) 状态 → class 的映射是纯函数
 *   2) pending 态不应自带会周期切换亮度/位置的动画（否则 = 闪）
 *   3) error 态同理
 */
describe('placeholderBg', () => {
  it('idle → 基础 class，无 status modifier', () => {
    expect(placeholderBgClass('idle')).toBe('ks-player-bg')
  })

  it('pending → 加 is-pending，但不加 pulse/scan animation class', () => {
    const cls = placeholderBgClass('pending')
    expect(cls).toContain('is-pending')
    expect(cls).not.toMatch(/pulse|scan|blink|flash/i)
  })

  it('error → 加 is-error，同样静止', () => {
    const cls = placeholderBgClass('error')
    expect(cls).toContain('is-error')
    expect(cls).not.toMatch(/pulse|scan|blink|flash/i)
  })

  it('pending/error 的 CSS animation 属性必须是 none', () => {
    expect(PLACEHOLDER_BG_ANIMATION_NONE).toBe('none')
  })
})
