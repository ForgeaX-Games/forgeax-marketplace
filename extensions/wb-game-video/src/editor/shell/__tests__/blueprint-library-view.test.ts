/**
 * BlueprintLibraryView 的纯派生逻辑测试。不 mount 组件本体（它内嵌 GraphStudio →
 * @xyflow 画布/视频，happy-dom 下无法干净渲染）——只测 `blueprintListItems` 这个
 * 导出的纯函数（左列表排序/入口标签），加一个「模块可正常 import、导出是函数」的
 * 轻量冒烟。真正的交互覆盖交给 Task 7 的 store action 测试。
 */
import { describe, it, expect } from 'vitest'
import { blueprintListItems, BlueprintLibraryView } from '../BlueprintLibraryView'
import type { BlueprintDoc } from '../../../runtime/schema/graph-schema'

function doc(id: string, title: string): BlueprintDoc {
  return { id, title, entry: 'entry', graph: { nodes: [], edges: [] } }
}

describe('blueprintListItems', () => {
  it('puts the main blueprint first with an entry badge', () => {
    const blueprints: Record<string, BlueprintDoc> = {
      'bp-b': doc('bp-b', 'B 蓝图'),
      'bp-main': doc('bp-main', '主蓝图'),
      'bp-a': doc('bp-a', 'A 蓝图'),
    }
    const items = blueprintListItems(blueprints, 'bp-main')
    expect(items[0]).toEqual({ id: 'bp-main', label: '主蓝图 · 入口' })
  })

  it('sorts sub-blueprints by title after the main one', () => {
    const blueprints: Record<string, BlueprintDoc> = {
      'bp-main': doc('bp-main', '主蓝图'),
      'bp-z': doc('bp-z', 'Z 子蓝图'),
      'bp-a': doc('bp-a', 'A 子蓝图'),
      'bp-m': doc('bp-m', 'M 子蓝图'),
    }
    const items = blueprintListItems(blueprints, 'bp-main')
    expect(items.map((i) => i.id)).toEqual(['bp-main', 'bp-a', 'bp-m', 'bp-z'])
    // 子蓝图不带「入口」后缀。
    expect(items.slice(1).every((i) => !i.label.includes('入口'))).toBe(true)
  })

  it('handles a missing main blueprint gracefully (no crash, subs still listed sorted)', () => {
    const blueprints: Record<string, BlueprintDoc> = {
      'bp-b': doc('bp-b', 'B'),
      'bp-a': doc('bp-a', 'A'),
    }
    const items = blueprintListItems(blueprints, 'does-not-exist')
    expect(items.map((i) => i.id)).toEqual(['bp-a', 'bp-b'])
  })

  it('handles an empty blueprint map', () => {
    expect(blueprintListItems({}, 'bp-main')).toEqual([])
  })
})

describe('BlueprintLibraryView module smoke', () => {
  it('exports a function component (no render — pulls in GraphStudio/@xyflow)', () => {
    expect(typeof BlueprintLibraryView).toBe('function')
  })
})
