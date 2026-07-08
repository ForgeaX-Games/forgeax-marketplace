import { describe, expect, it } from 'vitest'
import {
  buildReconnectPrompt,
  digestScenes,
  mergeSuggestionsIntoPlan,
  parseReconnectSuggestions,
} from '../aiReconnect'
import type { OrphanInfo, ReconnectPlan } from '../reconnectOrphans'
import type { Scenario } from '../types'

/**
 * aiReconnect 纯函数单测 —— 不触网、不 mock LLM。
 *
 * 覆盖范围：
 *   - digestScenes 抽取 title / firstLine / speakers / outgoingTargets /
 *     isRoot / isOrphan
 *   - buildReconnectPrompt 输出文本包含所有 orphan 且带约束
 *   - parseReconnectSuggestions 白名单校验：orphanId / targetId / 自环
 *   - mergeSuggestionsIntoPlan 覆盖/新增语义
 */

function makeScenario(
  scenes: Array<{
    id: string
    title?: string
    x?: number
    branches?: Array<{ targetSceneId: string }>
    dialogue?: Array<{
      role: 'narration' | 'protagonist' | 'character' | 'system'
      speaker?: string
      text: string
    }>
  }>,
): Scenario {
  const dict: Scenario['scenes'] = {}
  for (const s of scenes) {
    dict[s.id] = {
      id: s.id,
      title: s.title ?? s.id,
      media: { kind: 'PLACEHOLDER' },
      durationMs: 1000,
      dialogue: (s.dialogue ?? []).map((d, i) => ({
        id: `${s.id}-d${i}`,
        role: d.role,
        speaker: d.speaker,
        text: d.text,
        startMs: i * 200,
      })),
      branches: (s.branches ?? []).map((b, i) => ({
        id: `${s.id}-b${i}`,
        kind: 'auto',
        targetSceneId: b.targetSceneId,
      })),
      pos: { x: s.x ?? 0, y: 0 },
    }
  }
  return {
    id: 'test',
    title: 'test',
    rootSceneId: scenes[0]?.id ?? '',
    scenes: dict,
    characters: {},
    locations: {},
    defaultCharMs: 32,
    schemaVersion: 3,
  } as Scenario
}

describe('aiReconnect · digestScenes', () => {
  it('抽 title / 出边 / root / orphan 标志', () => {
    const sc = makeScenario([
      { id: 'a', title: '开场', branches: [{ targetSceneId: 'b' }] },
      { id: 'b', title: '中段' },
      { id: 'c', title: '结局' },
    ])
    const digests = digestScenes(sc, new Set(['b', 'c']))
    const a = digests.find((d) => d.id === 'a')!
    const b = digests.find((d) => d.id === 'b')!
    const c = digests.find((d) => d.id === 'c')!
    expect(a.isRoot).toBe(true)
    expect(a.isOrphan).toBe(false)
    expect(a.outgoingTargets).toEqual(['b'])
    expect(b.isOrphan).toBe(true)
    expect(c.isOrphan).toBe(true)
    expect(a.title).toBe('开场')
  })

  it('野指针 target 会被过滤掉（不能误导 LLM 以为已接好）', () => {
    // 源场景出边指向已删 scene —— orphan 根因之一。digest 里应该只保留
    // 真正指向存在 scene 的 target，否则 LLM 会当成"已有出边"不给建议。
    const sc = makeScenario([
      {
        id: 'a',
        title: '源',
        branches: [
          { targetSceneId: 'ghost' },
          { targetSceneId: 'b' },
          { targetSceneId: 'another-ghost' },
        ],
      },
      { id: 'b', title: '存在' },
    ])
    const digests = digestScenes(sc, new Set())
    const a = digests.find((d) => d.id === 'a')!
    expect(a.outgoingTargets).toEqual(['b'])
  })

  it('firstLine 跳过 system 行并截到 60 字', () => {
    const longText = '一'.repeat(100)
    const sc = makeScenario([
      {
        id: 'a',
        dialogue: [
          { role: 'system', text: '[系统] 进入场景' },
          { role: 'narration', text: longText },
        ],
      },
    ])
    const d = digestScenes(sc, new Set())[0]!
    expect(d.firstLine.length).toBe(60)
    expect(d.firstLine[0]).toBe('一')
  })

  it('speakers 去重 & 只收有效 speaker', () => {
    const sc = makeScenario([
      {
        id: 'a',
        dialogue: [
          { role: 'character', speaker: '阿明', text: '来了' },
          { role: 'narration', text: '风起' },
          { role: 'character', speaker: '阿明', text: '再来' },
          { role: 'character', speaker: '小兰', text: '好' },
        ],
      },
    ])
    const d = digestScenes(sc, new Set())[0]!
    expect(d.speakers.sort()).toEqual(['小兰', '阿明'])
  })

  it('空 dialogue → firstLine 空串、speakers 空数组', () => {
    const sc = makeScenario([{ id: 'a' }])
    const d = digestScenes(sc, new Set())[0]!
    expect(d.firstLine).toBe('')
    expect(d.speakers).toEqual([])
  })
})

