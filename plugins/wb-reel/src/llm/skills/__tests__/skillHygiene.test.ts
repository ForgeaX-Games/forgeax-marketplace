import { describe, expect, it } from 'vitest'
import { SKILLS, type SkillName } from '../index'

/**
 * Skill 文档的"卫生检查"——
 *
 * 历史 bug：早期 skill 里写过 `{{DIRECTOR_PERSONA}}`、
 * `{{DIRECTOR_STYLE_DISPLAY_NAME}}` 这种 mustache 占位，意图是
 * "调用方做模板替换"，但**调用方从未做过模板替换**。
 *
 * 后果：模型同时读到
 *   1. 由 forgeXxx 拼到 system prompt 顶部的真实 persona 块
 *   2. skill 文档里写死的字面量 `{{DIRECTOR_PERSONA}}`
 * 模型会困惑、有时会把这串字面量原样吐回去。
 *
 * 这组测试拦住未来误回潮：
 *   - 不允许在 skill 主体里"独占一行"地出现 `{{DIRECTOR_PERSONA}}`
 *     （这是被错误地当作占位符使用的特征——单独成行 = 期望被替换）
 *   - 允许把它写在 inline backtick 句子里（"NEVER 引用 `{{...}}`"）作为
 *     反向告诫
 *   - 不允许 skill 顶部紧跟 ` ``` ` ``` ``` ` 的空 fence（旧模式遗留）
 *
 * 任何 skill 不通过都让 CI 卡住。
 */

const SKILL_NAMES = Object.keys(SKILLS) as SkillName[]

describe('skills · 文档卫生', () => {
  it.each(SKILL_NAMES)(
    '%s 不含独占一行的 {{...}} mustache 占位符',
    (name) => {
      const md = SKILLS[name]
      // 独占一行 = 整行除了占位符外只有空白
      // 例：`{{DIRECTOR_PERSONA}}\n`、`  {{X}}  \n`
      const lines = md.split('\n')
      const offenders: { line: number; text: string }[] = []
      lines.forEach((line, i) => {
        const trimmed = line.trim()
        if (/^\{\{[A-Z0-9_]+\}\}$/.test(trimmed)) {
          offenders.push({ line: i + 1, text: trimmed })
        }
      })
      if (offenders.length > 0) {
        const detail = offenders
          .map((o) => `  line ${o.line}: ${o.text}`)
          .join('\n')
        throw new Error(
          `skill ${name} 含独占一行的 mustache 占位符（调用方不会做模板替换，` +
            `这会让模型同时读到真实 persona + 字面占位串）：\n${detail}`,
        )
      }
    },
  )

  it.each(SKILL_NAMES)('%s 没有空的 ``` ... ``` fence 块', (name) => {
    const md = SKILLS[name]
    // 匹配空 fence: ```\n[只有空白]\n```（含可选语言标签）
    const emptyFenceRe = /```[a-z0-9]*\n\s*\n```/gi
    const matches = md.match(emptyFenceRe) ?? []
    expect(
      matches,
      'skill ' +
        name +
        ' 含空 code fence —— 通常意味着旧模板里 mustache 被去掉后剩了空 fence，' +
        '应该一并删掉外层 fence',
    ).toEqual([])
  })

  it.each(SKILL_NAMES)('%s 长度合理（既非空也非超长）', (name) => {
    const md = SKILLS[name]
    expect(md.length, `${name} 是空字符串，loader 没读到`).toBeGreaterThan(200)
    // 32K 字符 ≈ 16K token，单 skill 超过这个量级几乎一定是失控
    expect(
      md.length,
      `${name} 超过 32K 字符，应该拆分成多个 skill 或精简`,
    ).toBeLessThan(32_000)
  })

  it('SKILLS 字典完整 —— 每个键都解析为非空字符串', () => {
    for (const name of SKILL_NAMES) {
      expect(typeof SKILLS[name]).toBe('string')
      expect(SKILLS[name].length).toBeGreaterThan(0)
    }
  })
})

describe('skills · scenario-architect / batch-prompt-trio (P0 强约束)', () => {
  /**
   * 这两个 skill 经过 the reference agent CLI 风格重写，必须包含若干"硬指令前缀"
   * 与"自检块"——这是 Claude/GPT 对约束注意力权重的关键。
   * 这组测试不验语义，只验"风格 marker 仍在"，防止后续 PR 误删。
   */

  it('scenario-architect 含 IMPORTANT/CRITICAL/NEVER 至少各一处', () => {
    const md = SKILLS.scenarioArchitect
    expect(md).toMatch(/IMPORTANT/i)
    expect(md).toMatch(/CRITICAL/i)
    expect(md).toMatch(/NEVER|ALWAYS/i)
  })

  it('scenario-architect 含 <example> 与 <bad-example>', () => {
    const md = SKILLS.scenarioArchitect
    expect(md).toMatch(/<example/)
    expect(md).toMatch(/<bad-example/)
  })

  it('scenario-architect 含输出前自检块', () => {
    const md = SKILLS.scenarioArchitect
    expect(md).toMatch(/Self-check|自检/)
  })

  it('batch-prompt-trio 含 CRITICAL 跨 scene 一致性提示', () => {
    const md = SKILLS.batchPromptTrio
    expect(md).toMatch(/CRITICAL/)
    expect(md).toMatch(/跨 scene|cross.?scene|一致性/)
  })

  it('batch-prompt-trio 含 <bad-example> 至少一处', () => {
    const md = SKILLS.batchPromptTrio
    expect(md).toMatch(/<bad-example/)
  })

  it('batch-prompt-trio 含输出前自检块', () => {
    const md = SKILLS.batchPromptTrio
    expect(md).toMatch(/Self-check|自检/)
  })
})

