/**
 * forgeDistillSkills.ts —— 从已有 scenario 反向提炼字段（v5 · 小说家工作板）。
 *
 * 适用 chat slash command:
 *   /synopsis  → distillSynopsis
 *   /outline   → distillOutline
 *   /relations → distillRelations
 *   /expand    → expandFromOutline (这条最重，调用现有的 forge pipeline)
 *
 * 设计取舍：
 *   - 三个 distill 用的是"轻量单次 LLM 调用 + JSON 抽取"，不接 streaming
 *     —— 单段输出短（< 1KB），等 1~3s 比维护流式抽取更实在
 *   - 容错策略：JSON 解析失败时，把 raw 文本塞进字段（synopsis 直接当字符串；
 *     outline / relations 兜底为空数组并把 raw 作为 system 消息提示作者）
 *   - extra（作者补充提示）会作为额外 instruction 附在 prompt 末尾
 *
 * 注意：这个文件是"快通道"实现，不进现有的 stage flow 状态机。它直接读 scenarioStore，
 *      LLM 调用完后直接写回 store —— 简单粗暴但够用。后续 PR 可以把它接进 stage 机。
 */

import type { TextClient } from '../llm/types'
import type {
  Character,
  CharacterRelation,
  Location,
  OutlineNode,
  Prop,
  Scenario,
} from '../scenario/types'

function pickScenarioContext(s: Scenario): string {
  const parts: string[] = []
  if (s.title) parts.push(`# ${s.title}`)
  if (s.synopsis) parts.push(`## 现有梗概\n${s.synopsis}`)

  const charNames = Object.values(s.characters ?? {})
    .map((c) => `- ${c.name}: ${c.prompt}`)
    .join('\n')
  if (charNames) parts.push(`## 角色\n${charNames}`)

  const sceneIds = Object.keys(s.scenes ?? {})
  if (sceneIds.length > 0) {
    const lines = sceneIds.slice(0, 30).map((id) => {
      const sc = s.scenes[id]!
      const dlg = sc.dialogue
        .slice(0, 3)
        .map((d) => `${d.speaker || '旁白'}: ${d.text}`)
        .join(' / ')
      return `- ${sc.title}${dlg ? `（${dlg}）` : ''}`
    })
    parts.push(`## 场景节奏（前 30 场）\n${lines.join('\n')}`)
  }
  return parts.join('\n\n')
}

/**
 * 从 scenes 反向提炼一段连贯梗概（120 ~ 250 字）。
 */
export async function distillSynopsis(
  llm: TextClient,
  scenario: Scenario,
  extra: string,
): Promise<string> {
  const ctx = pickScenarioContext(scenario)
  const raw = await llm.generate({
    systemPrompt: `你是一位资深影视投稿编辑。读完作者的故事素材后，写一段 120~250 字的中文梗概，用于宣传与投稿。要求：
- 一段连贯文字，不分点；
- 给出一句"魂魄式"的开场，再带出主线冲突与未说尽的钩子；
- 不剧透结局，但暗示其重量；
- 不用"本剧 / 故事讲述"等评论体。`,
    userPrompt: `${ctx}\n\n${extra ? `【作者补充】${extra}\n` : ''}现在请写梗概。只输出梗概正文，不要任何标题或说明。`,
    maxTokens: 600,
  })
  return raw.trim()
}

/**
 * 从 scenes 反向提炼"幕 → Beat"两层大纲。
 * 输出 JSON：[{ id, title, summary, parentId?, order }]
 */
