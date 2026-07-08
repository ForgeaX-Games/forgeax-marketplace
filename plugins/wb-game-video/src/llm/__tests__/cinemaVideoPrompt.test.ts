import { describe, expect, it } from 'vitest'
import {
  buildCinemaVideoUserPrompt,
  sanitizeCinemaVideoPrompt,
} from '../forgeKineticVideo'
import type { Scene, Shot, Character } from '../../scenario/types'

// ─── 最小可用的 Shot / Scene / Character 构造器（只填本测试用到的字段） ───

function makeShot(over: Partial<Shot> = {}): Shot {
  return {
    id: 'sc1-sh01',
    order: 0,
    framing: 'medium',
    prompt: '林夏站在码头边，海风吹动她的风衣',
    durationSec: 12,
    ...over,
  } as Shot
}

function makeScene(over: Partial<Scene> = {}): Scene {
  return {
    id: 'sc1',
    title: '码头别离',
    durationMs: 12000,
    dialogue: [],
    branches: [],
    ...over,
  } as Scene
}

function makeChar(id: string, name: string, prompt?: string): Character {
  return { id, name, prompt } as Character
}

describe('buildCinemaVideoUserPrompt', () => {
  it('注入角色花名册并要求用统一角色名（名字↔参考图对应）', () => {
    const out = buildCinemaVideoUserPrompt({
      shot: makeShot({ characterIds: ['c1'] }),
      scene: makeScene(),
      characters: [makeChar('c1', '林夏', '黑色短发，米色风衣')],
    })
    expect(out).toContain('角色花名册')
    expect(out).toContain('林夏')
    expect(out).toContain('黑色短发，米色风衣')
    // 必须用花名册里的角色名 + 与参考图一一对应的措辞
    expect(out).toMatch(/参考图/)
  })

  it('shot.dialogueText 多行台词被原样（保留换行）放进 user prompt 且要求逐字念', () => {
    const dialogue = '林夏：你真要走?\n沈舟：我没得选。'
    const out = buildCinemaVideoUserPrompt({
      shot: makeShot({ dialogueText: dialogue }),
      scene: makeScene(),
    })
    expect(out).toContain('林夏：你真要走?')
    expect(out).toContain('沈舟：我没得选。')
    // 逐字 / 点名角色 的硬约束措辞在场
    expect(out).toMatch(/逐字/)
    expect(out).toMatch(/点名|开口说出|不可漏念/)
  })

  it('shot 无台词时回退到 scene.dialogue 的「说话人：台词」多行', () => {
    const out = buildCinemaVideoUserPrompt({
      shot: makeShot({ dialogueText: undefined }),
      scene: makeScene({
        dialogue: [
          { id: 'd1', role: 'character', speaker: '林夏', text: '别送了。' },
          { id: 'd2', role: 'narration', text: '潮水退去。' },
          { id: 'd3', role: 'system', text: '【系统】存档成功' },
        ],
      }),
    })
    expect(out).toContain('林夏：别送了。')
    // narration 兜底成「旁白」
    expect(out).toContain('旁白：潮水退去。')
    // system 行被过滤，不进台词
    expect(out).not.toContain('存档成功')
  })

  it('shot 与 scene 都无台词时，明确标注无台词、不硬塞对白', () => {
    const out = buildCinemaVideoUserPrompt({
      shot: makeShot({ dialogueText: undefined }),
      scene: makeScene({ dialogue: [] }),
    })
    expect(out).toMatch(/无台词/)
  })

  it('强调单镜 ≤15s + 时间码分拍，不塞跨场多场戏', () => {
    const out = buildCinemaVideoUserPrompt({
      shot: makeShot({ durationSec: 15 }),
      scene: makeScene(),
    })
    expect(out).toMatch(/单个 shot|单镜/)
    expect(out).toMatch(/时间码/)
    expect(out).toMatch(/15/)
  })
})

describe('sanitizeCinemaVideoPrompt', () => {
  it('保留时间码换行结构（不压成单段）', () => {
    const warnings: string[] = []
    const raw = '[0-5 秒] 林夏走向码头。\n[6-12 秒] 林夏转身说：“别送了。”'
    const out = sanitizeCinemaVideoPrompt(raw, warnings)
    expect(out).toContain('\n')
    expect(out).toContain('[0-5 秒]')
    expect(out).toContain('[6-12 秒]')
  })

  it('剥离 ```code fence``` 外壳', () => {
    const warnings: string[] = []
    const raw = '```\n[0-5 秒] 镜头推近林夏。\n[6-12 秒] 她开口说话。\n```'
    const out = sanitizeCinemaVideoPrompt(raw, warnings)
    expect(out.startsWith('```')).toBe(false)
    expect(out.endsWith('```')).toBe(false)
    expect(out).toContain('[0-5 秒]')
  })

  it('去掉开头元话语（好的/以下是）', () => {
    const warnings: string[] = []
    const out = sanitizeCinemaVideoPrompt('好的，[0-5 秒] 林夏走向码头。', warnings)
    expect(out.startsWith('好的')).toBe(false)
    expect(out).toContain('[0-5 秒]')
  })

  it('把 3+ 连续空行压成最多一个空行', () => {
    const warnings: string[] = []
    const out = sanitizeCinemaVideoPrompt('A 段落。\n\n\n\nB 段落。', warnings)
    expect(out).not.toMatch(/\n{3,}/)
    expect(out).toContain('A 段落。')
    expect(out).toContain('B 段落。')
  })

  it('超 1800 字截断并告警', () => {
    const warnings: string[] = []
    const long = '镜'.repeat(2000)
    const out = sanitizeCinemaVideoPrompt(long, warnings)
    expect(out.length).toBe(1800)
    expect(warnings.some((w) => w.includes('1800'))).toBe(true)
  })

  it('过短给告警（不阻塞）', () => {
    const warnings: string[] = []
    sanitizeCinemaVideoPrompt('太短', warnings)
    expect(warnings.some((w) => w.includes('过短'))).toBe(true)
  })
})
