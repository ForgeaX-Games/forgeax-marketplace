import { describe, expect, it } from 'vitest'
import { buildForgeRequest, routeForgeIntent } from '../forgeChatRouter'
import type { Attachment } from '../forgeChatStore'

/**
 * Forge 对话输入 → LLM 请求的路由逻辑。
 *
 * 需求（作者反馈）：
 *   "我输入想法进行生成" / "我上传文件，你不用打开文件，你只需要拿着这个文件+
 *    我们的元提示词，给 llm，等他的返回就行"
 *
 * 路由策略（v1）：
 *   - 只有 text 文本 → mode='idea'
 *   - 任何附件带 text 文件 → mode='script'，文本拼接到 user prompt
 *   - 图片附件：v1 仅作为"参考图"保留在会话历史里，**不**塞进 Claude 的 text
 *     prompt（我们还没给 ClaudeAzureProvider 接多模态 content 数组），但要给
 *     UI 一个明确 note，让作者知道图没被送进 LLM
 *
 * 本纯函数好处：
 *   - ChatPanel 只管收集输入和渲染消息，路由逻辑独立可单测
 *   - 以后要接多模态时只改这个文件，不动 UI
 */

function textAtt(content: string, filename = 'a.md'): Attachment {
  return {
    id: 'att-x',
    kind: 'text',
    filename,
    bytes: content.length,
    createdAt: 0,
    content,
  }
}

function imgAtt(): Attachment {
  return {
    id: 'att-img',
    kind: 'image',
    filename: 'ref.png',
    bytes: 2048,
    createdAt: 0,
    dataUrl: 'data:image/png;base64,xxx',
    mimeType: 'image/png',
  }
}

describe('buildForgeRequest', () => {
  it('只有文本 → idea 模式', () => {
    const req = buildForgeRequest({ text: '一个男人雨夜敲门', attachments: [] })
    if (req.mode !== 'idea') throw new Error(`expected idea, got ${req.mode}`)
    expect(req.idea).toContain('雨夜')
    expect(req.droppedImageNote).toBeUndefined()
  })

  it('空输入 + 没附件 → invalid', () => {
    const req = buildForgeRequest({ text: '   ', attachments: [] })
    expect(req.mode).toBe('invalid')
  })

  it('text 附件 → script 模式，多份附件按分隔符拼', () => {
    const req = buildForgeRequest({
      text: '请结构化这份剧本',
      attachments: [textAtt('第一幕 内容 A', 'a.md'), textAtt('第二幕 内容 B', 'b.md')],
    })
    if (req.mode !== 'script') throw new Error(`expected script, got ${req.mode}`)
    expect(req.script).toContain('请结构化这份剧本')
    expect(req.script).toContain('a.md')
    expect(req.script).toContain('第一幕')
    expect(req.script).toContain('b.md')
    expect(req.script).toContain('第二幕')
  })

  it('仅图片 → invalid + droppedImageNote（v1 不支持纯图片锻造）', () => {
    const req = buildForgeRequest({ text: '', attachments: [imgAtt()] })
    expect(req.mode).toBe('invalid')
    expect(req.droppedImageNote).toContain('图片')
  })

  it('文本 + 图片混合 → idea/script，图片被 note 提示"仅保留不参与锻造"', () => {
    const req = buildForgeRequest({
      text: '继续扩展这个想法',
      attachments: [imgAtt()],
    })
    expect(req.mode).toBe('idea')
    expect(req.droppedImageNote).toContain('图片')

    const reqScript = buildForgeRequest({
      text: '',
      attachments: [textAtt('剧本'), imgAtt()],
    })
    expect(reqScript.mode).toBe('script')
    expect(reqScript.droppedImageNote).toContain('图片')
  })
})

/*
 * v3.10 · routeForgeIntent —— 模块化锻造的意图分流。
 *
 * 测试目标：
 *   1. 各 stage 下关键词命中正确（advance / regenerate / commit / revert）
 *   2. patch 是中段 stage 的兜底（任何非空非命中文本）
 *   3. 终态/等待态（await-assets / generating-assets）拒绝随意发言，给友好 noop
 *   4. revert / commit 这类跨 stage 关键词的优先级高于按 stage 分流
 *   5. confirmed 状态把输入视作"新一轮 start-forge"
 *   6. exhaustive switch —— 加 stage 时编译器报错（在 router 那边走 never）
 */