export async function distillOutline(
  llm: TextClient,
  scenario: Scenario,
  extra: string,
): Promise<OutlineNode[]> {
  const ctx = pickScenarioContext(scenario)
  const raw = await llm.generate({
    systemPrompt: `你是一位剧本结构编辑，从作者素材中抽提出"幕 → Beat"两层大纲。返回严格 JSON 数组，每个元素：
{ "id": "act-1" 或 "beat-1-2", "title": "中文标题", "summary": "一两句话概要", "parentId": null 或 "act-x", "order": 0 }
- 顶层 act 用 "act-1" / "act-2" 这种 id；beat 用 "beat-1-1" / "beat-1-2"；
- act 数 3~5；每幕 2~4 个 beat；
- 只返回 JSON 数组，不要 markdown fence，不要解释。`,
    userPrompt: `${ctx}\n\n${extra ? `【作者补充】${extra}\n` : ''}请输出大纲 JSON 数组。`,
    maxTokens: 1500,
  })
  const arr = parseJsonArray(raw)
  if (!arr) return []
  return arr
    .filter(
      (n): n is OutlineNode =>
        typeof n === 'object' &&
        n !== null &&
        typeof (n as Record<string, unknown>).id === 'string' &&
        typeof (n as Record<string, unknown>).title === 'string',
    )
    .map((n, idx) => ({
      id: n.id,
      title: n.title,
      summary: typeof n.summary === 'string' ? n.summary : undefined,
      parentId: typeof n.parentId === 'string' ? n.parentId : undefined,
      order: typeof n.order === 'number' ? n.order : idx,
    }))
}

/**
 * 从 scenes / 对话 / 角色名识别人物关系。
 * 输出 JSON：[{ id, fromCharId, toCharId, label, note? }]
 */
export async function distillRelations(
  llm: TextClient,
  scenario: Scenario,
  extra: string,
): Promise<CharacterRelation[]> {
  const characters = Object.values(scenario.characters ?? {})
  if (characters.length < 2) {
    return []
  }
  const ctx = pickScenarioContext(scenario)
  const charJSON = characters.map((c) => ({ id: c.id, name: c.name })).slice(0, 30)
  const raw = await llm.generate({
    systemPrompt: `你是剧本结构师。读完素材后，识别角色之间的关键关系（情感 / 血缘 / 利害 / 师徒…）并以 JSON 数组返回，每元素：
{ "id": "rel-1", "fromCharId": "<必须出现在角色清单的 id>", "toCharId": "<同左>", "label": "中文关系标签 (10 字内)", "note": "可选, 关系演变" }
- 单向边：A→B 与 B→A 各算一条（"暗恋 / 当哥们" 不对等）；
- 不要造不在角色清单里的 id；
- 8 条以内，挑最关键的；
- 只返回 JSON 数组。`,
    userPrompt: `## 角色清单\n${JSON.stringify(charJSON)}\n\n${ctx}\n\n${extra ? `【作者补充】${extra}\n` : ''}请输出关系 JSON 数组。`,
    maxTokens: 800,
  })
  const arr = parseJsonArray(raw)
  if (!arr) return []
  const validIds = new Set(characters.map((c) => c.id))
  return arr
    .filter(
      (r): r is CharacterRelation =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as Record<string, unknown>).fromCharId === 'string' &&
        typeof (r as Record<string, unknown>).toCharId === 'string' &&
        validIds.has((r as Record<string, unknown>).fromCharId as string) &&
        validIds.has((r as Record<string, unknown>).toCharId as string),
    )
    .map((r, idx) => ({
      id: typeof r.id === 'string' ? r.id : `rel-${Date.now().toString(36)}-${idx}`,
      fromCharId: r.fromCharId,
      toCharId: r.toCharId,
      label: typeof r.label === 'string' ? r.label : '关系',
      note: typeof r.note === 'string' ? r.note : undefined,
    }))
}

/**
 * 视觉抽取专用上下文 —— 比 pickScenarioContext 更"看得见画面"。
 *
 * 场所 / 道具 的外观线索藏在 scene.background / prompts.scene / shot.prompt 里，
 * 默认 pickScenarioContext 只给标题 + 前几句台词，不够抽视觉锚点。这里把每场的
 * 舞美/画面/分镜描述拼进去（截断防爆 token），供 distillLocations/distillProps 用。
 */
