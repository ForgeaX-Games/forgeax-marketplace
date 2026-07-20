import { describe, expect, it } from 'vitest'
import {
  parseRenderParams,
  frameCount,
  frameTimeMs,
  RENDER_DEFAULTS,
} from '../renderTarget'

describe('parseRenderParams', () => {
  it('缺省走默认 1920x1080@30', () => {
    expect(parseRenderParams('')).toEqual({
      scenarioId: undefined,
      sceneId: undefined,
      width: RENDER_DEFAULTS.width,
      height: RENDER_DEFAULTS.height,
      fps: RENDER_DEFAULTS.fps,
    })
  })

  it('解析 scn/scene/w/h/fps（兼容前导 ?）', () => {
    const p = parseRenderParams('?scn=story-1&scene=sc-2&w=1080&h=1920&fps=24')
    expect(p).toEqual({
      scenarioId: 'story-1',
      sceneId: 'sc-2',
      width: 1080,
      height: 1920,
      fps: 24,
    })
  })

  it('非法/越界尺寸与帧率回落+夹取', () => {
    expect(parseRenderParams('w=abc&h=&fps=999').width).toBe(RENDER_DEFAULTS.width)
    expect(parseRenderParams('w=abc&h=&fps=999').fps).toBe(120)
    expect(parseRenderParams('w=8&fps=0').width).toBe(16)
    expect(parseRenderParams('fps=0').fps).toBe(1)
  })

  it('空白 scn/scene 视为缺省', () => {
    const p = parseRenderParams('scn=%20&scene=')
    expect(p.scenarioId).toBeUndefined()
    expect(p.sceneId).toBeUndefined()
  })
})

describe('frameCount / frameTimeMs', () => {
  it('帧数向上取整、至少 1 帧', () => {
    expect(frameCount(0, 30)).toBe(1)
    expect(frameCount(1000, 30)).toBe(30)
    expect(frameCount(1001, 30)).toBe(31)
    expect(frameCount(33, 30)).toBe(1)
  })

  it('帧时间按 fps 等分', () => {
    expect(frameTimeMs(0, 30)).toBe(0)
    expect(frameTimeMs(30, 30)).toBe(1000)
    expect(frameTimeMs(15, 30)).toBe(500)
  })
})
