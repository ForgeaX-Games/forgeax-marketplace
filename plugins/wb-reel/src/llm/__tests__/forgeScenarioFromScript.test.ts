import { describe, expect, it, vi } from 'vitest'
import { forgeScenarioFromScript } from '../promptForge'
import { SKILLS } from '../skills'
import type { TextClient, TextRequest } from '../types'

/**
 * 简易 mock TextClient —— 记录每一次调用并按预设响应返回。
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

const VALID_REPLY = JSON.stringify({
  title: '雨夜归人',
  synopsis: '男人雨夜回到旧居，门后的人不只一个。',
  uiStyle: { prompt: '潮湿胶片噪点 · 民国手绘字幕条' },
  characters: [
    { id: 'char_he', name: '他', prompt: '中年男人，灰风衣，左眼疤痕。' },
    { id: 'char_she', name: '她', prompt: '齐肩短发女人，象牙色旗袍。' },
  ],
  rootSceneId: 'scene_001',
  scenes: [
    {
      id: 'scene_001',
      title: '01 · 门前',
      durationMs: 8000,
      characterIds: ['char_he'],
      prompts: {
        scene: '雨夜，男人站在门前，水珠从檐角滴落。',
        ui: '字幕条偏冷蓝。',
        video: '镜头从脚向上摇到男人脸。',
      },
      dialogue: [
        { role: 'narration', text: '雨没有要停的意思。', startMs: 400, endMs: 3000 },
      ],
      qte: null,
      branches: [
        { kind: 'choice', label: '敲门', targetSceneId: 'scene_002', showAt: 6000 },
        { kind: 'choice', label: '转身', targetSceneId: 'scene_003', showAt: 6000 },
      ],
    },
    {
      id: 'scene_002',
      title: '02 · 门内',
      durationMs: 9000,
      characterIds: ['char_he', 'char_she'],
      prompts: { scene: '昏黄灯下的女人，背影僵硬。' },
      dialogue: [],
      branches: [],
    },
    {
      id: 'scene_003',
      title: '03 · 雨中独行',
      durationMs: 6000,
      characterIds: ['char_he'],
      prompts: { scene: '空旷弄堂，男人背影渐远。' },
      dialogue: [],
      branches: [],
    },
  ],
})

const SAMPLE_SCRIPT = `# 雨夜归人

## 第一幕

雨夜，男人站在旧居门前。

他犹豫许久。

— 敲，还是不敲？

## 第二幕（敲）

门后的女人不只是她。
`

describe('forgeScenarioFromScript', () => {
  describe('LLM 调用契约 · 严格"忠于原文"', () => {
    // 关键契约转向：贴完整剧本 ≠ 一句话延伸。
    // 旧实现错误地复用了"创作型"scenarioArchitect skill，
    // 导致 LLM 自由二创（重写台词、补场景、改情节）。新契约：
    //   - systemPrompt 必须是**专用 scriptStructurer skill**（结构化解析器）
    //   - userPrompt 必须**禁止补充指令**：不准创作、不准改台词、不准补场景
    //   - sceneCount / characterCount 仅作可选 hint，不强制规整
    it('使用 scriptStructurer skill 作为 systemPrompt（绝不与 idea 模式共用）', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(client.lastReq?.systemPrompt).toBe(SKILLS.scriptStructurer)
      // 反向断言：绝不能误用 idea 模式的创作 skill
      expect(client.lastReq?.systemPrompt).not.toBe(SKILLS.scenarioArchitect)
    })

    it('temperature 低（≤ 0.4，做结构化提取不要发散）', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(client.lastReq?.temperature ?? 1).toBeLessThanOrEqual(0.4)
    })

    it('jsonMode 必须为 true（结构化 JSON）', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(client.lastReq?.jsonMode).toBe(true)
    })

    it('maxTokens 充足（≥ 8000，剧本可能很长且要原样返回台词）', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(client.lastReq?.maxTokens ?? 0).toBeGreaterThanOrEqual(8000)
    })
  })

  describe('user prompt · "忠于原文"指令', () => {
    it('包含完整原始剧本（用三引号包住）', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const u = client.lastReq?.userPrompt ?? ''
      expect(u).toContain(SAMPLE_SCRIPT.trim())
    })

    it('显式声明"原文一字不改"或同义短语', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const u = client.lastReq?.userPrompt ?? ''
      expect(u).toMatch(/原文.*不.*改|逐字保留|严格忠于|不得改写|一字不改/)
    })

    it('显式禁止"补缺口/创作新场景/添加台词"', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const u = client.lastReq?.userPrompt ?? ''
      // 禁止字样应当出现至少一个
      expect(u).toMatch(/不得补充|不得创作|不得新增|禁止补|禁止创作|禁止新增|不要补|不要凭空/)
    })

    it('user prompt 自身**不再**带"缺口补全"这类二创指令（旧 bug 回归保护）', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const u = client.lastReq?.userPrompt ?? ''
      expect(u).not.toMatch(/缺口补全/)
      expect(u).not.toMatch(/补出新场景/)
      expect(u).not.toMatch(/克制感/)
      // 旧的"切成 X±1 场"硬约束也不该再有
      expect(u).not.toMatch(/[±]\s*1\s*个互动场景/)
    })

    it('包含「场景边界依据原文转折」「分支只来自原文显式选择」等抽取式指令', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const u = client.lastReq?.userPrompt ?? ''
      expect(u).toMatch(/场景边界|场景切分|场景划分/)
      expect(u).toMatch(/分支|抉择|选择/)
    })

    it('继承 JSON Schema 段（输出形状与 idea 模式同源）', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const u = client.lastReq?.userPrompt ?? ''
      expect(u).toMatch(/JSON Schema|JSON 结构/)
      expect(u).toMatch(/rootSceneId/)
      expect(u).toMatch(/scenes/)
      expect(u).toMatch(/branches/)
    })

    it('hint.sceneCount / characterCount 仅作"参考"，不写硬约束', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, {
        script: SAMPLE_SCRIPT,
        hint: { sceneCount: 7, characterCount: 4 },
      })
      const u = client.lastReq?.userPrompt ?? ''
      // 旧版"scenes 数 = 7"这种命令式不该出现
      expect(u).not.toMatch(/scenes 数 = 7/)
      expect(u).not.toMatch(/characters 数 = 4/)
      // 但 hint 数字本身应当作为参考性提示（"约 7 场""参考"等）
      // 严格策略：根本不强制场景数 → hint 可以彻底忽略，只在 directives 里说"以原文为准"
    })
  })

  describe('返回结构', () => {
    it('正常解析：返回 scenario / raw / warnings', async () => {
      const client = mockClient(VALID_REPLY)
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(res.scenario.title).toBe('雨夜归人')
      expect(res.scenario.rootSceneId).toBe('scene_001')
      expect(Object.keys(res.scenario.scenes)).toEqual([
        'scene_001',
        'scene_002',
        'scene_003',
      ])
      expect(res.raw).toBe(VALID_REPLY)
    })

    it('originIdea 兜底为 script 前 200 字（让 IdeaForge 显示作者来源）', async () => {
      const client = mockClient(VALID_REPLY)
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(res.scenario.originIdea).toBeDefined()
      expect(res.scenario.originIdea?.length ?? 0).toBeLessThanOrEqual(200)
      expect(SAMPLE_SCRIPT).toContain(res.scenario.originIdea ?? '')
    })

    it('characters 与 branches 通过 normalizeScenario 规范化', async () => {
      const client = mockClient(VALID_REPLY)
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(res.scenario.characters?.['char_he']?.name).toBe('他')
      const root = res.scenario.scenes['scene_001']
      expect(root?.branches.length).toBe(2)
      expect(root?.branches[0]?.kind).toBe('choice')
    })

    it('模型返回非法 JSON 时抛带 PARSE 标记的错', async () => {
      const client = mockClient('this is definitely not json')
      await expect(
        forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT }),
      ).rejects.toThrow(/PARSE/)
    })
  })

  // 关键回归保护：script 模式严禁"静默兜底" —— 早期 normalizeScenario 在
  // scenes 为空时会塞一个 title:'01 · 序章'/durationMs:6000 的占位场景，
  // 直接 loadScenario 覆盖原 demo —— 作者贴完整剧本只看到一个空节点，
  // 完全不知道 LLM 实际返了什么。这是 UX 大灾难。修法：抛 [EMPTY] 错并附 raw。
  describe('空 scenes 不静默兜底', () => {
    it('LLM 返回 scenes:[] 时抛 [EMPTY] 错，附 raw 头部供调试', async () => {
      const reply = JSON.stringify({
        title: '雨夜归人',
        synopsis: '',
        scenes: [],
      })
      const client = mockClient(reply)
      await expect(
        forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT }),
      ).rejects.toThrow(/EMPTY/)
    })

    it('错误信息里必须包含 raw= 前缀和 LLM 回复内容', async () => {
      const reply = JSON.stringify({ title: '某某', scenes: [] })
      const client = mockClient(reply)
      await expect(
        forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT }),
      ).rejects.toThrow(/raw=/)
    })

    it('所有 scene 都缺 id 导致 normalize 后实际为空 → 也抛 [EMPTY]', async () => {
      // 这种 case 更隐蔽：LLM 给了 scenes 数组但每个对象都没 id
      const reply = JSON.stringify({
        title: '某某',
        scenes: [
          { title: '第一幕', durationMs: 5000 }, // 缺 id
          { title: '第二幕', durationMs: 5000 }, // 缺 id
        ],
      })
      const client = mockClient(reply)
      await expect(
        forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT }),
      ).rejects.toThrow(/EMPTY/)
    })

    // 真实 bug 现场：5022 字剧本 / maxTokens=8000 → LLM 输出在 characters 第 6 个截断，
    // 根本没轮到 scenes 字段。修法：默认上调 maxTokens 到 16000+。
    it('maxTokens 至少 16000（防止 5K+ 字剧本撞 8K 输出窗口）', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(client.lastReq?.maxTokens ?? 0).toBeGreaterThanOrEqual(16000)
    })

    it('截断 JSON（缺 scenes 字段）→ 抛 [EMPTY] 并暗示"被截断"可能性', async () => {
      // 模拟 max_tokens 截断：JSON 在 characters 中间断了，最后没有 scenes
      const truncated = `{
  "title": "测试",
  "synopsis": "xxx",
  "characters": [
    { "id": "a", "name": "A", "prompt": "描述描述描述描述描述描述描述描述`
      const client = mockClient(truncated)
      try {
        await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
        throw new Error('应已抛错')
      } catch (e) {
        const msg = (e as Error).message
        // 必须是 EMPTY 或 PARSE（截断 JSON 也接受 PARSE 失败路径）
        expect(msg).toMatch(/EMPTY|PARSE/)
      }
    })

    it('错误信息里**绝不出现** "01 · 序章" 兜底标题（旧 bug 回归保护）', async () => {
      const reply = JSON.stringify({ title: 'x', scenes: [] })
      const client = mockClient(reply)
      try {
        await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
        throw new Error('应已抛错')
      } catch (e) {
        const msg = (e as Error).message
        // 抛错路径里不能再回到那个错误的兜底
        expect(msg).not.toContain('01 · 序章')
      }
    })
  })

  describe('与 idea 模式严格隔离', () => {
    // idea 模式 = 创作（scenarioArchitect skill）
    // script 模式 = 结构化提取（scriptStructurer skill）
    // 两条路 systemPrompt 必须不同 —— 共用即为退化
    it('script 模式的 systemPrompt 必须**不同于** idea 模式', async () => {
      const c = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(c, { script: SAMPLE_SCRIPT })
      expect(c.lastReq?.systemPrompt).not.toBe(SKILLS.scenarioArchitect)
    })
  })

  // v3 增量：schema 里新增 background + shots；既有 SAMPLE reply 不含这些字段，
  // 解析器必须保留兜底行为（background 缺 = undefined；shots 缺 = undefined，交给 migrate 兜底），
  // 同时对**包含**新字段的 reply 要吸入得当。
  describe('v3 · background + shots 解析', () => {
    it('reply 未带 background 时，scene.background 为 undefined（交给作者后补）', async () => {
      const client = mockClient(VALID_REPLY)
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(res.scenario.scenes['scene_001']?.background).toBeUndefined()
    })

    it('reply 带 background 时，逐字保留（不做润色）', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.scenes[0].background =
        '深夜，雨势渐大，巷口霓虹招牌将积水染成暗红；潮湿与焦灼'
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(res.scenario.scenes['scene_001']?.background).toBe(
        '深夜，雨势渐大，巷口霓虹招牌将积水染成暗红；潮湿与焦灼',
      )
    })

    it('reply 带 shots[] 时，按 framing / cameraHint / prompt 吸入，并选择 keyShotId', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.scenes[0].shots = [
        {
          id: 'sh_01',
          order: 0,
          framing: 'wide',
          cameraHint: 'low angle, slow dolly-in',
          prompt: '雨夜门前远景，霓虹招牌反光',
          characterIds: ['char_he'],
          transitionHint: 'cut to reaction',
        },
        {
          id: 'sh_02',
          order: 1,
          framing: 'close-up', // 非规范写法 → 应规整到 'close'
          prompt: '他湿透的鬓角，水珠从下颌滴落',
        },
      ]
      parsed.scenes[0].keyShotId = 'sh_02'
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const scene = res.scenario.scenes['scene_001']
      expect(scene?.shots?.length).toBe(2)
      expect(scene?.shots?.[0]?.framing).toBe('wide')
      expect(scene?.shots?.[0]?.cameraHint).toBe('low angle, slow dolly-in')
      expect(scene?.shots?.[1]?.framing).toBe('close')
      expect(scene?.keyShotId).toBe('sh_02')
    })

    it('reply 给了非法 keyShotId 时，回退到 shots[0].id', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.scenes[0].shots = [
        { id: 'sh_aa', order: 0, framing: 'medium', prompt: 'x' },
      ]
      parsed.scenes[0].keyShotId = 'sh_ghost'
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(res.scenario.scenes['scene_001']?.keyShotId).toBe('sh_aa')
    })

    it('shots 里的 id 缺失时，重签为 <sceneId>-sh01/02…', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.scenes[0].shots = [
        { order: 0, framing: 'wide', prompt: 'a' },
        { order: 1, framing: 'close', prompt: 'b' },
      ]
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const ids = res.scenario.scenes['scene_001']?.shots?.map((s) => s.id)
      expect(ids).toEqual(['scene_001-sh01', 'scene_001-sh02'])
    })

    it('shot.prompt 为空时，回退到 scene-level prompt（不产出空 prompt）', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.scenes[0].shots = [
        { id: 'sh_01', order: 0, framing: 'medium', prompt: '' },
      ]
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(res.scenario.scenes['scene_001']?.shots?.[0]?.prompt).toBe(
        '雨夜，男人站在门前，水珠从檐角滴落。',
      )
    })
  })

  // schema 段应当在 user prompt 里出现 background / shots 字段说明，
  // 否则 LLM 根本不知道要填这些字段。
  describe('schema 段包含新字段说明（LLM 知道要填）', () => {
    it('user prompt 含 "background" 字段示例', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(client.lastReq?.userPrompt ?? '').toContain('background')
    })

    it('user prompt 含 "shots" 字段示例与 framing 枚举', async () => {
      const client = mockClient(VALID_REPLY)
      await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const u = client.lastReq?.userPrompt ?? ''
      expect(u).toContain('shots')
      expect(u).toMatch(/wide\|medium\|close/)
    })
  })

  // v3.10 · 锚点字段往返：
  // LLM 在 reply 里给了 character.aliases / anchor / appearanceVariants 与 prop 同类字段，
  // 以及 shot.characterVariantIds / propIds / propVariantIds，normalizeScenario 必须不丢字段、
  // 不静默改名、对脏数据兜底而非抛错。这是 anchor 系统能跨 LLM 调用稳定传递的基础。
  describe('v3.10 · anchor / aliases / variants 字段往返', () => {
    it('character 的 aliases / anchor / appearanceVariants 完整保留', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.characters[0] = {
        id: 'char_he',
        name: '他',
        prompt: '中年男人，灰风衣',
        aliases: ['那个男人', '老李', '凶手'],
        anchor: '左眉疤痕，低哑嗓音',
        appearanceVariants: [
          {
            id: 'v-suit',
            label: '凶手装',
            prompt: '黑手套，带血迹',
            aliases: ['凶手'],
            mediaId: 'm-1',
          },
          { id: 'v-clean', label: '常态', prompt: '' },
        ],
      }
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const c = res.scenario.characters?.['char_he']
      expect(c?.aliases).toEqual(['那个男人', '老李', '凶手'])
      expect(c?.anchor).toBe('左眉疤痕，低哑嗓音')
      expect(c?.appearanceVariants).toHaveLength(2)
      expect(c?.appearanceVariants?.[0]).toMatchObject({
        id: 'v-suit',
        label: '凶手装',
        prompt: '黑手套，带血迹',
        aliases: ['凶手'],
        mediaId: 'm-1',
      })
      expect(c?.appearanceVariants?.[1]?.id).toBe('v-clean')
    })

    it('character.appearanceVariants 缺 label 的项被丢弃；缺 id 的兜底命名', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.characters[0].appearanceVariants = [
        { id: 'v-ok', label: '常态', prompt: '' },
        { id: 'v-no-label', prompt: '没标签' }, // 应被丢
        { label: '无 id', prompt: '' }, // id 兜底
      ]
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const variants = res.scenario.characters?.['char_he']?.appearanceVariants ?? []
      expect(variants).toHaveLength(2)
      expect(variants.map((v) => v.id)).toEqual(['v-ok', 'char_he-var3'])
    })

    it('prop 的 aliases / anchor / variants 完整保留', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.props = [
        {
          id: 'prop_knife',
          name: '猎刀',
          prompt: '黑柄折叠刀',
          aliases: ['那把刀', '凶器'],
          anchor: '黑柄、刻 K 字母',
          variants: [
            { id: 'pv-broken', label: '断刃', prompt: '刃断成两截' },
          ],
        },
      ]
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const p = res.scenario.props?.['prop_knife']
      expect(p?.aliases).toEqual(['那把刀', '凶器'])
      expect(p?.anchor).toBe('黑柄、刻 K 字母')
      expect(p?.variants).toHaveLength(1)
      expect(p?.variants?.[0]?.id).toBe('pv-broken')
    })

    it('shot 的 characterVariantIds / propIds / propVariantIds 接住', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.scenes[0].shots = [
        {
          id: 'sh_01',
          order: 0,
          framing: 'medium',
          prompt: 'x',
          characterIds: ['char_he'],
          characterVariantIds: { char_he: 'v-suit' },
          propIds: ['prop_knife'],
          propVariantIds: { prop_knife: 'pv-broken' },
        },
      ]
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      const shot = res.scenario.scenes['scene_001']?.shots?.[0]
      expect(shot?.characterVariantIds).toEqual({ char_he: 'v-suit' })
      expect(shot?.propIds).toEqual(['prop_knife'])
      expect(shot?.propVariantIds).toEqual({ prop_knife: 'pv-broken' })
    })

    it('aliases 是字符串而非数组时兜成单元素数组；脏数组里非字符串被丢', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.characters[0].aliases = '老李'
      parsed.characters[1].aliases = ['她', null, 123, '老板娘', '她']
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(res.scenario.characters?.['char_he']?.aliases).toEqual(['老李'])
      expect(res.scenario.characters?.['char_she']?.aliases).toEqual(['她', '老板娘'])
    })

    it('shot.characterVariantIds 不是对象时，安静丢弃为 undefined', async () => {
      const parsed = JSON.parse(VALID_REPLY)
      parsed.scenes[0].shots = [
        {
          id: 'sh_01',
          order: 0,
          framing: 'medium',
          prompt: 'x',
          characterVariantIds: ['char_he', 'v-suit'], // 错把它写成数组
        },
      ]
      const client = mockClient(JSON.stringify(parsed))
      const res = await forgeScenarioFromScript(client, { script: SAMPLE_SCRIPT })
      expect(
        res.scenario.scenes['scene_001']?.shots?.[0]?.characterVariantIds,
      ).toBeUndefined()
    })
  })
})
