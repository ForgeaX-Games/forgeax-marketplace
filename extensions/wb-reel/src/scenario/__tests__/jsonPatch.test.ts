/**
 * jsonPatch — RFC 6902 单元测试.
 *
 * 覆盖:
 *   - 6 种 op 的 happy path (add / remove / replace / move / copy / test)
 *   - 不可变性: 入参 doc 永远不被修改
 *   - 错误回滚: 任意一步失败抛 JsonPatchError, 调用方拿到原对象
 *   - RFC 6901 path 转义: ~0/~1
 *   - 数组的 "-" 追加 + 索引越界
 *   - isWellFormedPath 的几个 edge case
 */
import { describe, it, expect } from 'vitest'
import {
  applyJsonPatch,
  isWellFormedPath,
  JsonPatchError,
  type JsonPatchOp,
} from '../jsonPatch'

describe('applyJsonPatch · 基本 op', () => {
  it('add 在对象上插入新键', () => {
    const doc = { a: 1 }
    const next = applyJsonPatch(doc, [{ op: 'add', path: '/b', value: 2 }])
    expect(next).toEqual({ a: 1, b: 2 })
    expect(doc).toEqual({ a: 1 }) // 入参不变
  })

  it('add 在数组上按索引插入 (不是替换)', () => {
    const doc = { xs: [1, 2, 3] }
    const next = applyJsonPatch(doc, [{ op: 'add', path: '/xs/1', value: 99 }])
    expect(next).toEqual({ xs: [1, 99, 2, 3] })
  })

  it('add 用 "-" 在数组尾部追加', () => {
    const doc = { xs: [1, 2] }
    const next = applyJsonPatch(doc, [{ op: 'add', path: '/xs/-', value: 9 }])
    expect(next).toEqual({ xs: [1, 2, 9] })
  })

  it('replace 替换已存在的键 / 数组元素', () => {
    const doc = { a: 1, xs: [1, 2, 3] }
    const next = applyJsonPatch(doc, [
      { op: 'replace', path: '/a', value: 10 },
      { op: 'replace', path: '/xs/2', value: 30 },
    ])
    expect(next).toEqual({ a: 10, xs: [1, 2, 30] })
  })

  it('replace 不存在的键报错', () => {
    const doc = { a: 1 }
    expect(() =>
      applyJsonPatch(doc, [{ op: 'replace', path: '/missing', value: 1 }]),
    ).toThrow(JsonPatchError)
  })

  it('remove 删对象键 / 数组元素', () => {
    const doc = { a: 1, xs: [1, 2, 3] }
    const next = applyJsonPatch(doc, [
      { op: 'remove', path: '/a' },
      { op: 'remove', path: '/xs/0' },
    ])
    expect(next).toEqual({ xs: [2, 3] })
  })

  it('remove 不能删根', () => {
    expect(() => applyJsonPatch({ a: 1 }, [{ op: 'remove', path: '' }])).toThrow(
      JsonPatchError,
    )
  })

  it('move 把字段挪到别处', () => {
    const doc = { a: { x: 1 }, b: {} }
    const next = applyJsonPatch(doc, [
      { op: 'move', from: '/a/x', path: '/b/y' },
    ])
    expect(next).toEqual({ a: {}, b: { y: 1 } })
  })

  it('copy 把值拷一份到别处 (深拷, 不共享引用)', () => {
    const doc = { a: { nested: { v: 1 } }, b: {} }
    const next = applyJsonPatch(doc, [
      { op: 'copy', from: '/a', path: '/b/clone' },
    ]) as { a: { nested: { v: number } }; b: { clone: { nested: { v: number } } } }
    expect(next.b.clone).toEqual({ nested: { v: 1 } })
    // 改了源不影响目标 (验证深拷)
    expect(next.b.clone).not.toBe(next.a)
    expect(next.b.clone.nested).not.toBe(next.a.nested)
  })

  it('test 通过则不动文档, 失败则抛错', () => {
    const doc = { a: 1 }
    const next = applyJsonPatch(doc, [{ op: 'test', path: '/a', value: 1 }])
    expect(next).toEqual(doc)
    expect(() =>
      applyJsonPatch(doc, [{ op: 'test', path: '/a', value: 2 }]),
    ).toThrow(JsonPatchError)
  })
})

