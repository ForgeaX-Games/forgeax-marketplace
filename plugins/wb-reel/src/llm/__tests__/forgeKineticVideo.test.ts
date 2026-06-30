import { describe, it, expect } from 'vitest'
import {
  buildKineticVideoUserPrompt,
  sanitizeKineticVideoPrompt,
} from '../forgeKineticVideo'
import type { Scene, Shot } from '../../scenario/types'

/**
 * forgeKineticVideo 纯函数层测试。
 *
 * 覆盖：
 *   - buildKineticVideoUserPrompt 注入 persona header
 *   - single 模式不输出 A/B 帧块
 *   - ab 模式输出 A/B 两帧 + 守恒要求
 *   - 辅助字段（音效 / 台词 / 表演 / 转场）条件性拼接
 *   - sanitizeKineticVideoPrompt 剥离 code fence / 引导语 / 多段合并 / 长度警告
 */

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: `Scene ${id}`,
    media: { kind: 'IMAGE_PROMPT', prompt: 'default' },
    durationMs: 5000,
    dialogue: [],
    branches: [],
    ...overrides,
  }
}

function shot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: 'sh01',
    order: 0,
    framing: 'medium',
    prompt: '默认中间帧描述',
    durationSec: 5,
    ...overrides,
  }
}

describe('buildKineticVideoUserPrompt', () => {
  it('注入 persona header（未指定 → 维伦纽瓦默认）', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot(),
      scene: scene('s1'),
    })
    expect(p).toMatch(/【导演流派】维伦纽瓦 · 史诗/)
  })

  it('注入显式 persona header（芬奇）', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot(),
      scene: scene('s1'),
      directorStyle: 'fincher-noir',
    })
    expect(p).toMatch(/【导演流派】芬奇 · 黑色惊悚/)
  })

  it('输出时长 / 策略 / 景别三要素', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot({
        durationSec: 10,
        keyframeStrategy: 'ab',
        framing: 'wide',
      }),
      scene: scene('s1'),
    })
    expect(p).toMatch(/【时长】10/)
    expect(p).toMatch(/【关键帧策略】ab/)
    expect(p).toMatch(/【景别 framing】wide/)
  })

  it('single 模式下不输出 A/B 帧块', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot({
        keyframeStrategy: 'single',
        startFramePrompt: '不应该出现',
        endFramePrompt: '不应该出现',
      }),
      scene: scene('s1'),
    })
    expect(p).not.toMatch(/【A 帧 prompt】/)
    expect(p).not.toMatch(/【B 帧 prompt】/)
  })

  it('ab 模式输出 A/B 两帧文本', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot({
        keyframeStrategy: 'ab',
        startFramePrompt: '门刚被推开',
        endFramePrompt: '人已跨过门槛',
      }),
      scene: scene('s1'),
    })
    expect(p).toMatch(/【A 帧 prompt】门刚被推开/)
    expect(p).toMatch(/【B 帧 prompt】人已跨过门槛/)
  })

  it('辅助字段缺失时不输出对应块（条件拼接）', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot(),
      scene: scene('s1'),
    })
    expect(p).not.toMatch(/【本镜台词/)
    expect(p).not.toMatch(/【潜台词/)
    expect(p).not.toMatch(/【表演指导/)
    expect(p).not.toMatch(/【环境音/)
    expect(p).not.toMatch(/【转场提示/)
    expect(p).not.toMatch(/【运镜提示/)
    expect(p).not.toMatch(/【背景状态/)
  })

  it('辅助字段齐全时全部输出', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot({
        cameraHint: '低角度手持跟拍',
        dialogueText: '你答应过……',
        subtext: '不敢相信现实',
        performance: '声音沙哑',
        audioHint: '雷声 + 雨水',
        transitionHint: '硬切到反打',
        bokehState: 'dynamic',
      }),
      scene: scene('s1'),
    })
    expect(p).toMatch(/【运镜提示 cameraHint】低角度手持跟拍/)
    expect(p).toMatch(/【本镜台词 dialogueText】你答应过……/)
    expect(p).toMatch(/【潜台词 subtext】不敢相信现实/)
    expect(p).toMatch(/【表演指导 performance】声音沙哑/)
    expect(p).toMatch(/【环境音 audioHint】雷声 \+ 雨水/)
    expect(p).toMatch(/【转场提示 transitionHint】硬切到反打/)
    expect(p).toMatch(/【背景状态 bokehState】dynamic/)
  })

  it('visualStyle + sceneBg + uiStylePrompt 作为上下文出现', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot(),
      scene: scene('s1', { background: '暴雨 废弃车站' }),
      visualStyle: 'photoreal',
      uiStylePrompt: '粗颗粒电影胶片质感',
    })
    expect(p).toMatch(/【全局视觉风格】photoreal/)
    expect(p).toMatch(/【场景舞美 \/ 氛围（上下文）】暴雨 废弃车站/)
    expect(p).toMatch(/【UI 风格（上下文）】粗颗粒电影胶片质感/)
  })

  it('尾部契约要求 150-350 字单段纯文本', () => {
    const p = buildKineticVideoUserPrompt({
      shot: shot(),
      scene: scene('s1'),
    })
    expect(p).toMatch(/150-350 字中文单段纯文本/)
    expect(p).toMatch(/无 markdown/)
  })
})