describe('aiReconnect · buildReconnectPrompt', () => {
  it('包含所有 orphan id 且给出输出契约', () => {
    const sc = makeScenario([
      { id: 'a', branches: [{ targetSceneId: 'b' }] },
      { id: 'b', title: '中段' },
      { id: 'c', title: '断头 3' },
      { id: 'd', title: 'BAD END' },
    ])
    const orphans: OrphanInfo[] = [
      { sceneId: 'b', title: '中段', x: 200, y: 0, suggestedTargetId: 'c' },
      { sceneId: 'c', title: '断头 3', x: 400, y: 0, suggestedTargetId: 'd' },
      { sceneId: 'd', title: 'BAD END', x: 600, y: 0, suggestedTargetId: null },
    ]
    const prompt = buildReconnectPrompt(sc, orphans)
    expect(prompt).toContain('b')
    expect(prompt).toContain('c')
    expect(prompt).toContain('d')
    expect(prompt).toMatch(/输出契约/)
    expect(prompt).toMatch(/orphanId/)
    expect(prompt).toMatch(/targetId/)
    expect(prompt).toMatch(/ROOT/)
    expect(prompt).toMatch(/ORPHAN/)
  })

  it('orphans 为空时 prompt 仍合法但 ORPHAN 列表为空占位', () => {
    const sc = makeScenario([{ id: 'a' }])
    const prompt = buildReconnectPrompt(sc, [])
    expect(prompt).toMatch(/（空）|\(空\)/)
  })
})

describe('aiReconnect · parseReconnectSuggestions', () => {
  const orphanIds = new Set(['b', 'c', 'd'])
  const sceneIds = new Set(['a', 'b', 'c', 'd'])

  it('接收 { suggestions: [...] } 形态', () => {
    const raw = {
      suggestions: [
        { orphanId: 'b', targetId: 'c', reason: '续接' },
        { orphanId: 'c', targetId: null, reason: '结局' },
      ],
    }
    const r = parseReconnectSuggestions(raw, orphanIds, sceneIds)
    expect(r.suggestions).toHaveLength(2)
    expect(r.suggestions[0]!.targetId).toBe('c')
    expect(r.suggestions[1]!.targetId).toBe(null)
    expect(r.warnings).toEqual([])
  })

  it('接收裸数组形态', () => {
    const raw = [{ orphanId: 'b', targetId: 'c' }]
    const r = parseReconnectSuggestions(raw, orphanIds, sceneIds)
    expect(r.suggestions).toHaveLength(1)
  })

  it('丢弃 orphanId 不在白名单的条目', () => {
    const raw = {
      suggestions: [
        { orphanId: 'zzz', targetId: 'c' },
        { orphanId: 'b', targetId: 'c' },
      ],
    }
    const r = parseReconnectSuggestions(raw, orphanIds, sceneIds)
    expect(r.suggestions).toHaveLength(1)
    expect(r.suggestions[0]!.orphanId).toBe('b')
    expect(r.warnings.some((w) => w.includes('zzz'))).toBe(true)
  })

  it('targetId 不在白名单 → 改为 null + warning', () => {
    const raw = {
      suggestions: [{ orphanId: 'b', targetId: 'ghost' }],
    }
    const r = parseReconnectSuggestions(raw, orphanIds, sceneIds)
    expect(r.suggestions[0]!.targetId).toBe(null)
    expect(r.warnings.some((w) => w.includes('ghost'))).toBe(true)
  })

  it('自环 → 改为 null + warning', () => {
    const raw = {
      suggestions: [{ orphanId: 'b', targetId: 'b' }],
    }
    const r = parseReconnectSuggestions(raw, orphanIds, sceneIds)
    expect(r.suggestions[0]!.targetId).toBe(null)
    expect(r.warnings.some((w) => w.includes('自环'))).toBe(true)
  })

  it('去重：同一 orphanId 多条只保留第一条', () => {
    const raw = {
      suggestions: [
        { orphanId: 'b', targetId: 'c' },
        { orphanId: 'b', targetId: 'd' },
      ],
    }
    const r = parseReconnectSuggestions(raw, orphanIds, sceneIds)
    expect(r.suggestions).toHaveLength(1)
    expect(r.suggestions[0]!.targetId).toBe('c')
    expect(r.warnings.some((w) => w.includes('重复'))).toBe(true)
  })

  it('完全非法输入 → 返回空 + warning', () => {
    const r = parseReconnectSuggestions('not json', orphanIds, sceneIds)
    expect(r.suggestions).toEqual([])
    expect(r.warnings.length).toBe(1)
  })

  it('缺少 orphanId 的条目被丢弃', () => {
    const raw = { suggestions: [{ targetId: 'c' }] }
    const r = parseReconnectSuggestions(raw, orphanIds, sceneIds)
    expect(r.suggestions).toEqual([])
    expect(r.warnings.length).toBe(1)
  })
})

describe('aiReconnect · mergeSuggestionsIntoPlan', () => {
  it('空 suggestions 返回原 plan 引用', () => {
    const plan: ReconnectPlan = { entries: [{ sceneId: 'b', targetSceneId: null }] }
    const r = mergeSuggestionsIntoPlan(plan, [])
    expect(r).toBe(plan)
  })

  it('覆盖已有 entry 的 targetSceneId', () => {
    const plan: ReconnectPlan = { entries: [{ sceneId: 'b', targetSceneId: null }] }
    const r = mergeSuggestionsIntoPlan(plan, [
      { orphanId: 'b', targetId: 'c', reason: '' },
    ])
    expect(r.entries[0]!.targetSceneId).toBe('c')
  })

  it('suggestions 带新 orphanId 时追加新 entry', () => {
    const plan: ReconnectPlan = { entries: [{ sceneId: 'b', targetSceneId: null }] }
    const r = mergeSuggestionsIntoPlan(plan, [
      { orphanId: 'd', targetId: null, reason: 'END' },
    ])
    expect(r.entries).toHaveLength(2)
    expect(r.entries.find((e) => e.sceneId === 'd')!.targetSceneId).toBe(null)
  })
})
