import { describe, it, expect } from 'vitest'
import {
  cameraToPrompt,
  buildBlockoutLegend,
  composeBlockoutVideoPrompt,
  BLOCKOUT_GUARD,
} from '../blockoutPrompt'
import type { Blockout, BlockoutCamera } from '../../../scenario/types'

const cam: BlockoutCamera = {
  id: 'c1',
  order: 0,
  name: '机位1',
  transform: { pos: { x: 0, y: 1.6, z: 3 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  fovMm: 85,
  framing: 'close',
  move: 'dolly-in',
}

const blockout: Blockout = {
  id: 'b1',
  name: '审讯室',
  cameras: [cam],
  objects: [
    {
      id: 'o-li',
      kind: 'capsule',
      colorRole: '#ff0000',
      linkedAnchor: { kind: 'character', id: 'char-li' },
      transform: { pos: { x: -1, y: 0, z: 2 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    },
    {
      id: 'o-wang',
      kind: 'capsule',
      colorRole: '#00ffff',
      linkedAnchor: { kind: 'character', id: 'char-wang' },
      transform: { pos: { x: 1.5, y: 0, z: -1 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    },
  ],
}

const scenario = {
  characters: {
    'char-li': { id: 'char-li', name: '李建' },
    'char-wang': { id: 'char-wang', name: '王芳' },
  },
} as any

describe('cameraToPrompt', () => {
  it('含景别/焦段/运镜', () => {
    const s = cameraToPrompt(cam)
    expect(s).toMatch(/close|特写/i)
    expect(s).toMatch(/85mm/)
    expect(s).toMatch(/dolly/i)
  })
})

describe('buildBlockoutLegend', () => {
  it('把角色色映射到角色名 + 参考图序号', () => {
    const legend = buildBlockoutLegend({
      blockout,
      camera: cam,
      scenario,
      anchorIndexOf: (id) => (id === 'char-li' ? 1 : 2),
    })
    expect(legend).toMatch(/李建/)
    expect(legend).toMatch(/王芳/)
    expect(legend).toMatch(/#ff0000|红/i)
    expect(legend).toMatch(/参考图1/)
    expect(legend).toMatch(/参考图2/)
  })

  it('无绑定角色占位 → 空串', () => {
    const empty: Blockout = { id: 'b', name: '', cameras: [cam], objects: [] }
    expect(buildBlockoutLegend({ blockout: empty, camera: cam, scenario, anchorIndexOf: () => undefined })).toBe('')
  })
})

describe('composeBlockoutVideoPrompt', () => {
  it('始终含 GUARD（防白模泄漏）且含 basePrompt', () => {
    const { prompt } = composeBlockoutVideoPrompt({
      basePrompt: '两人对峙',
      blockout,
      camera: cam,
      scenario,
      anchorIndexOf: (id) => (id === 'char-li' ? 1 : 2),
    })
    expect(prompt).toContain(BLOCKOUT_GUARD)
    expect(prompt).toContain('两人对峙')
    expect(prompt).toMatch(/李建/)
  })

  it('无角色占位时 warning 提示图例为空，但仍含 GUARD', () => {
    const empty: Blockout = { id: 'b', name: '', cameras: [cam], objects: [] }
    const { prompt, warnings } = composeBlockoutVideoPrompt({
      basePrompt: 'x',
      blockout: empty,
      camera: cam,
      scenario,
      anchorIndexOf: () => undefined,
    })
    expect(warnings.some((w) => w.includes('图例为空'))).toBe(true)
    expect(prompt).toContain(BLOCKOUT_GUARD)
  })
})
