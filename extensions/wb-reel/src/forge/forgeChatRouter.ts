import type { Attachment, ForgeStage } from './forgeChatStore'

/**
 * 把对话输入（text + 附件）翻译成 promptForge 的入参。
 *
 * 三种产物：
 *   - { mode: 'idea', idea }        → 走 forgeScenarioFromIdea
 *   - { mode: 'script', script }    → 走 forgeScenarioFromScript
 *   - { mode: 'invalid' }           → 输入不足，UI 自己提示别提交
 *
 * 图片附件：v1 暂不送给 LLM（Claude 多模态 content 数组等后续升级；
 * 图片现在只作为会话历史里的"参考图"保留）。出现图片时 droppedImageNote
 * 会被填，让 UI 渲染一条提示，避免作者以为"图传了但没生效"。
 *
 * 纯函数，在测试里完全不依赖 React/DOM。
 */

export interface BuildForgeRequestInput {
  text: string
  attachments: Attachment[]
}

export type BuildForgeRequestResult =
  | { mode: 'idea'; idea: string; droppedImageNote?: string }
  | { mode: 'script'; script: string; droppedImageNote?: string }
  | { mode: 'invalid'; droppedImageNote?: string }

export function buildForgeRequest(
  input: BuildForgeRequestInput,
): BuildForgeRequestResult {
  const trimmed = input.text.trim()
  const textAtts = input.attachments.filter(
    (a): a is Extract<Attachment, { kind: 'text' }> => a.kind === 'text',
  )
  const imgAtts = input.attachments.filter((a) => a.kind === 'image')

  const droppedImageNote =
    imgAtts.length > 0
      ? `已保留 ${imgAtts.length} 张图片附件到本次会话（仅参考，不参与本轮剧本锻造）`
      : undefined

  if (textAtts.length > 0) {
    // script 模式：作者说明 + 所有文本附件拼成一整段剧本
    const header = trimmed ? `【作者说明】\n${trimmed}\n\n` : ''
    const body = textAtts
      .map((a) => `【附件 · ${a.filename}】\n${a.content}`)
      .join('\n\n')
    return { mode: 'script', script: `${header}${body}`, droppedImageNote }
  }

  if (trimmed.length === 0) {
    return { mode: 'invalid', droppedImageNote }
  }

  return { mode: 'idea', idea: trimmed, droppedImageNote }
}

// ─────────────────────────────────────────────────────────────────────────────
// v3.10 · 模块化锻造意图路由
//
// 用户期望（原话浓缩）：
//   "我们做的是模块化剧本锻造。用户输入大纲后能让模型按格式输出，他可以说：
//    '替换某个角色'、'第三章节奏太慢'，我们要良好理解这些意图并针对性修改。
//    确认后才进下一步。"
//
// 意图维度：
//   - start-forge   首次开跑（idle / await-style 阶段，输入是想法或剧本）
//   - advance       当前 stage 已 await-confirm，作者说 "确认/继续/下一步"
//   - patch         当前 stage 有 draft，作者说 "把 X 改成 Y/第三章太慢/换个名字"
//   - regenerate    作者说 "重写/换一版/再来一次"，触发 beginStageAttempt
//   - revert-to     作者说 "回到 outline 改"，把 current 跳回上游
//   - commit-forge  expansion 跑完后说"OK 进资产生成"，进入 await-assets
//   - commit-assets generating-assets 跑完说"全部确认入库"，跳到 confirmed
//   - noop          路由不出来 / 输入空 / 当前 stage 不接受任何意图
//
// 这层路由是 v1 关键词版（高精度低召回），不能识别的复杂自然语言由 PR5 的
// LLM skill `forge-chat-aligner` 兜底（在 ChatPanel 那侧调）。这里只挑常见
// 触发短语，确保 80% 案例不必走 LLM。
//
// stage 分流原则：
//   - idle / await-style：默认认为是 start-forge
//   - logline / synopsis / outline / expansion 中段：默认 patch（除非显式重写/确认）
//   - await-assets：除 commit-forge / commit-assets 外都视作 noop
//   - confirmed：所有输入视作"新一轮想法" → start-forge（认为作者要重启锻造）
// ─────────────────────────────────────────────────────────────────────────────

