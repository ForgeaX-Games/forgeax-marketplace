import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../BlueprintTab.tsx'),
  'utf8',
)

describe('BlueprintTab loopback edges', () => {
  it('marks edges that route from right to left as loopback edges', () => {
    expect(SOURCE).toContain('isLoopbackEdge')
    expect(SOURCE).toContain('loopback')
  })

  it('routes loopback edges through their own arced path', () => {
    expect(SOURCE).toContain('getLoopbackPath')
  })

  it('draws loopback edges as plain solid wires behind nodes (no dash / animation / elevation)', () => {
    // 所有连线（含回环边）落在节点「之下」（z 0），线永不覆盖节点；与原型 `.bpg-wires` 对齐。
    expect(SOURCE).toContain('zIndex: 0')
    // 不再有虚线滚动动画，也不再把回环边单独描成高亮虚线。
    expect(SOURCE).not.toContain('ks-bp-edge-loopback')
    expect(SOURCE).not.toContain('ks-bp-loopback-flow')
  })
})