function pickVisualContext(s: Scenario): string {
  const parts: string[] = []
  if (s.title) parts.push(`# ${s.title}`)
  if (s.synopsis) parts.push(`## 梗概\n${s.synopsis}`)

  const sceneIds = Object.keys(s.scenes ?? {})
  if (sceneIds.length > 0) {
    const lines = sceneIds.slice(0, 40).map((id) => {
      const sc = s.scenes[id]!
      const bits: string[] = [`- 【${sc.title}】`]
      if (sc.background?.trim()) bits.push(`舞美:${sc.background.trim()}`)
      const scenePrompt = sc.prompts?.scene?.trim() || sc.media?.prompt?.trim()
      if (scenePrompt) bits.push(`画面:${scenePrompt}`)
      const shotPrompts = (sc.shots ?? [])
        .map((sh) => sh.prompt?.trim())
        .filter(Boolean)
        .slice(0, 4)
      if (shotPrompts.length > 0) bits.push(`分镜:${shotPrompts.join(' / ')}`)
      return bits.join(' ').slice(0, 400)
    })
    parts.push(`## 场景画面线索（前 40 场）\n${lines.join('\n')}`)
  }
  return parts.join('\n\n')
}

/**
 * 从已有剧本里抽取「场所」清单（→ scenario.locations）。
 *
 * 提示词规则复用 promptForge.ts 的 buildScenarioSchemaBlock / buildScriptSchemaBlock
 * 场所模板（约 50-100 字、描述空场、主要场所 2-5 个上限 8），保证与 forge 全量
 * 扩写出的场所质量一致。
 */
export async function distillLocations(
  llm: TextClient,
  scenario: Scenario,
  extra = '',
): Promise<Location[]> {
  const ctx = pickVisualContext(scenario)
  const raw = await llm.generate({
    systemPrompt: `你是资深影视美术指导。从作者已有的剧本（舞美/画面/分镜描述）里抽取**主要场所**清单，用于生成"空场基准图"。返回严格 JSON 数组，每元素：
{ "id": "loc_xxx", "name": "<场所中文名（短）>", "prompt": "<场所外观提示词，约 50-100 字：建筑/室内外/材质/光线/气氛/时代感。描述空场，不要写具体角色。>" }
- 覆盖所有**主要场所**（通常 2-5 个，上限 8）；同一地点不同时间算同一场所；
- 一次性背景、或仅一句话带过的环境，不要进；
- prompt 优先用原文对该场所的描写；原文没细写就据剧情合理补全外观（仍只写空场，不写角色）；
- id 用 "loc_" 前缀的稳定短标识；
- 只返回 JSON 数组，不要 markdown fence，不要解释。`,
    userPrompt: `${ctx}\n\n${extra ? `【作者补充】${extra}\n` : ''}请输出场所 JSON 数组。`,
    maxTokens: 1800,
  })
  const arr = parseJsonArray(raw)
  if (!arr) return []
  const out: Location[] = []
  const seen = new Set<string>()
  arr.forEach((n, idx) => {
    if (typeof n !== 'object' || n === null) return
    const r = n as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (!name) return
    let id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `loc_${idx + 1}`
    while (seen.has(id)) id = `${id}_${idx}`
    seen.add(id)
    const prompt = typeof r.prompt === 'string' && r.prompt.trim() ? r.prompt.trim() : name
    out.push({ id, name, prompt })
  })
  return out
}

/**
 * 从已有剧本里抽取「关键道具」清单（→ scenario.props）。
 *
 * 提示词规则复用 promptForge.ts 的道具模板（约 30-60 字、仅"反复出现 + 有身份
 * 识别度"、0-6 件上限），与 forge 全量扩写道具质量对齐。
 */
