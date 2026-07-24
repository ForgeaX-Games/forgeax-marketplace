/**
 * 叙事段 demo 契约回归 —— 对齐
 * docs/superpowers/specs/2026-07-03-nodia-narrative-intro-design.md
 * + scripts/nodia-narrative/story-scenes.ts（应默：片尾前 3s 弹出，timeout 8s）。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { makeNodiaDemo } from '../../editor/demo/demo'
import { registerCoreSkins } from '../component-host/components'
import { inkYingMoDefaults } from '../component-host/components/InkYingMoLayer'

beforeAll(() => {
  registerCoreSkins()
})

const YINGMO_NODES = ['n_river', 'n_land', 'n_tea', 'n_nodrink', 'n_follow', 'n_nofollow'] as const

describe('nodia narrative demo contract', () => {
  it('應/默 锚点为下方中央 (0.5, 0.88)，键位 E/Q；片尾前 3s 弹出', () => {
    expect(inkYingMoDefaults.x).toBe(0.5)
    expect(inkYingMoDefaults.y).toBe(0.88)
    const scn = makeNodiaDemo()
    for (const id of YINGMO_NODES) {
      const child = scn.ui?.overlays?.[id]?.children?.[0]
      const dur = scn.graph.nodes.find((n) => n.id === id)?.data.durationMs
      expect(typeof dur, id).toBe('number')
      expect(child?.component, id).toBe('inkYingMo')
      expect(child?.inputs?.x, id).toBe(0.5)
      expect(child?.inputs?.y, id).toBe(0.88)
      // 对齐 story-scenes：windowStartMs = dur - 3000（不是 video_end 才挂）
      expect(child?.trigger, id).toEqual({ when: 'at', ms: (dur as number) - 3000 })
      expect(child?.inputs?.timeoutMs, id).toBe(8000)
      expect(child?.inputs?.defaultEvent, id).toBe('mo')
      expect((child?.inputs?.events as { id: string; label?: string }[] | undefined)?.map((e) => e.label), id).toEqual([
        '應',
        '默',
      ])
    }
  })

  it('叩门：随节点进入挂载（cue 0–6.1s 驱动显隐），锚点 (0.58, 0.39)', () => {
    const scn = makeNodiaDemo()
    const child = scn.ui?.overlays?.n_door?.children?.[0]
    expect(child?.component).toBe('inkKou')
    // trigger 对齐到 cue 起点：随节点进入挂载，可见窗完全由 cues 决定（appearAt 0 → endAt 6100），
    // 预览与运行时同源，不再有 trigger.ms=9000 残留导致的 9s 错位。
    expect(child?.trigger).toEqual({ when: 'enter' })
    const cue = (child?.inputs?.cues as { x?: number; y?: number; appearAt?: number; endAt?: number }[] | undefined)?.[0]
    expect(cue?.x).toBe(0.58)
    expect(cue?.y).toBe(0.39)
    expect(cue?.appearAt).toBe(0)
    expect(cue?.endAt).toBe(6100)
  })

  it('拓扑：上岸 應→灯笼 / 默→孟婆；渡河 應→小孩 / 默→上岸', () => {
    const scn = makeNodiaDemo()
    const edges = scn.graph.edges
    const of = (src: string) =>
      edges.filter((e) => e.source === src).map((e) => [e.sourceHandle ?? 'default', e.target] as const)
    expect(new Set(of('n_land'))).toEqual(
      new Set([
        ['ying', 'n_mask'],
        ['mo', 'n_mengpo'],
      ]),
    )
    expect(new Set(of('n_river'))).toEqual(
      new Set([
        ['ying', 'n_child'],
        ['mo', 'n_land'],
      ]),
    )
  })
})
