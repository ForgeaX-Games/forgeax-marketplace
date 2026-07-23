/**
 * 回归：试玩里「选项/QTE 挂起，静态方案 HUD + 时间轴飘字全没了」。
 *
 * 根因（已修）：
 * 1) enter 碰交互就 break → 挂载顺序靠后的 scheme-static 血条被吞；
 * 2) tick 在非 playing 时直接 return → 带 window 的飘字永远不亮；
 * 3) runElement 在已 await 时 early-return → 即便 tickWindows 跑了也不发 renderOverlay。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { GraphSession } from '../engine/session'
import { ensureBuiltinSchemes, SCHEME_STATIC_ID } from '../../editor/demo/builtin-schemes'
import { registerCoreSkins } from '../component-host/components'
import { node, scnOf } from './test-fixtures'

beforeAll(() => {
  registerCoreSkins()
})

describe('试玩 · 交互挂起时仍见方案 HUD 与时间窗飘字', () => {
  it('enter：交互在前、静态方案在后 → 血条仍进 overlayMounts', () => {
    const overlays = ensureBuiltinSchemes({})
    const n = node('a', {
      durationMs: 8000,
      media: { kind: 'VIDEO', ref: 'clip' },
      overlayNodes: [
        { overlay: 'ov-a' },
        { overlay: SCHEME_STATIC_ID },
      ],
    })
    const scn = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            ...overlays,
            'ov-a': {
              id: 'ov-a',
              children: [
                {
                  id: 'choice',
                  component: 'choice',
                  trigger: { when: 'enter' },
                  inputs: {
                    events: [
                      { id: 'a', label: 'A' },
                      { id: 'b', label: 'B' },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    )

    const session = new GraphSession(scn)
    const snap = session.start()
    expect(snap.phase).toBe('playing')
    const hud = snap.overlayMounts
      .flatMap((m) => m.children)
      .filter((c) => c.component === 'battleHpBar')
    expect(hud.map((c) => c.inputs.bind).sort()).toEqual(['ent-boss', 'ent-player'])
  })

  it('tick：playing 期间 window 飘字仍会进 overlayMounts', () => {
    const n = node('a', {
      durationMs: 8000,
      media: { kind: 'VIDEO', ref: 'clip' },
      timeline: [
        {
          id: 'choice',
          component: 'choice',
          trigger: { when: 'enter' },
          inputs: {
            events: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        },
        {
          id: 'float',
          component: 'floatText',
          trigger: { when: 'enter' },
          window: { startMs: 500, endMs: 2500 },
          inputs: { text: '-100', x: 0.5, y: 0.4 },
        },
      ],
    })
    const scn = scnOf({ nodes: [n], edges: [] })
    const session = new GraphSession(scn)
    const startSnap = session.start()
    expect(startSnap.phase).toBe('playing')
    expect(
      startSnap.overlayMounts.flatMap((m) => m.children).some((c) => c.component === 'floatText'),
    ).toBe(false)

    const after = session.tick(600)
    expect(after.phase).toBe('playing')
    const floats = after.overlayMounts
      .flatMap((m) => m.children)
      .filter((c) => c.component === 'floatText')
    expect(floats).toHaveLength(1)
    expect(floats[0]?.inputs.text).toBe('-100')
  })
})