describe('sanitizeKineticVideoPrompt', () => {
  it('剥离 ```text fence', () => {
    const raw = '```\n镜头从低角度缓慢推进，雨水打在积水里炸开细小的皇冠，人物背影被霓虹色染。\n```'
    const warnings: string[] = []
    const out = sanitizeKineticVideoPrompt(raw, warnings)
    expect(out).not.toMatch(/```/)
    expect(out).toMatch(/镜头从低角度/)
  })

  it('剥离 ```json fence', () => {
    const raw = '```json\n镜头内容 ABC\n```'
    const out = sanitizeKineticVideoPrompt(raw, [])
    expect(out).not.toMatch(/```/)
    expect(out).toBe('镜头内容 ABC')
  })

  it('剥离常见引导语"好的"', () => {
    const raw = '好的，镜头从低角度缓慢推进。'
    const out = sanitizeKineticVideoPrompt(raw, [])
    expect(out.startsWith('镜头')).toBe(true)
  })

  it('剥离"以下是"/"这是"引导语', () => {
    const a = sanitizeKineticVideoPrompt('以下是生成的视频提示词：镜头开始推进。', [])
    const b = sanitizeKineticVideoPrompt('这是视频提示词：镜头开始推进。', [])
    expect(a.startsWith('镜头')).toBe(true)
    expect(b.startsWith('镜头')).toBe(true)
  })

  it('多行段落合并为单段', () => {
    const raw = '镜头开始推进。\n\n雨水打在积水里。\n\n人物背影被染色。'
    const out = sanitizeKineticVideoPrompt(raw, [])
    expect(out).not.toMatch(/\n/)
    expect(out).toMatch(/镜头开始推进/)
    expect(out).toMatch(/人物背影被染色/)
  })

  it('超 450 字截断 + 告警', () => {
    const raw = '镜头'.repeat(250) // 500 字
    const warnings: string[] = []
    const out = sanitizeKineticVideoPrompt(raw, warnings)
    expect(out.length).toBe(450)
    expect(warnings.some((w) => w.includes('超 450 字'))).toBe(true)
  })

  it('短于 80 字 → 保留 + 告警', () => {
    const raw = '镜头开始。'
    const warnings: string[] = []
    const out = sanitizeKineticVideoPrompt(raw, warnings)
    expect(out).toBe('镜头开始。')
    expect(warnings.some((w) => w.includes('过短'))).toBe(true)
  })

  it('正常长度（80-450 字）不报警', () => {
    const raw = '镜头'.repeat(60) // 120 字
    const warnings: string[] = []
    sanitizeKineticVideoPrompt(raw, warnings)
    expect(warnings).toHaveLength(0)
  })
})