export async function distillProps(
  llm: TextClient,
  scenario: Scenario,
  extra = '',
): Promise<Prop[]> {
  const ctx = pickVisualContext(scenario)
  const raw = await llm.generate({
    systemPrompt: `你是影视道具 / 美术指导。从剧本里抽取**关键道具**（跨镜头反复出现 + 有身份识别度：信物 / 武器 / 徽章 / 关键文件 等），用于生成独立基准图。返回严格 JSON 数组，每元素：
{ "id": "prop_xxx", "name": "<关键道具中文名>", "prompt": "<道具外观提示词，约 30-60 字：材质/颜色/形态/标识细节>", "anchor": "<可选，最稳定识别特征，如'黑漆刀鞘、刃口缺一角'>", "aliases": ["可选别名，如'那把刀'/'凶器'"] }
- **仅**列"跨镜头反复出现 + 有身份识别度"的关键道具；普通桌椅门窗杯碗不要进；
- 0-6 件上限；宁缺毋滥；
- prompt 优先用原文描写，原文没写就据其身份合理补全材质/形态；
- id 用 "prop_" 前缀的稳定短标识；
- 只返回 JSON 数组，不要 markdown fence，不要解释。`,
    userPrompt: `${ctx}\n\n${extra ? `【作者补充】${extra}\n` : ''}请输出关键道具 JSON 数组。`,
    maxTokens: 1500,
  })
  const arr = parseJsonArray(raw)
  if (!arr) return []
  const out: Prop[] = []
  const seen = new Set<string>()
  arr.forEach((n, idx) => {
    if (typeof n !== 'object' || n === null) return
    const r = n as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (!name) return
    let id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `prop_${idx + 1}`
    while (seen.has(id)) id = `${id}_${idx}`
    seen.add(id)
    const prompt = typeof r.prompt === 'string' && r.prompt.trim() ? r.prompt.trim() : name
    const anchor =
      typeof r.anchor === 'string' && r.anchor.trim() ? r.anchor.trim() : undefined
    const aliases = Array.isArray(r.aliases)
      ? r.aliases.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
      : undefined
    out.push({
      id,
      name,
      prompt,
      ...(anchor ? { anchor } : {}),
      ...(aliases && aliases.length > 0 ? { aliases } : {}),
    })
  })
  return out
}

/**
 * 角色抽取专用上下文 —— 把"对白发言人花名册 + 画面里的人物外观线索"拼给 LLM。
 *
 * 为什么单独做：screenplay 导入只带场景 + 对白，没有 characters 字段。主要人物
 * 其实藏在「对白 speaker」里（出现频次高 = 主角/关键配角），外观线索藏在
 * scene.background / prompts.scene / shot.prompt 里。pickScenarioContext 给的
 * 角色清单此时为空，故这里按发言频次排出花名册 + 视觉线索，供 distillCharacters 用。
 */
function pickCharacterContext(s: Scenario): string {
  const parts: string[] = []
  if (s.title) parts.push(`# ${s.title}`)
  if (s.synopsis) parts.push(`## 梗概\n${s.synopsis}`)

  // 对白发言人花名册（按出现频次降序）
  const counts = new Map<string, { n: number; lines: string[] }>()
  for (const sc of Object.values(s.scenes ?? {})) {
    for (const d of sc.dialogue ?? []) {
      const sp = (d.speaker ?? '').trim()
      if (!sp || sp === '旁白' || sp === '众人') continue
      const e = counts.get(sp) ?? { n: 0, lines: [] }
      e.n += 1
      if (e.lines.length < 2 && d.text?.trim()) e.lines.push(d.text.trim().slice(0, 36))
      counts.set(sp, e)
    }
  }
  const roster = [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 15)
    .map(([sp, e]) => `- ${sp}（出现 ${e.n} 次）${e.lines.length ? '：' + e.lines.join(' / ') : ''}`)
    .join('\n')
  if (roster) parts.push(`## 对白发言人花名册（频次降序）\n${roster}`)

  // 画面里的人物外观线索（截断防爆 token）
  const sceneIds = Object.keys(s.scenes ?? {})
  if (sceneIds.length > 0) {
    const lines = sceneIds
      .slice(0, 40)
      .map((id) => {
        const sc = s.scenes[id]!
        const cues = [sc.background?.trim(), sc.prompts?.scene?.trim(), sc.media?.prompt?.trim()]
          .filter(Boolean)
          .join(' ')
        return cues ? `- 【${sc.title}】${cues.slice(0, 300)}` : ''
      })
      .filter(Boolean)
    if (lines.length > 0) parts.push(`## 画面/舞美线索（可能含人物外观）\n${lines.join('\n')}`)
  }
  return parts.join('\n\n')
}