export type ForgeIntent =
  | { kind: 'start-forge'; payload: BuildForgeRequestResult }
  | { kind: 'advance'; targetStage: ForgeStage }
  | {
      kind: 'patch'
      stage: ForgeStage
      /** 作者的修改诉求原文，未来给 LLM patch skill 当 instruction */
      instruction: string
    }
  | { kind: 'regenerate'; stage: ForgeStage }
  | { kind: 'revert-to'; stage: ForgeStage }
  | { kind: 'commit-forge' }
  | { kind: 'commit-assets' }
  /**
   * 续写下一集 —— 已有剧本基础上，为新剧集生成剧情树。
   * hint: 作者描述新集的核心情节（可选；空字符串 = 让 LLM 自由发挥）
   */
  | { kind: 'append-episode'; hint: string; episodeTitle?: string }
  /**
   * 新增角色 —— 从自然语言提取角色描述，写入 scenario.characters。
   * hint: 作者的角色描述原文
   */
  | { kind: 'upsert-character'; hint: string }
  /**
   * 反向提炼 / 单段重拉 —— v5 小说家工作板专用 (slash command 触发).
   *   - target='synopsis' : 让 LLM 从已有 scenes 里反向凝练一段梗概, 写回 scenario.synopsis
   *   - target='outline'  : 反向凝练大纲, 写回 scenario.outline
   *   - target='relations': 从 scenes/dialogue/角色名中识别人物关系, 写回 characterRelations
   *   - target='expand'   : 按当前 outline + synopsis 重新展开 scenes (deep-rewrite)
   *
   * extra: 作者补充的上下文（可选；如 `/outline 节奏更紧凑一点`）
   */
  | { kind: 'distill'; target: 'synopsis' | 'outline' | 'relations' | 'expand'; extra: string }
  | {
      kind: 'noop'
      /** 给 UI 显示的简短原因，便于作者了解为何被忽略 */
      reason: string
    }

export interface RouteForgeIntentInput {
  stage: ForgeStage
  text: string
  attachments: Attachment[]
}

/*
 * 关键词词典 —— 故意设得保守，以"确实是这个意图"为准。
 *
 * 命中策略：
 *   - 必须是匹配整段输入主旨而不是顺带提到 ——
 *     "重写 / 重新生成" 命中 regenerate，但 "我重新看了一遍" 不该命中
 *   - 复合短语优先于单字词，先长后短
 */
const KW_REGENERATE = /^\s*(重新生成|重写|重来|换一版|再来一次|再生成|重做)/
const KW_ADVANCE =
  /^\s*(确认|继续|下一步|通过|没问题|可以了|ok|lgtm|好的[,，]?\s*下一?步?)\s*$/i
const KW_COMMIT_FORGE = /^\s*(开始(生成)?(资产|素材|图像|视频)|进入资产|生成资产|开始(出图|画面)|出资产)/
const KW_COMMIT_ASSETS = /^\s*(全部确认|资产入库|确定入库|全部通过|定稿|落库)/
const KW_REVERT = /^\s*(回到|退回|改一下)\s*(idle|想法|风格|style|logline|一句话|梗概|synopsis|纲要|outline|大纲|扩写|expansion)/i
/** 续写下一集：匹配"续写第X集"、"新增第X集"、"下一集"、"帮我做第二集"等 */
const KW_APPEND_EPISODE = /续写|新增(一集|剧集|第.集)|下一集|帮我(做|写|生成)(第.集|一集|下一集|新集)|开始第.集|第[二三四五六七八九十\d]+集/
/** 提取集标题：匹配"第X集：..." 中的标题部分 */
const RE_EPISODE_TITLE = /第[一二三四五六七八九十\d]+集[：:·\s]*(.+)/
/** 新增角色：匹配"新增角色"、"添加一个角色"、"加一个人物"等 */
const KW_UPSERT_CHARACTER = /^\s*(新增|添加|加[入一个]*)(角色|人物|人设|NPC)|^\s*(创建|设计)(一个)?(角色|人物)/

