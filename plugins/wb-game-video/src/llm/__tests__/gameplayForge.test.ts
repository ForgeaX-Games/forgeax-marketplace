import { describe, expect, it, vi } from 'vitest'
import { forgeScenarioFromIdea } from '../promptForge'
import type { TextClient, TextRequest } from '../types'

/**
 * 玩法优先自动生成 —— 回归保护：验证「补玩法意识」这条改动真的落地：
 *   1. idea 模式 schema 段告诉 LLM 有 entities/kind/boss/decision/hotspots 可填；
 *   2. LLM 给出的玩法字段能**存活 normalizeScenario**（逐字段重建的透传闸门），
 *      从而后续可编译进 GameVideoBlueprintGraph、试玩可玩；
 *   3. 悬空玩法跳转被清理；纯叙事剧本零回归（不冒出 entities/modules）。
 */
function mockClient(reply: string): TextClient & { lastReq: TextRequest | null } {
  const m = {
    lastReq: null as TextRequest | null,
    generate: vi.fn(async (req: TextRequest) => {
      m.lastReq = req
      return reply
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'mock-opus',
    getProviderName: () => 'mock',
  }
  return m as unknown as TextClient & { lastReq: TextRequest | null }
}

const GAMEPLAY_REPLY = JSON.stringify({
  title: '雨夜屋顶',
  synopsis: '女剑客雨夜单挑持刀 Boss。',
  entities: [
    { id: 'player', name: '女剑客', kind: 'player', maxHp: 100 },
    { id: 'boss_1', name: '持刀客', kind: 'boss', maxHp: 120 },
  ],
  rootSceneId: 's1',
  scenes: [
    {
      id: 's1',
      title: '01 · 对峙',
      durationMs: 8000,
      kind: 'story',
      mediaPlayMode: 'loop',
      dialogue: [],
      branches: [{ kind: 'auto', targetSceneId: 's2' }],
    },
    {
      id: 's2',
      title: '02 · Boss 战',
      durationMs: 12000,
      kind: 'battle',
      boss: {
        entityId: 'boss_1',
        playerEntityId: 'player',
        rounds: [
          {
            id: 'r1',
            label: '格挡反击',
            hitEffects: [{ id: 'r1-hit-hp', kind: 'entityStat', entityId: 'boss_1', stat: 'hp', op: 'add', value: -45 }],
            missEffects: [{ id: 'r1-miss-hp', kind: 'entityStat', entityId: 'player', stat: 'hp', op: 'add', value: -25 }],
            qte: {
              window: { perfect: 80, great: 160, good: 280 },
              score: { perfect: 100, great: 60, good: 25, miss: -30 },
              cues: [{ id: 'c1', shape: 'tap', x: 0.5, y: 0.5, appearAt: 1500, targetAt: 2300, label: '斩' }],
            },
          },
        ],
        winSceneId: 's3win',
        loseSceneId: 's3lose',
        // 悬空目标：应被 normalize 清理成 undefined
      },
      performance: {
        cues: [{
          id: 'pc1',
          atMs: 1200,
          label: '命中！',
          effects: [{ id: 'pc1-hp', kind: 'entityStat', entityId: 'boss_1', stat: 'hp', op: 'add', value: -30 }],
        }],
      },
      dialogue: [],
      branches: [],
    },
    {
      id: 's3win',
      title: '03 · 胜',
      durationMs: 5000,
      kind: 'choice',
      decision: { optType: 'timed', timeoutMs: 3000, prompt: '追击？', defaultBranchId: 's3win-b1' },
      hotspots: [{ id: 'hs1', x: 0.4, y: 0.5, label: '查看', targetSceneId: 's1', mode: 'return' }],
      dialogue: [],
      branches: [{ id: 's3win-b1', kind: 'choice', label: '收刀', targetSceneId: 's1' }],
    },
    {
      id: 's3lose',
      title: '03 · 败',
      durationMs: 5000,
      dialogue: [],
      branches: [],
    },
  ],
})

const NARRATIVE_REPLY = JSON.stringify({
  title: '雨夜归人',
  synopsis: '门后不只一个人。',
  rootSceneId: 'n1',
  scenes: [
    {
      id: 'n1',
      title: '01 · 门前',
      durationMs: 8000,
      dialogue: [],
      branches: [{ kind: 'auto', targetSceneId: 'n2' }],
    },
    { id: 'n2', title: '02 · 门内', durationMs: 6000, dialogue: [], branches: [] },
  ],
})

describe('玩法优先自动生成 · schema 段', () => {
  it('idea 模式 user prompt 含 entities/kind/boss/decision/hotspots 玩法字段说明', async () => {
    const client = mockClient(GAMEPLAY_REPLY)
    await forgeScenarioFromIdea(client, { idea: '做个带 Boss 和 QTE 的视频游戏' })
    const u = client.lastReq?.userPrompt ?? ''
    expect(u).toContain('entities')
    expect(u).toMatch(/kind.*battle|battle.*boss/)
    expect(u).toContain('boss')
    expect(u).toContain('decision')
    expect(u).toContain('hotspots')
    expect(u).toContain('mediaPlayMode')
  })
})

describe('玩法优先自动生成 · normalize 透传', () => {
  it('entities 存活并注册；modules.gameplay 自动开', async () => {
    const client = mockClient(GAMEPLAY_REPLY)
    const { scenario } = await forgeScenarioFromIdea(client, { idea: 'boss 游戏' })
    expect(scenario.entities?.['player']?.maxHp).toBe(100)
    expect(scenario.entities?.['boss_1']?.kind).toBe('boss')
    expect(scenario.modules?.gameplay).toBe(true)
  })

  it('scene.kind / mediaPlayMode / boss(含 round.qte) / performance 存活', async () => {
    const client = mockClient(GAMEPLAY_REPLY)
    const { scenario } = await forgeScenarioFromIdea(client, { idea: 'boss 游戏' })
    expect(scenario.scenes['s1']?.mediaPlayMode).toBe('loop')
    const battle = scenario.scenes['s2']
    expect(battle?.kind).toBe('battle')
    expect(battle?.boss?.entityId).toBe('boss_1')
    expect(battle?.boss?.rounds).toHaveLength(1)
    expect(battle?.boss?.rounds[0]?.qte?.cues).toHaveLength(1)
    expect(battle?.performance?.cues[0]?.effects[0]).toMatchObject({
      kind: 'entityStat',
      entityId: 'boss_1',
      stat: 'hp',
      value: -30,
    })
  })

  it('decision / hotspots 存活', async () => {
    const client = mockClient(GAMEPLAY_REPLY)
    const { scenario } = await forgeScenarioFromIdea(client, { idea: 'boss 游戏' })
    const win = scenario.scenes['s3win']
    expect(win?.decision?.optType).toBe('timed')
    expect(win?.decision?.timeoutMs).toBe(3000)
    expect(win?.hotspots?.[0]?.targetSceneId).toBe('s1')
    expect(win?.hotspots?.[0]?.mode).toBe('return')
  })

  it('悬空 Boss 跳转目标（s3win/s3lose 存在则保留；不存在则清空）', async () => {
    // s3win / s3lose 在本 fixture 里存在 → 应保留
    const client = mockClient(GAMEPLAY_REPLY)
    const { scenario } = await forgeScenarioFromIdea(client, { idea: 'boss 游戏' })
    expect(scenario.scenes['s2']?.boss?.winSceneId).toBe('s3win')
    expect(scenario.scenes['s2']?.boss?.loseSceneId).toBe('s3lose')
  })

  it('Boss 指向不存在场景时清空该指针（不留悬空跳转）', async () => {
    const parsed = JSON.parse(GAMEPLAY_REPLY)
    parsed.scenes[1].boss.winSceneId = 'ghost_scene'
    const client = mockClient(JSON.stringify(parsed))
    const { scenario } = await forgeScenarioFromIdea(client, { idea: 'boss 游戏' })
    expect(scenario.scenes['s2']?.boss?.winSceneId).toBeUndefined()
    expect(scenario.scenes['s2']?.boss?.loseSceneId).toBe('s3lose')
  })
})

describe('纯叙事零回归', () => {
  it('无玩法字段的剧本不冒出 entities / modules.gameplay', async () => {
    const client = mockClient(NARRATIVE_REPLY)
    const { scenario } = await forgeScenarioFromIdea(client, { idea: '一个雨夜重逢的故事' })
    expect(scenario.entities).toBeUndefined()
    expect(scenario.modules?.gameplay).toBeUndefined()
    expect(scenario.scenes['n1']?.kind).toBeUndefined()
    expect(scenario.scenes['n1']?.boss).toBeUndefined()
  })
})