/**
 * 从已有剧本（对白 + 画面线索）里抽取「主要角色」清单（→ scenario.characters）。
 *
 * 专为"screenplay 导入只带场景、没有 characters 字段"的剧本补锚点：让 generate-visuals
 * 能自动提取人物并生成角色定妆照（三视图），不再依赖人工手动塞 characters。
 * prompt（外观气质）会直接喂 characterRefPass 生成 turnaround，故要求覆盖
 * 年龄/体型/发型/服饰/气质/标志特征。
 */
export async function distillCharacters(
  llm: TextClient,
  scenario: Scenario,
  extra = '',
): Promise<Character[]> {
  const ctx = pickCharacterContext(scenario)
  const raw = await llm.generate({
    systemPrompt: `你是资深影视选角 / 人物设定指导。从作者已有的剧本（对白发言人 + 画面线索）里抽取**主要角色**清单，用于生成"角色定妆照（三视图）"。返回严格 JSON 数组，每元素：
{ "id": "char_xxx", "name": "<角色中文名（与对白发言人一致）>", "prompt": "<外观气质提示词，约 60-120 字：年龄/性别/体型/发型发色/服饰造型/气质神态/标志性特征。可据剧情合理补全，但要贴合时代与身份。只写人物本身，不写场景。>" }
- 覆盖**主角 + 关键配角 + 主要反派**（通常 3-6 个，上限 8）；只在个别场景一闪而过、无戏份的龙套不要进；
- name 必须用对白花名册里真实出现的名字（别造名）；
- prompt 优先用原文/画面线索里的外观描写，原文没写就据其身份、年龄、阵营合理补全造型；
- 同一角色若剧情中有换装/受伤/成长等明显形态变化，只在 prompt 末尾用一句话点出"后期：…"，不要拆成多个角色；
- id 用 "char_" 前缀的稳定短标识；
- 只返回 JSON 数组，不要 markdown fence，不要解释。`,
    userPrompt: `${ctx}\n\n${extra ? `【作者补充】${extra}\n` : ''}请输出主要角色 JSON 数组。`,
    maxTokens: 2000,
  })
  const arr = parseJsonArray(raw)
  if (!arr) return []
  const out: Character[] = []
  const seen = new Set<string>()
  arr.forEach((n, idx) => {
    if (typeof n !== 'object' || n === null) return
    const r = n as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (!name) return
    let id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `char_${idx + 1}`
    while (seen.has(id)) id = `${id}_${idx}`
    seen.add(id)
    const prompt = typeof r.prompt === 'string' && r.prompt.trim() ? r.prompt.trim() : name
    out.push({ id, name, prompt })
  })
  return out
}

/**
 * 从 raw 字符串里抽 JSON 数组（容错 markdown fence / 文字包裹）。
 */
function parseJsonArray(raw: string): unknown[] | null {
  const fenceStripped = raw.replace(/```json\s*|```\s*/g, '').trim()
  // 先试整体 parse
  try {
    const v = JSON.parse(fenceStripped)
    if (Array.isArray(v)) return v
  } catch {
    /* fall through to bracket scan */
  }
  // bracket scan：找第一个 [ 与最后一个 ]
  const start = fenceStripped.indexOf('[')
  const end = fenceStripped.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const v = JSON.parse(fenceStripped.slice(start, end + 1))
      if (Array.isArray(v)) return v
    } catch {
      return null
    }
  }
  return null
}