/** 把作者口头提到的"风格/logline/纲要…"映射到 ForgeStage 枚举 */
function parseRevertTarget(text: string): ForgeStage | null {
  const m = text.match(KW_REVERT)
  if (!m) return null
  const target = m[2]?.toLowerCase() ?? ''
  if (target === 'idle' || target === '想法') return 'idle'
  if (target === '风格' || target === 'style') return 'await-style'
  if (target === 'logline' || target === '一句话') return 'logline'
  if (target === '梗概' || target === 'synopsis') return 'synopsis'
  if (target === '纲要' || target === 'outline' || target === '大纲') return 'outline'
  if (target === '扩写' || target === 'expansion') return 'expansion'
  return null
}

export function routeForgeIntent(input: RouteForgeIntentInput): ForgeIntent {
  const text = input.text.trim()
  const stage = input.stage

  // ─── slash 命令（v5 · 小说家工作板）─────────────────────────────
  // 作者反馈："什么一句话，一张图，贴剧本，都是在最右侧对话的东西。"
  // 命令优先级最高 —— 显式表达意图比关键词推断准。
  //
  // 支持：
  //   /idea <一句话想法>        显式触发"一句话锻造"（即使在中段 stage 也强制重启）
  //   /script <剧本正文>        显式触发"贴剧本锻造"
  //   /image                   提示作者用附件按钮上传一张图（图片入口）
  //   /synopsis [+ 提示]        反向提炼梗概 → scenario.synopsis
  //   /outline [+ 提示]         反向提炼剧情大纲 → scenario.outline
  //   /relations [+ 提示]       识别角色关系 → scenario.characterRelations
  //   /expand [+ 提示]          按当前 synopsis + outline 重新展开 scenes（deep-rewrite）
  //   /help                    chat 里贴一份命令清单 (noop, system 消息由 UI 输出)
  if (text.startsWith('/')) {
    const slashMatch = text.match(/^\/(\w+)\s*(.*)$/s)
    if (slashMatch) {
      const cmd = (slashMatch[1] ?? '').toLowerCase()
      const rest = (slashMatch[2] ?? '').trim()

      switch (cmd) {
        case 'idea': {
          const built = buildForgeRequest({
            text: rest,
            attachments: input.attachments,
          })
          if (built.mode === 'invalid') {
            return { kind: 'noop', reason: '/idea 后面跟你的一句话想法' }
          }
          // 强制走 idea 路径（即使 attachment 是 md/txt 也覆盖为 idea）
          if (built.mode !== 'idea') {
            return {
              kind: 'start-forge',
              payload: { mode: 'idea', idea: rest || (built.mode === 'script' ? built.script.slice(0, 1000) : '') },
            }
          }
          return { kind: 'start-forge', payload: built }
        }
        case 'script': {
          // 优先用文本附件; 否则用 rest 当 script
          const built = buildForgeRequest({
            text: rest,
            attachments: input.attachments,
          })
          if (built.mode === 'invalid') {
            return { kind: 'noop', reason: '/script 后跟剧本正文，或先用附件按钮上传 .md / .txt' }
          }
          if (built.mode === 'idea') {
            // 没附件，rest 自己就是脚本：强制升级为 script 模式
            return {
              kind: 'start-forge',
              payload: { mode: 'script', script: rest },
            }
          }
          return { kind: 'start-forge', payload: built }
        }
        case 'image': {
          const hasImage = input.attachments.some((a) => a.kind === 'image')
          if (!hasImage) {
            return {
              kind: 'noop',
              reason: '/image 需要先点 + 按钮上传一张图（PNG/JPG/WebP/GIF），再发送',
            }
          }
          // 有图：v5 暂用 idea 路径打底（后续 PR 再接 forgeImageToStorySeed）
          return {
            kind: 'start-forge',
            payload: { mode: 'idea', idea: rest || '从这张图开始锻造一个故事' },
          }
        }
        case 'synopsis':
          return { kind: 'distill', target: 'synopsis', extra: rest }
        case 'outline':
          return { kind: 'distill', target: 'outline', extra: rest }
        case 'relations':
        case 'relation':
          return { kind: 'distill', target: 'relations', extra: rest }
        case 'expand':
          return { kind: 'distill', target: 'expand', extra: rest }
        case 'help':
          return {
            kind: 'noop',
            reason: '可用命令: /idea /script /image /synopsis /outline /relations /expand',
          }
        default:
          return {
            kind: 'noop',
            reason: `未知命令 /${cmd}（输入 /help 查看可用命令）`,
          }
      }
    }
  }

  // ─── 通用意图：跨 stage 都可触发（且优先级最高）───
  // revert 优先于其他匹配 —— "回到 outline 重写" 不能被 KW_REGENERATE 误捕
  const revertTarget = parseRevertTarget(text)
  if (revertTarget) {
    return { kind: 'revert-to', stage: revertTarget }
  }
  if (KW_COMMIT_ASSETS.test(text)) {
    return { kind: 'commit-assets' }
  }
  if (KW_COMMIT_FORGE.test(text)) {
    return { kind: 'commit-forge' }
  }
  // 续写新集 —— 跨任何 stage 都可触发（作者随时想扩展剧集）
  if (KW_APPEND_EPISODE.test(text)) {
    const titleMatch = text.match(RE_EPISODE_TITLE)
    const episodeTitle = titleMatch?.[1]?.trim()
    return { kind: 'append-episode', hint: text, episodeTitle }
  }
  // 新增角色 —— 跨任何 stage 都可触发
  if (KW_UPSERT_CHARACTER.test(text)) {
    return { kind: 'upsert-character', hint: text }
  }

  // ─── 按 stage 分流 ───
  switch (stage) {
    case 'idle':
    case 'await-style': {
      // 这两段都把作者输入当成"启动锻造"的素材
      const built = buildForgeRequest({
        text: input.text,
        attachments: input.attachments,
      })
      if (built.mode === 'invalid') {
        return { kind: 'noop', reason: '请先输入想法或上传剧本附件' }
      }
      return { kind: 'start-forge', payload: built }
    }

    case 'logline':
    case 'synopsis':
    case 'outline':
    case 'expansion': {
      if (KW_ADVANCE.test(text)) {
        return { kind: 'advance', targetStage: stage }
      }
      if (KW_REGENERATE.test(text)) {
        return { kind: 'regenerate', stage }
      }
      // 其他非空文本一律视作"针对当前 stage 的 patch 指令"
      // —— 由 PR5 的 stage runner 把当前 draft + instruction 喂给 LLM 做 diff
      if (text.length > 0) {
        return { kind: 'patch', stage, instruction: text }
      }
      return { kind: 'noop', reason: '空输入；当前 stage 等待你确认或修改' }
    }

    case 'await-assets':
      // 这一段只接受"开始资产生成"或"再回头改剧本"两类输入；
      // 后者在前面 revert/regenerate 已经命中，到这里只剩 commit-forge 没命中
      // 的情况 —— 友好提示
      if (text.length === 0) return { kind: 'noop', reason: '空输入' }
      return {
        kind: 'noop',
        reason: '当前等待你点击「开始生成资产」；或说「回到 outline 改一下」',
      }

    case 'generating-assets':
      // 资产正在跑；作者只能"全部确认入库"或"中断"（中断走 UI 按钮，不走文本）
      if (text.length === 0) return { kind: 'noop', reason: '空输入' }
      return {
        kind: 'noop',
        reason: '资产生成中；想介入请等当前批次结束再说',
      }

    case 'confirmed':
      // 已经定稿，作者输入新内容视作"想重新开一轮锻造"
      if (text.length === 0) return { kind: 'noop', reason: '空输入' }
      return {
        kind: 'start-forge',
        payload: buildForgeRequest({
          text: input.text,
          attachments: input.attachments,
        }),
      }

    default: {
      // 未来新增 stage 时这里 TS 会报；保留兜底防止生产时 silent fail
      const exhaustive: never = stage
      void exhaustive
      return { kind: 'noop', reason: '未知 stage' }
    }
  }
}