describe('skills · P1 重写 (outline / prose-beats / storyboard / kinetic) 风格 marker', () => {
  /**
   * P1 批次：把第二轮 the reference agent CLI 风格重写过的几个 skill 也锁住风格 marker,
   * 防止后续 PR 误删 IMPORTANT/CRITICAL 前缀或自检块。
   *
   * 不检语义,只检 marker 在场。
   */

  it.each([
    'outlineArchitect',
    'proseToBeats',
    'proseToBeatsChunked',
    'storyboardDirector',
    'kineticVideoPrompt',
  ] as const)('%s 含 IMPORTANT 或 CRITICAL 前缀', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/IMPORTANT|CRITICAL/)
  })

  it.each([
    'outlineArchitect',
    'proseToBeats',
    'proseToBeatsChunked',
    'storyboardDirector',
    'kineticVideoPrompt',
  ] as const)('%s 含 NEVER 或 ALWAYS 硬约束', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/NEVER|ALWAYS/)
  })

  it.each([
    'outlineArchitect',
    'proseToBeats',
    'proseToBeatsChunked',
    'storyboardDirector',
    'kineticVideoPrompt',
  ] as const)('%s 含输出前自检块', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/Self-check|自检/)
  })

  it.each([
    'outlineArchitect',
    'proseToBeats',
    'proseToBeatsChunked',
    'storyboardDirector',
    'kineticVideoPrompt',
  ] as const)('%s 至少含一个 <bad-example>', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/<bad-example/)
  })
})

describe('skills · P2 重写 (cinema-image / cinema-video / dialogue / image-seed / index-scanner) 风格 marker', () => {
  /**
   * P2 批次：第三轮 the reference agent CLI 风格重写过的 5 个 skill,
   * 同样锁住 IMPORTANT/CRITICAL + NEVER/ALWAYS + 自检块 + <bad-example> 四件套.
   */

  const P2_SKILLS = [
    'cinemaImagePrompt',
    'cinemaVideoPrompt',
    'dialogueCraft',
    'imageToStorySeed',
    'scriptIndexScanner',
  ] as const

  it.each(P2_SKILLS)('%s 含 IMPORTANT 或 CRITICAL 前缀', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/IMPORTANT|CRITICAL/)
  })

  it.each(P2_SKILLS)('%s 含 NEVER 或 ALWAYS 硬约束', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/NEVER|ALWAYS/)
  })

  it.each(P2_SKILLS)('%s 含输出前自检块', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/Self-check|自检/)
  })

  it.each(P2_SKILLS)('%s 至少含一个 <bad-example>', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/<bad-example/)
  })
})

describe('skills · P3 Forge 模块化新批 (style-curator / logline / synopsis / forge-chat-aligner) 风格 marker', () => {
  /**
   * P3 批次：PR5 Forge 模块化锻造管道引入的 4 个新 skill,
   * 都按 the reference agent CLI 风格写成. 锁住 IMPORTANT/CRITICAL + NEVER/ALWAYS + 自检块 + <bad-example> 四件套,
   * 防止后续重构误删风格 marker.
   */

  const P3_SKILLS = [
    'styleCurator',
    'loglineWriter',
    'synopsisWriter',
    'forgeChatAligner',
  ] as const

  it.each(P3_SKILLS)('%s 含 IMPORTANT 或 CRITICAL 前缀', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/IMPORTANT|CRITICAL/)
  })

  it.each(P3_SKILLS)('%s 含 NEVER 或 ALWAYS 硬约束', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/NEVER|ALWAYS/)
  })

  it.each(P3_SKILLS)('%s 含输出前自检块', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/Self-check|自检/)
  })

  it.each(P3_SKILLS)('%s 至少含一个 <bad-example>', (key) => {
    const md = SKILLS[key]
    expect(md).toMatch(/<bad-example/)
  })
})

describe('skills · outline-architect alias 字段约束 (PR5)', () => {
  /**
   * PR5 给 outline-architect 加了 characterAliases 字段, 用于在大纲阶段就锁住
   * 角色称谓表, 给下游 entity-resolution 当锚点. 这里检查 skill 文档把这个字段
   * 落在了 Output contract / Hard constraints / Self-check 三处, 否则模型很容易漏吐.
   */

  it('outlineArchitect 在 Output contract 里包含 characterAliases', () => {
    const md = SKILLS.outlineArchitect
    expect(md).toMatch(/characterAliases/)
  })

  it('outlineArchitect 至少有一处 aliases 长度硬约束', () => {
    const md = SKILLS.outlineArchitect
    expect(md).toMatch(/aliases.*≥\s*2|aliases.*length.*2|长度\s*≥\s*2/)
  })

  it('outlineArchitect 自检块包含 aliases / 称谓 检查项', () => {
    const md = SKILLS.outlineArchitect
    expect(md).toMatch(/aliases|称谓|指称/)
  })
})

describe('skills · 全量 fence 收支平衡', () => {
  /**
   * 历史上出过 "skill 顶部丢了 ` ``` ` 闭合, 整段被当成代码块" 的事故。
   * 这个 sanity 测试: 三反引号 fence 必须成对出现 (偶数个)。
   *
   * NB: 用四反引号块 (```` ``` ```` 这种 inline 反引号) 写示例时，
   * inline 单反引号不会被这个 regex 误判 (我们只数 `\n```` 行首/独立行)。
   */
  it.each(SKILL_NAMES)('%s 三反引号 fence 配对', (name) => {
    const md = SKILLS[name]
    const fenceLines = md.split('\n').filter((l) => /^\s*```/.test(l))
    expect(
      fenceLines.length % 2,
      `${name} 共有 ${fenceLines.length} 个 fence 行, 不成对 — 大概率是有围栏漏闭合或多余开闭符`,
    ).toBe(0)
  })
})