describe('routeForgeIntent', () => {
  it('idle —— 输入想法 → start-forge.idea', () => {
    const r = routeForgeIntent({
      stage: 'idle',
      text: '一个少年寻剑的故事',
      attachments: [],
    })
    expect(r.kind).toBe('start-forge')
    if (r.kind !== 'start-forge') return
    expect(r.payload.mode).toBe('idea')
  })

  it('idle —— 上传剧本附件 → start-forge.script', () => {
    const r = routeForgeIntent({
      stage: 'idle',
      text: '',
      attachments: [textAtt('第一幕：开场')],
    })
    expect(r.kind).toBe('start-forge')
    if (r.kind !== 'start-forge') return
    expect(r.payload.mode).toBe('script')
  })

  it('idle —— 空输入 → noop', () => {
    const r = routeForgeIntent({ stage: 'idle', text: '   ', attachments: [] })
    expect(r.kind).toBe('noop')
  })

  it('logline —— 关键词「确认」→ advance', () => {
    const r = routeForgeIntent({ stage: 'logline', text: '确认', attachments: [] })
    expect(r).toEqual({ kind: 'advance', targetStage: 'logline' })
  })

  it('logline —— 关键词「下一步」→ advance', () => {
    const r = routeForgeIntent({
      stage: 'logline',
      text: '好的,下一步',
      attachments: [],
    })
    expect(r.kind).toBe('advance')
  })

  it('logline —— 关键词「重写」→ regenerate', () => {
    const r = routeForgeIntent({
      stage: 'logline',
      text: '重写',
      attachments: [],
    })
    expect(r).toEqual({ kind: 'regenerate', stage: 'logline' })
  })

  it('logline —— 任意非命中文本 → patch', () => {
    const r = routeForgeIntent({
      stage: 'logline',
      text: '把主角改成女性，加一只会说话的猫',
      attachments: [],
    })
    expect(r.kind).toBe('patch')
    if (r.kind !== 'patch') return
    expect(r.stage).toBe('logline')
    expect(r.instruction).toContain('女性')
  })

  it('outline —— patch 携带原文给下游 LLM 当 instruction', () => {
    const r = routeForgeIntent({
      stage: 'outline',
      text: '第三章节奏太慢，砍掉一半',
      attachments: [],
    })
    expect(r.kind).toBe('patch')
    if (r.kind !== 'patch') return
    expect(r.instruction).toContain('节奏太慢')
  })

  it('expansion —— 「再来一次」命中 regenerate', () => {
    const r = routeForgeIntent({
      stage: 'expansion',
      text: '再来一次',
      attachments: [],
    })
    expect(r).toEqual({ kind: 'regenerate', stage: 'expansion' })
  })

  it('回退 —— 「回到 outline 改一下」→ revert-to outline', () => {
    const r = routeForgeIntent({
      stage: 'expansion',
      text: '回到 outline 改一下',
      attachments: [],
    })
    expect(r).toEqual({ kind: 'revert-to', stage: 'outline' })
  })

  it('回退 —— 「回到一句话」→ revert-to logline', () => {
    const r = routeForgeIntent({
      stage: 'outline',
      text: '回到一句话',
      attachments: [],
    })
    expect(r).toEqual({ kind: 'revert-to', stage: 'logline' })
  })

  it('回退 —— 「退回风格」→ revert-to await-style', () => {
    const r = routeForgeIntent({
      stage: 'logline',
      text: '退回风格',
      attachments: [],
    })
    expect(r).toEqual({ kind: 'revert-to', stage: 'await-style' })
  })

  it('优先级 —— 「回到 outline 重写」revert 优先于 regenerate', () => {
    // "重写" 单独会命中 regenerate，但整句以 "回到" 开头 → revert 优先
    const r = routeForgeIntent({
      stage: 'expansion',
      text: '回到 outline 重写',
      attachments: [],
    })
    expect(r.kind).toBe('revert-to')
  })

  it('await-assets —— 「开始生成资产」→ commit-forge', () => {
    const r = routeForgeIntent({
      stage: 'await-assets',
      text: '开始生成资产',
      attachments: [],
    })
    expect(r).toEqual({ kind: 'commit-forge' })
  })

  it('await-assets —— 「出资产」也命中 commit-forge', () => {
    const r = routeForgeIntent({
      stage: 'await-assets',
      text: '出资产',
      attachments: [],
    })
    expect(r.kind).toBe('commit-forge')
  })

  it('await-assets —— 闲聊 → noop（带提示）', () => {
    const r = routeForgeIntent({
      stage: 'await-assets',
      text: '我再想想要不要现在生',
      attachments: [],
    })
    expect(r.kind).toBe('noop')
    if (r.kind !== 'noop') return
    expect(r.reason).toContain('开始生成资产')
  })

  it('generating-assets —— 「全部确认」→ commit-assets', () => {
    const r = routeForgeIntent({
      stage: 'generating-assets',
      text: '全部确认',
      attachments: [],
    })
    expect(r).toEqual({ kind: 'commit-assets' })
  })

  it('generating-assets —— 「资产入库」→ commit-assets', () => {
    const r = routeForgeIntent({
      stage: 'generating-assets',
      text: '资产入库',
      attachments: [],
    })
    expect(r.kind).toBe('commit-assets')
  })

  it('generating-assets —— 任意闲聊 → noop（友好提示）', () => {
    const r = routeForgeIntent({
      stage: 'generating-assets',
      text: '现在跑得怎么样了',
      attachments: [],
    })
    expect(r.kind).toBe('noop')
  })

  it('confirmed —— 输入新想法 → 重新进入 start-forge', () => {
    const r = routeForgeIntent({
      stage: 'confirmed',
      text: '换一个剧本，新的想法',
      attachments: [],
    })
    expect(r.kind).toBe('start-forge')
  })

  it('confirmed —— 空输入 → noop（不重启）', () => {
    const r = routeForgeIntent({ stage: 'confirmed', text: '', attachments: [] })
    expect(r.kind).toBe('noop')
  })

  it('await-style —— 输入风格说明 → start-forge.idea（首轮把风格当想法 payload）', () => {
    const r = routeForgeIntent({
      stage: 'await-style',
      text: '导演 王家卫，编剧 阿城',
      attachments: [],
    })
    expect(r.kind).toBe('start-forge')
  })
})
