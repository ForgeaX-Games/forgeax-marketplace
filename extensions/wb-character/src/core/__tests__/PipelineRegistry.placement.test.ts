// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  filterByPlacement,
  toAgentManifest,
  resolvePlacement,
} from '../PipelineRegistry'
import type { PipelineMeta } from '../types'

/** 过滤 / 清单生成逻辑只看 meta —— 这里直接构造 PipelineMeta。 */
function stub(meta: Partial<PipelineMeta> & { id: string; name: string }): PipelineMeta {
  return {
    icon: '?',
    description: '',
    version: '0.0.0',
    ...meta,
  }
}

describe('resolvePlacement()', () => {
  it('respects explicit placement', () => {
    expect(resolvePlacement({ id: 'a', name: 'A', icon: '', description: '', version: '', placement: 'main' })).toBe('main')
    expect(resolvePlacement({ id: 'b', name: 'B', icon: '', description: '', version: '', placement: 'drawer' })).toBe('drawer')
    expect(resolvePlacement({ id: 'c', name: 'C', icon: '', description: '', version: '', placement: 'hidden' })).toBe('hidden')
  })

  it('defaults to drawer when omitted — 未声明的新管线不会污染主干顶栏', () => {
    expect(resolvePlacement({ id: 'x', name: 'X', icon: '', description: '', version: '' })).toBe('drawer')
  })
})

describe('filterByPlacement()', () => {
  const pipelines = [
    stub({ id: 'pixel-char', name: '像素角色', placement: 'main' }),
    stub({ id: 'vehicle-design', name: '载具设计', placement: 'main' }),
    stub({ id: 'vfx', name: '技能特效', placement: 'main' }),
    stub({ id: 'video', name: '视频角色', placement: 'drawer' }),
    stub({ id: 'spine', name: 'Spine', placement: 'drawer' }),
    stub({ id: 'aux-sample', name: '辅助样例', placement: 'drawer' }),
    stub({ id: 'monster-gen', name: '怪物生成', placement: 'hidden' }),
    stub({ id: 'legacy', name: '未声明' /* 缺省 drawer */ }),
  ]

  it('returns only main pipelines', () => {
    const ids = filterByPlacement(pipelines, 'main').map(m => m.id)
    expect(ids).toEqual(['pixel-char', 'vehicle-design', 'vfx'])
  })

  it('returns drawer pipelines + 缺省为 drawer 的老管线', () => {
    const ids = filterByPlacement(pipelines, 'drawer').map(m => m.id)
    expect(ids).toContain('video')
    expect(ids).toContain('spine')
    expect(ids).toContain('aux-sample')
    expect(ids).toContain('legacy')
    expect(ids).not.toContain('pixel-char')
    expect(ids).not.toContain('monster-gen')
  })

  it('returns hidden pipelines only when explicitly asked', () => {
    const ids = filterByPlacement(pipelines, 'hidden').map(m => m.id)
    expect(ids).toEqual(['monster-gen'])
  })
})

describe('toAgentManifest()', () => {
  const pipelines = [
    stub({
      id: 'pixel-char',
      name: '像素角色',
      placement: 'main',
      inputs: ['conceptImage'],
      outputs: ['spriteZip'],
      agentTags: ['character.sprite', 'pixel'],
    }),
    stub({
      id: 'vehicle-design',
      name: '载具设计',
      placement: 'main',
      outputs: ['vehicleZip'],
      agentTags: ['vehicle'],
    }),
    stub({ id: 'monster-gen', name: '怪物生成', placement: 'hidden' }),
  ]

  it('exports every registered pipeline (including hidden) — 智能体需要知道 hidden 管线能被程序化调起', () => {
    const manifest = toAgentManifest(pipelines)
    expect(manifest.pipelines.map(p => p.id)).toEqual(['pixel-char', 'vehicle-design', 'monster-gen'])
  })

  it('preserves discovery-critical fields', () => {
    const manifest = toAgentManifest(pipelines)
    const pixel = manifest.pipelines.find(p => p.id === 'pixel-char')!
    expect(pixel.name).toBe('像素角色')
    expect(pixel.placement).toBe('main')
    expect(pixel.inputs).toEqual(['conceptImage'])
    expect(pixel.outputs).toEqual(['spriteZip'])
    expect(pixel.agentTags).toEqual(['character.sprite', 'pixel'])
  })

  it('fills placement for pipelines that omit it', () => {
    const pipes = [stub({ id: 'legacy', name: 'Legacy' })]
    const manifest = toAgentManifest(pipes)
    expect(manifest.pipelines[0].placement).toBe('drawer')
  })
})