describe('applyJsonPatch · 整批原子性', () => {
  it('中间任一 op 失败, 整批回滚 (调用方拿到错, 不会拿到半截结果)', () => {
    const doc = { a: 1, b: 2 }
    let caught: unknown = null
    try {
      applyJsonPatch(doc, [
        { op: 'replace', path: '/a', value: 10 },
        { op: 'replace', path: '/missing', value: 999 }, // ← 第 2 步失败
      ])
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(JsonPatchError)
    expect(doc).toEqual({ a: 1, b: 2 }) // 原对象未被污染
  })

  it('JsonPatchError 上能拿到出错的 opIndex 和 op', () => {
    const ops: JsonPatchOp[] = [
      { op: 'add', path: '/a', value: 1 },
      { op: 'remove', path: '/no-such-key' },
    ]
    try {
      applyJsonPatch({}, ops)
      throw new Error('应该抛 JsonPatchError')
    } catch (e) {
      expect(e).toBeInstanceOf(JsonPatchError)
      const err = e as JsonPatchError
      expect(err.opIndex).toBe(1)
      expect(err.op).toEqual(ops[1])
    }
  })
})

describe('applyJsonPatch · RFC 6901 path 转义', () => {
  it('~1 → / 和 ~0 → ~ 能正确解码', () => {
    // 键里既有 / 又有 ~ 的 corner case
    const doc = { 'a/b': 1, 'c~d': 2 }
    const next = applyJsonPatch(doc, [
      { op: 'replace', path: '/a~1b', value: 11 },
      { op: 'replace', path: '/c~0d', value: 22 },
    ])
    expect(next).toEqual({ 'a/b': 11, 'c~d': 22 })
  })

  it('"~01" 解码顺序: ~1 必须先于 ~0, 这里期望解出 "~1" (字符串)', () => {
    // 按 RFC 6901: 先把 ~1 替成 /, 再把 ~0 替成 ~
    // 所以 "~01" 解出来是 "~" + "1" = "~1"
    const doc = { '~1': 'hit' }
    const next = applyJsonPatch(doc, [
      { op: 'replace', path: '/~01', value: 'updated' },
    ])
    expect(next).toEqual({ '~1': 'updated' })
  })
})

describe('applyJsonPatch · 数组边界', () => {
  it('add 到 length 位置 = 追加 (合法)', () => {
    const doc = { xs: [1, 2] }
    const next = applyJsonPatch(doc, [{ op: 'add', path: '/xs/2', value: 3 }])
    expect(next).toEqual({ xs: [1, 2, 3] })
  })

  it('add 到 length+1 位置越界, 报错', () => {
    expect(() =>
      applyJsonPatch({ xs: [1, 2] }, [{ op: 'add', path: '/xs/5', value: 9 }]),
    ).toThrow(JsonPatchError)
  })

  it('replace 数组元素必须 < length', () => {
    expect(() =>
      applyJsonPatch({ xs: [1, 2] }, [
        { op: 'replace', path: '/xs/2', value: 9 },
      ]),
    ).toThrow(JsonPatchError)
  })

  it('数组索引必须是非负整数', () => {
    expect(() =>
      applyJsonPatch({ xs: [1, 2] }, [
        { op: 'replace', path: '/xs/abc', value: 9 },
      ]),
    ).toThrow(JsonPatchError)
  })
})

describe('applyJsonPatch · 整文档操作', () => {
  it('path = "" 的 replace 等于整体替换', () => {
    const next = applyJsonPatch({ a: 1 }, [
      { op: 'replace', path: '', value: { b: 2 } },
    ])
    expect(next).toEqual({ b: 2 })
  })
})

describe('isWellFormedPath', () => {
  it.each([
    ['', true],
    ['/a', true],
    ['/a/b/c', true],
    ['/a~1b', true],
    ['relative', false],
    ['/a/../b', false],
    ['/a/b/c/d/e/f/g/h/i', false], // 9 层 > 8
  ])('path=%s → %s', (path, ok) => {
    expect(isWellFormedPath(path)).toBe(ok)
  })
})
