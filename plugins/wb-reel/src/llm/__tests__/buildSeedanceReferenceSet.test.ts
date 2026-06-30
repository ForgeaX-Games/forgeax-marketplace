import { describe, it, expect } from 'vitest'
import {
  buildSeedanceReferenceSet,
  type BuildSeedanceRefArgs,
} from '../buildSeedanceReferenceSet'
import { getCapability } from '../modelCapabilities'

const cap = getCapability('seedance-doubao') // maxRefImages = 9

/** url 解析器：mediaId 直接当作 `https://m/<id>` 返回；以 `MISSING` 开头则返回 undefined。 */
const resolveUrl = (id: string) => (id.startsWith('MISSING') ? undefined : `https://m/${id}`)

function args(partial: Partial<BuildSeedanceRefArgs>): BuildSeedanceRefArgs {
  return {
    characters: [],
    mode: 'multimodal',
    cap,
    resolveUrl,
    ...partial,
  }
}

describe('buildSeedanceReferenceSet', () => {
  it('单角色 → 大头照 ord=1、全身照 ord=2，subject 绑定正确', () => {
    const set = buildSeedanceReferenceSet(
      args({
        characters: [{ id: 'c1', name: '李建', headshotMediaId: 'h1', fullbodyMediaId: 'f1' }],
      }),
    )
    expect(set.images).toHaveLength(2)
    expect(set.images[0]).toMatchObject({ ord: 1, charRole: 'headshot', subject: '李建' })
    expect(set.images[1]).toMatchObject({ ord: 2, charRole: 'fullbody', subject: '李建' })
    expect(set.subjects).toEqual([{ subject: '李建', headshotOrd: 1, fullbodyOrd: 2 }])
  })

  it('重要素材前置：全部大头照排在全身照之前，再到关键帧/场景/道具/展位', () => {
    const set = buildSeedanceReferenceSet(
      args({
        characters: [
          { id: 'c1', name: '甲', headshotMediaId: 'h1', fullbodyMediaId: 'f1' },
          { id: 'c2', name: '乙', headshotMediaId: 'h2', fullbodyMediaId: 'f2' },
        ],
        keyframeMediaId: 'kf',
        location: { id: 'loc', mediaId: 'locimg', name: '楼道' },
        props: [{ id: 'p1', name: '钥匙', mediaId: 'propimg' }],
        blockoutStillMediaId: 'bo',
      }),
    )
    const order = set.images.map((i) => `${i.kind}:${i.charRole ?? ''}`)
    expect(order).toEqual([
      'character:headshot',
      'character:headshot',
      'character:fullbody',
      'character:fullbody',
      'keyframe:',
      'location:',
      'prop:',
      'blockout:',
    ])
    // ord 连续 1..N
    expect(set.images.map((i) => i.ord)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('写实角色 → realisticFace=true；非写实 → false', () => {
    const set = buildSeedanceReferenceSet(
      args({
        characters: [
          { id: 'c1', name: '真', headshotMediaId: 'h1', realistic: true },
          { id: 'c2', name: '漫', headshotMediaId: 'h2', realistic: false },
        ],
      }),
    )
    expect(set.images.find((i) => i.subject === '真')?.realisticFace).toBe(true)
    expect(set.images.find((i) => i.subject === '漫')?.realisticFace).toBe(false)
  })

  it('startEnd 模式：关键帧落 first_frame，不混入锚点图并告警', () => {
    const set = buildSeedanceReferenceSet(
      args({
        mode: 'startEnd',
        keyframeMediaId: 'kf',
        characters: [{ id: 'c1', name: '甲', headshotMediaId: 'h1' }],
        location: { id: 'loc', mediaId: 'locimg' },
      }),
    )
    expect(set.images).toHaveLength(1)
    expect(set.images[0]).toMatchObject({ frameRole: 'first_frame', kind: 'keyframe', ord: 1 })
    expect(set.subjects).toEqual([])
    expect(set.droppedReasons.some((r) => r.includes('互斥'))).toBe(true)
  })

  it('超过 maxRefImages 按优先级截断并记 droppedReasons', () => {
    // 10 个角色大头照，上限 9 → 截断 1 张
    const characters = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      name: `角色${i}`,
      headshotMediaId: `h${i}`,
    }))
    const set = buildSeedanceReferenceSet(args({ characters }))
    expect(set.images).toHaveLength(9)
    expect(set.droppedReasons.some((r) => r.includes('超过上限'))).toBe(true)
    // 被截断角色不应出现在 subjects
    expect(set.subjects).toHaveLength(9)
  })

  it('缺 mediaId / 取不到 url 的锚点静默跳过并告警', () => {
    const set = buildSeedanceReferenceSet(
      args({
        characters: [
          { id: 'c1', name: '甲', headshotMediaId: 'MISSING-1', fullbodyMediaId: 'f1' },
        ],
        location: { id: 'loc' }, // 无 mediaId
      }),
    )
    // 大头照取不到 → 只剩全身照
    expect(set.images).toHaveLength(1)
    expect(set.images[0]).toMatchObject({ charRole: 'fullbody', ord: 1 })
    expect(set.subjects).toEqual([{ subject: '甲', headshotOrd: undefined, fullbodyOrd: 1 }])
    expect(set.droppedReasons.some((r) => r.includes('取不到 url'))).toBe(true)
  })

  it('展位静帧永远是 reference_image（防白模泄漏，不进 first_frame）', () => {
    const set = buildSeedanceReferenceSet(args({ blockoutStillMediaId: 'bo' }))
    expect(set.images).toHaveLength(1)
    expect(set.images[0]).toMatchObject({ kind: 'blockout', frameRole: 'reference_image' })
  })

  it('空输入 → 空集合，不抛错', () => {
    const set = buildSeedanceReferenceSet(args({}))
    expect(set.images).toEqual([])
    expect(set.subjects).toEqual([])
  })
})
