/**
 * 叙事段 demo 契约回归 —— 对齐
 * docs/superpowers/specs/2026-07-03-nodia-narrative-intro-design.md
 * + scripts/nodia-narrative/story-scenes.ts（应默：片尾前 3s 弹出，timeout 8s）。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { makeNodiaDemo } from '../../editor/demo/demo'
import { inkYingMoComponent, registerCoreSkins } from '../component-host/components'
import { nodeOverlayChildren } from '../schema/expand-overlay'

beforeAll(() => {
  registerCoreSkins()
})

const YINGMO_NODES = ['n_river', 'n_land', 'n_tea', 'n_nodrink', 'n_follow', 'n_nofollow'] as const
const DAZHAO_RESOURCE_ID = 'dazhao'

function collectMediaRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectMediaRefs(item, refs)
    return refs
  }
  if (!value || typeof value !== 'object') return refs
  const record = value as Record<string, unknown>
  const media = record.media
  if (media && typeof media === 'object') {
    const ref = (media as Record<string, unknown>).ref
    if (typeof ref === 'string') refs.push(ref)
  }
  for (const child of Object.values(record)) collectMediaRefs(child, refs)
  return refs
}

describe('nodia narrative demo contract', () => {
  it('重置模板使用扩展自带视频 basename，不依赖 Kino/COS resource id', () => {
    const refs = collectMediaRefs(makeNodiaDemo())
    expect(refs).toContain(DAZHAO_RESOURCE_ID)
    expect(refs.filter((ref) => ref.startsWith('narr-')).length).toBeGreaterThan(0)
  })

  it('新规格 應/默 使用静态事件契约与 layout；片尾前 3s 弹出', () => {
    expect(inkYingMoComponent.events?.map((event) => event.id)).toEqual(['ying', 'mo'])
    const scn = makeNodiaDemo()
    for (const id of YINGMO_NODES) {
      const node = scn.graph.nodes.find((n) => n.id === id)
      // 6 节点已归一到共享 base:inkYingMo 方案；各自的「片尾前 3s」时机（dur-3000）落在挂载的
      // overrides 里，故读**展开后**的挂载 child（经 resolveMountChildren 套用 override），而不是
      // scn.ui.overlays[id]（该 per-node 方案已不复存在）。
      const child = nodeOverlayChildren(scn, node)[0]
      const dur = node?.data.durationMs
      expect(typeof dur, id).toBe('number')
      expect(child?.component, id).toBe('inkYingMo')
      expect(child?.layout, id).toMatchObject({ left: 0, top: 0, width: 1, height: 1 })
      // 对齐 story-scenes：windowStartMs = dur - 3000（不是 video_end 才挂）
      expect(child?.trigger, id).toEqual({ when: 'at', ms: (dur as number) - 3000 })
    }
  })

  it('叩门：随节点进入挂载（cue 0–6.1s 驱动显隐），锚点 (0.58, 0.39)', () => {
    const scn = makeNodiaDemo()
    const node = scn.graph.nodes.find((n) => n.id === 'n_door')
    const child = nodeOverlayChildren(scn, node)[0]
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
