import { describe, it, expect } from 'vitest'
import { normalizeBlockout, normalizeTransform } from '../normalizeBlockout'

describe('normalizeBlockout', () => {
  it('相机按 order 升序稳定排序并重排 order（同 order 保持输入序）', () => {
    const b = normalizeBlockout({
      id: 'b1',
      name: 'x',
      objects: [],
      cameras: [
        { id: 'c2', order: 5, name: 'B', transform: {}, fovMm: 35, framing: 'medium', move: 'static' },
        { id: 'c1', order: 5, name: 'A', transform: {}, fovMm: 35, framing: 'medium', move: 'static' },
        { id: 'c0', order: 1, name: 'Z', transform: {}, fovMm: 35, framing: 'medium', move: 'static' },
      ],
    })
    expect(b.cameras.map((c) => c.id)).toEqual(['c0', 'c2', 'c1'])
    expect(b.cameras.map((c) => c.order)).toEqual([0, 1, 2])
  })

  it('linkedAnchor 指向不存在的角色 → 置空但保留对象', () => {
    const b = normalizeBlockout(
      {
        id: 'b',
        name: '',
        cameras: [],
        objects: [
          {
            id: 'o1',
            kind: 'capsule',
            transform: {},
            linkedAnchor: { kind: 'character', id: 'missing' },
          },
        ],
      },
      { validCharacterIds: new Set<string>() },
    )
    expect(b.objects).toHaveLength(1)
    expect(b.objects[0].linkedAnchor).toBeUndefined()
  })

  it('linkedAnchor 指向存在角色 → 保留', () => {
    const b = normalizeBlockout(
      {
        id: 'b',
        name: '',
        cameras: [],
        objects: [{ id: 'o1', kind: 'capsule', transform: {}, linkedAnchor: { kind: 'character', id: 'char-li' } }],
      },
      { validCharacterIds: new Set(['char-li']) },
    )
    expect(b.objects[0].linkedAnchor).toEqual({ kind: 'character', id: 'char-li' })
  })

  it('未提供有效集合时不校验 anchor（保留）', () => {
    const b = normalizeBlockout({
      id: 'b',
      name: '',
      cameras: [],
      objects: [{ id: 'o1', kind: 'box', transform: {}, linkedAnchor: { kind: 'prop', id: 'whatever' } }],
    })
    expect(b.objects[0].linkedAnchor).toEqual({ kind: 'prop', id: 'whatever' })
  })

  it('补默认 transform（pos0 / rot0 / scale1）', () => {
    const b = normalizeBlockout({ id: 'b', name: '', cameras: [], objects: [{ id: 'o', kind: 'box' }] })
    expect(b.objects[0].transform).toEqual({
      pos: { x: 0, y: 0, z: 0 },
      rot: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
  })

  it('丢弃缺 id/非法 kind 的对象、缺 id 的相机', () => {
    const b = normalizeBlockout({
      id: 'b',
      name: '',
      objects: [{ kind: 'box' }, { id: 'ok', kind: 'box' }, { id: 'bad', kind: 'pyramid' }],
      cameras: [{ order: 0 }, { id: 'cam', order: 0 }],
    })
    expect(b.objects.map((o) => o.id)).toEqual(['ok'])
    expect(b.cameras.map((c) => c.id)).toEqual(['cam'])
  })

  it('相机非法 framing/move 回落默认', () => {
    const b = normalizeBlockout({
      id: 'b',
      name: '',
      objects: [],
      cameras: [{ id: 'c', order: 0, framing: 'nope', move: 'zoom-blur' }],
    })
    expect(b.cameras[0].framing).toBe('medium')
    expect(b.cameras[0].move).toBe('static')
    expect(b.cameras[0].fovMm).toBe(35)
  })

  it('normalizeTransform 单独可用', () => {
    expect(normalizeTransform({ pos: { x: 2 } })).toEqual({
      pos: { x: 2, y: 0, z: 0 },
      rot: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
  })
})
