import { useEffect, useMemo, useRef, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { inferAdoptMode } from '../scenario/forgeIntent'
import { useMediaStore } from '../media/mediaStore'
import { createTextProvider, createImageProvider } from '../llm'
import type { TextClient } from '../llm/types'
import {
  forgeScenarioFromIdea,
  type ForgeProgress,
} from '../llm/promptForge'
import { forgeScenarioFromScriptSegmented } from '../llm/forgeScriptSegmented'
import { broadcastScenarioAdopt } from '../shell/crossPaneSync'
import { characterRefPass } from '../llm/forgePasses'
import { appendEpisodePass } from '../llm/appendEpisodePass'
import { sniffScenarioJson } from '../llm/scenarioJsonSniff'
import { injectStyleOnce } from '../styles/injectStyle'
import {
  useForgeChatStore,
  type Attachment,
  type ChatMessage,
  type ForgeStage,
  type PendingStage,
} from './forgeChatStore'
import {
  buildForgeRequest,
  routeForgeIntent,
  type BuildForgeRequestResult,
  type ForgeIntent,
} from './forgeChatRouter'
import {
  runStageLogline,
  runStageOutline,
  runStageStyle,
  runStageSynopsis,
} from './runStages'
import {
  distillSynopsis,
  distillOutline,
  distillRelations,
} from './forgeDistillSkills'
import { ForgeStageRoll } from './ForgeStageRoll'
import { chatPanelCss } from './ForgeChatPanel.css'
import type { Scenario } from '../scenario/types'

/**
 * ForgeChatPanel —— Forge 页右侧的对话面板。
 *
 * 功能（来自作者反馈）：
 *   "一句话想法、贴剧本，去除，合并为一个对话窗口，在 forge 的右侧。
 *    1) 我输入想法进行生成
 *    2) 我上传文件，你不用打开文件，你只需要拿着这个文件 + 我们的元提示词
 *       给 llm，等他的返回就行，不用非要多少字
 *    3) 我上传给你的这个文件、以及我们的生成记录，图像、视频等，都有历史"
 *
 * 交互：
 *   - 统一输入框：textarea 支持回车发送（Shift+Enter 换行）
 *   - 拖拽 / 粘贴 / 按钮 → 附件（文本或图片）；附件预览条显示在 textarea 上方
 *   - 消息流按时间自上而下渲染；user 右对齐，assistant 左对齐
 *   - LLM 返回后自动把新 scenario 注入 scenarioStore（触发整个 Forge 右侧网格刷新）
 *
 * 持久化：
 *   - 对话、附件、草稿走 forgeChatStore，每次写入立即落 localStorage
 *   - **锻造中状态也进 store**（session.pending），切 tab / 刷新回来仍显示"锻造中…"
 *   - 锻造逻辑是 module 级函数 runForgeFromChat，独立于组件生命周期 ——
 *     ForgeTab 是 activeTab 条件渲染，切 tab 会卸载 ForgeChatPanel；
 *     如果把 await 写在组件内部，切走时组件虽然不会"取消" Promise，但
 *     `setBusy(false)` 之类的 state 更新会作用于已卸载组件（React warn），
 *     且"锻造中"气泡会消失。搬到 module 级让这件事永远能跑完。
 */

/**
 * 执行一次锻造 —— 与 React 组件解耦，方便被 ForgeChatPanel.handleSend 或
 * 将来的重试按钮等调用。保证：
 *   1. 进来先 setPending；无论成功失败都会 clearPending
 *   2. 不持有任何 React state，切 tab 不影响它跑到尾
 *   3. 用户消息 / 系统提示 / assistant 消息都走 store —— 全程可观察、可持久化
 *
 * 锻造三步：
 *   pass 1: 剧本/想法 → Scenario JSON（LLM）
 *   pass 2: loadScenario（无 LLM）
 *   pass 3: characterRefPass — 角色三视图 + 场所基准图（ImageClient，可选，无 key 时静默跳过）
 *
 * 中断：
 *   - 每次启动时往 abortRegistry 注册一个 AbortController；signal 透传给 promptForge
 *   - 作者点 PendingBubble 的「中断」按钮 → abortForge(scenarioId) → controller.abort()
 *   - 我们在 catch 里识别 AbortError 走"已中断"分支，归档 stages，不走 error 红字
 *   - characterRefPass 当前不接 signal —— 一旦进入参考图阶段中断会等本批跑完才清
 *     pending（小代价；未来给它加 signal 更顺滑）
 */
const abortRegistry = new Map<string, AbortController>()

export function abortForge(scenarioId: string): void {
  const ctrl = abortRegistry.get(scenarioId)
  if (ctrl) {
    ctrl.abort()
    abortRegistry.delete(scenarioId)
  }
}

function isAbortLike(e: unknown): boolean {
  if (!e) return false
  const err = e as { name?: string; message?: string }
  return err.name === 'AbortError' || /aborted/i.test(err.message ?? '')
}

async function runForgeFromChat(params: {
  scenarioId: string
  req: Exclude<BuildForgeRequestResult, { mode: 'invalid' }>
  llm: TextClient
}): Promise<void> {
  const { scenarioId, req, llm } = params
  const chat = useForgeChatStore.getState()
  const ctrl = new AbortController()
  abortRegistry.set(scenarioId, ctrl)
  chat.setPending(scenarioId, {
    reason: 'forging',
    startedAt: Date.now(),
    stages: [
      {
        label: req.mode === 'idea' ? '解析一句话想法' : '解析剧本',
        detail:
          req.mode === 'idea'
            ? `${req.idea.length} 字`
            : `${req.script.length} 字`,
        at: Date.now(),
      },
    ],
    streamTail: '',
    streamBytes: 0,
    abortable: true,
  })
  // progress 回调由 promptForge 触发 —— 我们只管把它们写进 store
  const onProgress = (ev: ForgeProgress): void => {
    if (ev.kind === 'stage') {
      useForgeChatStore
        .getState()
        .appendPendingStage(scenarioId, { label: ev.label, detail: ev.detail })
    } else {
      useForgeChatStore.getState().appendPendingDelta(scenarioId, ev.delta)
    }
  }
  try {
    // ── Pass 1: LLM 生成 Scenario（遇到 Azure 555420 拦截自动重试一次）──
    const forgeOnce = () =>
      req.mode === 'idea'
        ? forgeScenarioFromIdea(llm, { idea: req.idea }, { onProgress, signal: ctrl.signal })
        : forgeScenarioFromScriptSegmented(llm, { script: req.script }, { onProgress, signal: ctrl.signal })

    let res
    try {
      res = await forgeOnce()
    } catch (e) {
      const msg = (e as Error).message
      // Azure 555420: 内容安全拦截，等 4 秒后重试一次
      if (msg.includes('555420') || msg.includes('unusual behavior')) {
        useForgeChatStore.getState().appendPendingStage(scenarioId, {
          label: '被限流，4 秒后重试…',
          detail: 'Azure 555420 内容安全拦截，自动重试',
        })
        await new Promise((r) => setTimeout(r, 4000))
        res = await forgeOnce()
      } else {
        throw e
      }
    }
    useScenarioStore.getState().adoptForgedScenario(res.scenario, {
      // 内置雨夜样板 / 空白新故事 → create-new (新剧本独立 id, 不污染样板);
      // 用户自己工作中的剧本 → replace-current (在它上面优化, 保留 id)
      mode: inferAdoptMode(useScenarioStore.getState().scenario),
    })
    broadcastScenarioAdopt(useScenarioStore.getState().scenario)
    const sceneCount = Object.keys(res.scenario.scenes).length
    const charCount = Object.keys(res.scenario.characters ?? {}).length
    const assistantMsg = chat.appendMessage(scenarioId, {
      role: 'assistant',
      text: `已锻造「${res.scenario.title}」 · ${sceneCount} 场景 · ${charCount} 角色${
        res.warnings.length > 0 ? `\n\n⚠ ${res.warnings.join('\n')}` : ''
      }`,
    })

    // ── Pass 2.5: 自动蒸馏大纲 + 人物关系 ─────────────────────────────
    useForgeChatStore.getState().appendPendingStage(scenarioId, {
      label: '提取大纲与人物关系',
      detail: '从剧本中蒸馏结构信息',
    })
    const adoptedScenario = useScenarioStore.getState().scenario
    const [outline, relations] = await Promise.all([
      distillOutline(llm, adoptedScenario, ''),
      distillRelations(llm, adoptedScenario, ''),
    ])
    if (outline.length > 0) {
      useScenarioStore.getState().setOutline(outline)
    }
    if (relations.length > 0) {
      useScenarioStore.getState().setCharacterRelations(relations)
    }

    // ── Pass 3: 角色三视图 + 场所基准图（有 ImageClient 才跑）─────────
    const imgClient = createImageProvider()
    const isMock = imgClient.getProviderName() === 'Mock'
    if (!isMock && (charCount > 0 || Object.keys(res.scenario.locations ?? {}).length > 0 || Object.keys(res.scenario.props ?? {}).length > 0)) {
      useForgeChatStore.getState().appendPendingStage(scenarioId, {
        label: '生成角色参考图',
        detail: `${charCount} 个角色 · ${Object.keys(res.scenario.locations ?? {}).length} 个场所 · ${Object.keys(res.scenario.props ?? {}).length} 件道具`,
      })
      const mediaStore = useMediaStore.getState()
      const scenarioStore = useScenarioStore.getState()
      await characterRefPass({
        scenario: res.scenario,
        client: imgClient,
        onCharacterRef: (characterId, result) => {
          const mediaId = mediaStore.ingestDataUrl(result.dataUrl, {
            name: `turnaround-${characterId}.png`,
            promptKind: 'character-ref',
            tags: ['turnaround'],
            humanReadableName: `角色定妆照 · ${characterId}`,
          })
          scenarioStore.setCharacterTurnaroundRef(characterId, mediaId)
        },
        onLocationRef: (locationId, result) => {
          const mediaId = mediaStore.ingestDataUrl(result.dataUrl, {
            name: `loc-ref-${locationId}.png`,
            promptKind: 'location-ref',
            humanReadableName: `场景基准 · ${locationId}`,
          })
          scenarioStore.setLocationRefImage(locationId, mediaId)
        },
        onLocationAngleRef: (locationId, angle, result) => {
          const mediaId = mediaStore.ingestDataUrl(result.dataUrl, {
            name: `loc-${locationId}-${angle.id}.png`,
            promptKind: 'location-ref',
            humanReadableName: `场景角度 · ${locationId} · ${angle.label}`,
          })
          scenarioStore.addLocationAngleRef(locationId, {
            id: angle.id,
            label: angle.label,
            anglePrompt: angle.anglePrompt,
            mediaId,
          })
        },
        onPropRef: (propId, result) => {
          const mediaId = mediaStore.ingestDataUrl(result.dataUrl, {
            name: `prop-ref-${propId}.png`,
            promptKind: 'prop-ref',
            humanReadableName: `道具参考 · ${propId}`,
          })
          scenarioStore.setPropRefImage(propId, mediaId)
        },
        onProgress: (ev) => {
          const kindLabel =
            ev.kind === 'character' ? '角色' : ev.kind === 'location' ? '场所' : '道具'
          useForgeChatStore.getState().appendPendingStage(scenarioId, {
            label: `参考图 ${ev.done}/${ev.total}`,
            detail: `${kindLabel} · ${ev.name}`,
          })
        },
      })
    }
    // 归档本次工作流到产出消息上 —— 刷新后仍能看到「调用模型 → 解析 JSON → 角色参考图」
    useForgeChatStore.getState().archiveStagesToMessage(scenarioId, assistantMsg.id)
  } catch (e) {
    if (isAbortLike(e)) {
      // 作者主动中断：把当前 stages 归档为一条独立的 system 消息，让历史里看得见这次"半截工作"
      const abortedMsg = chat.appendMessage(scenarioId, {
        role: 'system',
        text: '锻造已中断（作者操作）',
      })
      useForgeChatStore
        .getState()
        .archiveStagesToMessage(scenarioId, abortedMsg.id, { aborted: true })
    } else {
      const errMsg = chat.appendMessage(scenarioId, {
        role: 'assistant',
        text: '锻造失败',
        error: (e as Error).message,
      })
      useForgeChatStore.getState().archiveStagesToMessage(scenarioId, errMsg.id)
    }
  } finally {
    abortRegistry.delete(scenarioId)
    useForgeChatStore.getState().clearPending(scenarioId)
  }
}

const MAX_ATT_BYTES = 2 * 1024 * 1024 // 单附件 2MB —— 图片 base64 inline 到 localStorage
const TEXT_EXTS = ['.md', '.txt', '.json', '.markdown']
const IMG_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * v5 · slash 命令快捷栏配置.
 *
 * 三个"输入入口"(idea / script / image) + 四个"反向提炼"(synopsis / outline /
 * relations / expand). 顺序按使用频率粗排, 颜色靠 CSS 区分.
 */
const SLASH_HINTS: Array<{
  cmd: string
  label: string
  desc: string
  group: 'input' | 'distill'
}> = [
  { cmd: 'idea', label: '一句话', desc: '一句话想法 → 锻造完整剧本', group: 'input' },
  { cmd: 'script', label: '贴剧本', desc: '贴入剧本正文 / 上传 md / txt', group: 'input' },
  { cmd: 'image', label: '一张图', desc: '上传图片 → 反向凝练故事', group: 'input' },
  { cmd: 'synopsis', label: '提梗概', desc: '从已有 scenes 反向凝练梗概', group: 'distill' },
  { cmd: 'outline', label: '提大纲', desc: '从已有 scenes 反向凝练剧情大纲', group: 'distill' },
  { cmd: 'relations', label: '提关系', desc: '识别人物关系并写入工作板', group: 'distill' },
  { cmd: 'expand', label: '扩写场景', desc: '按当前梗概+大纲重新展开 scenes', group: 'distill' },
]

export function ForgeChatPanel() {
  const scenarioId = useScenarioStore((s) => s.scenario.id)

  const session = useForgeChatStore((s) => s.getSession(scenarioId))
  const chat = useForgeChatStore.getState()
  const busy = session.pending !== null

  const llm = useMemo(() => createTextProvider(), [])

  const [uploadError, setUploadError] = useState<string | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 消息增量时自动滚到底；pending 变化也要滚（新出现/消失"锻造中"气泡）
  // 流式 token 也要触发下滑，用 streamBytes 作为监听量
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.messages.length, busy, session.pending?.streamBytes, session.pending?.stages.length])

  const stagedAtts = session.draftAttachmentIds
    .map((id) => session.attachments[id])
    .filter((a): a is Attachment => Boolean(a))

  async function handleFiles(files: FileList | File[]): Promise<void> {
    setUploadError(null)
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATT_BYTES) {
        setUploadError(`文件 ${file.name} 超过 ${MAX_ATT_BYTES / 1024 / 1024}MB 上限`)
        continue
      }
      const name = file.name.toLowerCase()
      const isText = TEXT_EXTS.some((ext) => name.endsWith(ext))
      const isImage = IMG_MIMES.includes(file.type)

      try {
        if (isText) {
          const content = await file.text()
          const att = chat.addAttachment(scenarioId, {
            kind: 'text',
            filename: file.name,
            bytes: file.size,
            content,
          })
          chat.stageAttachment(scenarioId, att.id)
        } else if (isImage) {
          const dataUrl = await readAsDataUrl(file)
          const att = chat.addAttachment(scenarioId, {
            kind: 'image',
            filename: file.name,
            bytes: file.size,
            dataUrl,
            mimeType: file.type,
          })
          chat.stageAttachment(scenarioId, att.id)
        } else {
          setUploadError(
            `不支持的文件类型：${file.name}（支持：${TEXT_EXTS.join(' / ')}、PNG/JPG/WebP/GIF）`,
          )
        }
      } catch (e) {
        setUploadError(`读取 ${file.name} 失败：${(e as Error).message}`)
      }
    }
  }

  async function handleSend(): Promise<void> {
    if (busy) return
    const text = session.draft
    const atts = stagedAtts

    // 先把 user 消息入库（含 attachmentIds），同时清空草稿 + staged.
    // 即便最终 router 判定 noop, 作者输入也已经在历史里看得到, 不会"打了字结果石沉大海".
    const attachmentIds = atts.map((a) => a.id)
    if (text.trim() || attachmentIds.length > 0) {
      chat.appendMessage(scenarioId, {
        role: 'user',
        text: text || '(仅附件)',
        attachmentIds,
      })
    }
    chat.setDraft(scenarioId, '')
    chat.clearStaged(scenarioId)
    setUploadError(null)

    // 路由器拿当前 stage + 文本 + 附件 → ForgeIntent
    const stage = session.stages.current
    const intent: ForgeIntent = routeForgeIntent({ stage, text, attachments: atts })

    await dispatchIntent(intent, { atts })
  }

  /**
   * 根据 ForgeIntent 派发到具体动作.
   *   - start-forge      : 走老路径 runForgeFromChat (一句话 → Scenario JSON)
   *                        当 stage 处于 idle 时直接 fallback 到这条; 后续 PR 会改为
   *                        强制先走 await-style → logline → ... 的细粒度管道.
   *   - regenerate / patch / advance: 调对应 stage 的 runStage / store action.
   *   - revert-to        : store.setStage; resetStagesFrom 是否触发由我们自己决定.
   *   - commit-forge / commit-assets: 占位 system 消息, 真正的实现走专用按钮 (双 CTA).
   *   - noop             : system 消息 + 不发送.
   */
  async function dispatchIntent(
    intent: ForgeIntent,
    ctx: { atts: Attachment[] },
  ): Promise<void> {
    switch (intent.kind) {
      case 'start-forge': {
        const req = intent.payload
        if (req.mode === 'invalid') {
          setUploadError('先输入想法或上传剧本文件再发送')
          return
        }
        if (req.droppedImageNote) {
          chat.appendMessage(scenarioId, {
            role: 'system',
            text: req.droppedImageNote,
          })
        }
        // 当 stage 处于 idle 时, 优先走新管道的第 0 步 (style); 老路径
        // 会在作者点底部 "直接锻造完整 Scenario" CTA 时触发.
        if (session.stages.current === 'idle') {
          const idea =
            req.mode === 'idea'
              ? req.idea
              : req.script.slice(0, 1200)
          chat.setStage(scenarioId, 'await-style')
          void runStageStyle({ scenarioId, llm, idea })
        } else {
          // 已经在管道里的 start-forge (例如 confirmed 之后又输入新想法) 直接走老路径.
          void runForgeFromChat({ scenarioId, req, llm })
        }
        return
      }
      case 'regenerate':
        void runStageOf(intent.stage, { scenarioId, llm })
        return
      case 'patch':
        void runStageOf(intent.stage, { scenarioId, llm, instruction: intent.instruction })
        return
      case 'advance': {
        chat.confirmStage(scenarioId, intent.targetStage, { advance: true })
        chat.appendMessage(scenarioId, {
          role: 'system',
          text: `已确认「${stageLabel(intent.targetStage)}」, 进入下一阶段`,
        })
        return
      }
      case 'revert-to': {
        chat.setStage(scenarioId, intent.stage)
        chat.appendMessage(scenarioId, {
          role: 'system',
          text: `回到「${stageLabel(intent.stage)}」阶段; 上方卡片可继续修改/重生`,
        })
        return
      }
      case 'commit-forge':
        chat.appendMessage(scenarioId, {
          role: 'system',
          text: '⌁ 进入资产生成阶段 (请点击下方「开始生成资产」按钮)',
        })
        chat.setStage(scenarioId, 'await-assets')
        return
      case 'commit-assets':
        chat.appendMessage(scenarioId, {
          role: 'system',
          text: '⌁ 资产入库 / 定稿 (请点击下方「定稿」按钮)',
        })
        return
      case 'append-episode': {
        chat.appendMessage(scenarioId, {
          role: 'system',
          text: `⏳ 正在续写新集：${intent.hint.slice(0, 60)}…`,
        })
        void (async () => {
          try {
            const scenario = useScenarioStore.getState().scenario
            const result = await appendEpisodePass(llm, {
              scenario,
              hint: intent.hint,
              episodeTitle: intent.episodeTitle,
            })
            useScenarioStore.getState().adoptForgedEpisode(result)
            chat.appendMessage(scenarioId, {
              role: 'assistant',
              text: `✅ 已新增「${result.episode.title}」（${Object.keys(result.scenes).length} 个场景${
                Object.keys(result.newCharacters ?? {}).length > 0
                  ? `，新增角色：${Object.values(result.newCharacters ?? {}).map((c) => c.name).join('、')}`
                  : ''
              }）`,
            })
          } catch (e) {
            chat.appendMessage(scenarioId, {
              role: 'system',
              text: `❌ 续写失败：${e instanceof Error ? e.message : String(e)}`,
            })
          }
        })()
        return
      }
      case 'upsert-character': {
        chat.appendMessage(scenarioId, {
          role: 'system',
          text: `⏳ 正在从描述中提取角色信息…`,
        })
        void (async () => {
          try {
            // 用轻量 LLM call 提取角色结构
            const raw = await llm.generate({
              systemPrompt: `从以下描述中提取一个角色，以 JSON 格式返回，包含 id(小写英文数字-), name(中文名), prompt(英文外观描述，用于生图), aliases(可选中文别名数组)。只返回 JSON。`,
              userPrompt: intent.hint,
              maxTokens: 400,
            })
            const match = raw.match(/\{[\s\S]+\}/)
            if (!match) throw new Error('解析角色 JSON 失败')
            const c = JSON.parse(match[0])
            const charId = c.id || `ch-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
            const newChar = { id: charId, name: c.name || '未命名角色', prompt: c.prompt || '', aliases: c.aliases }
            useScenarioStore.getState().upsertCharacter(newChar)
            chat.appendMessage(scenarioId, {
              role: 'assistant',
              text: `✅ 已新增角色「${newChar.name}」（id: ${charId}）。可前往"视觉"面板为其生成参考图。`,
            })
          } catch (e) {
            chat.appendMessage(scenarioId, {
              role: 'system',
              text: `❌ 新增角色失败：${e instanceof Error ? e.message : String(e)}`,
            })
          }
        })()
        return
      }
      case 'noop':
        chat.appendMessage(scenarioId, {
          role: 'system',
          text: `(已忽略：${intent.reason})`,
        })
        return
      case 'distill': {
        const { target, extra } = intent
        const labelMap = {
          synopsis: '梗概',
          outline: '剧情大纲',
          relations: '人物关系',
          expand: '按大纲扩写场景',
        } as const
        chat.appendMessage(scenarioId, {
          role: 'system',
          text: `⏳ 正在反向提炼「${labelMap[target]}」…${extra ? ` (补充：${extra})` : ''}`,
        })
        void (async () => {
          try {
            const scenario = useScenarioStore.getState().scenario
            if (target === 'synopsis') {
              const out = await distillSynopsis(llm, scenario, extra)
              if (!out) throw new Error('LLM 返回空')
              useScenarioStore.getState().setSynopsis(out)
              chat.appendMessage(scenarioId, {
                role: 'assistant',
                text: `✅ 已写入新的梗概（${out.length} 字）：\n\n${out}`,
              })
            } else if (target === 'outline') {
              const nodes = await distillOutline(llm, scenario, extra)
              if (nodes.length === 0) throw new Error('未能提取大纲（LLM 返回不可解析）')
              useScenarioStore.getState().setOutline(nodes)
              const acts = nodes.filter((n) => !n.parentId).length
              const beats = nodes.filter((n) => n.parentId).length
              chat.appendMessage(scenarioId, {
                role: 'assistant',
                text: `✅ 已写入剧情大纲：${acts} 幕 · ${beats} Beat。可在「剧本 → 剧情大纲」tab 查看 / 编辑。`,
              })
            } else if (target === 'relations') {
              const rels = await distillRelations(llm, scenario, extra)
              if (rels.length === 0) {
                throw new Error('未识别到关系（角色 < 2 或 LLM 返回空）')
              }
              useScenarioStore.getState().setCharacterRelations(rels)
              chat.appendMessage(scenarioId, {
                role: 'assistant',
                text: `✅ 已写入 ${rels.length} 条人物关系。可在「剧本 → 人物关系」tab 查看 / 编辑。`,
              })
            } else if (target === 'expand') {
              // 按当前 synopsis + outline 重新展开 scenes：复用现有 idea 路径
              // 把 synopsis + outline 拼成一个加强版 idea 喂给老锻造管线。
              const sIdea = composeIdeaFromOutline(scenario, extra)
              if (!sIdea) {
                throw new Error('当前 synopsis / outline 都为空，无法扩写')
              }
              chat.appendMessage(scenarioId, {
                role: 'system',
                text: `⏳ 按当前梗概 + 大纲扩写场景…（这一步会替换/扩展 scenes）`,
              })
              await runForgeFromChat({
                scenarioId,
                req: { mode: 'idea', idea: sIdea },
                llm,
              })
            }
          } catch (e) {
            chat.appendMessage(scenarioId, {
              role: 'system',
              text: `❌ ${labelMap[target]} 失败：${e instanceof Error ? e.message : String(e)}`,
            })
          }
        })()
        return
      }
    }
    // ts: 不可达
    void ctx
  }

  /** 由 ForgeStageRoll 卡片"修改"按钮触发：聚焦输入框并预填提示文本 */
  function onRequestPatch(stage: ForgeStage, hint?: string): void {
    chat.setDraft(scenarioId, (hint ?? '') + (session.draft ?? ''))
    inputRef.current?.focus()
    void stage
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files)
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(e.clipboardData.files)
    if (files.length > 0) {
      e.preventDefault()
      void handleFiles(files)
    }
  }

  return (
    <aside
      className="ks-forge-chat"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="ks-forge-chat-head">
        <div className="ks-forge-chat-kicker ks-mono">FORGE · CHAT</div>
        <div className="ks-forge-chat-sub ks-cn">
          {llm.getProviderName()} · {llm.getModel()}
        </div>
      </header>

      <div className="ks-forge-chat-stream" ref={scrollRef}>
        {session.messages.length === 0 && (
          <div className="ks-forge-chat-empty ks-cn">
            在下方输入想法（或拖入剧本 md/txt、参考图），按 ⏎ 发送。
            <br />
            对话和附件都会保留，切 tab / 刷新都还在。
          </div>
        )}
        {session.messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            attachments={session.attachments}
          />
        ))}
        {busy && session.pending && (
          <PendingBubble scenarioId={scenarioId} />
        )}
      </div>

      {/* 模块化锻造管道的 stage 卡片柱; idle 且无 record 时不渲染 */}
      <ForgeStageRoll
        scenarioId={scenarioId}
        llm={llm}
        onRequestPatch={onRequestPatch}
      />

      <ForgeDualCta
        scenarioId={scenarioId}
        llm={llm}
        disabled={busy}
      />

      {stagedAtts.length > 0 && (
        <div className="ks-forge-chat-staged">
          {stagedAtts.map((a) => (
            <StagedChip
              key={a.id}
              att={a}
              onRemove={() => chat.unstageAttachment(scenarioId, a.id)}
            />
          ))}
        </div>
      )}

      {uploadError && (
        <div className="ks-forge-chat-error ks-cn">× {uploadError}</div>
      )}

      {/*
       * v5 · slash 命令快捷栏 (小说家工作板)
       *   作者反馈："什么一句话，一张图，贴剧本，都是在最右侧对话的东西。"
       * 输入框留空时显示一行可点击 chip, 点哪个就把对应 slash 注入草稿;
       * draft 不为空时收起以免遮挡视线.
       */}
      {!session.draft.trim() && (
        <div className="ks-forge-chat-slash-hints" role="toolbar" aria-label="快捷命令">
          {SLASH_HINTS.map((h) => (
            <button
              key={h.cmd}
              type="button"
              className="ks-forge-chat-slash-chip"
              data-group={h.group}
              onClick={() => {
                chat.setDraft(scenarioId, `/${h.cmd} `)
                inputRef.current?.focus()
              }}
              title={h.desc}
            >
              <span className="ks-forge-chat-slash-cmd ks-mono">/{h.cmd}</span>
              <span className="ks-forge-chat-slash-label">{h.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="ks-forge-chat-inputbar">
        <FileButton onPick={handleFiles} />
        <textarea
          ref={inputRef}
          className="ks-forge-chat-input ks-cn"
          placeholder="说点什么，或拖入剧本/参考图…  斜杠输入命令: /idea /script /image /synopsis /outline /relations /expand"
          rows={2}
          value={session.draft}
          onChange={(e) => chat.setDraft(scenarioId, e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={busy}
        />
        <button
          type="button"
          className="ks-forge-chat-send"
          onClick={() => void handleSend()}
          disabled={busy || (!session.draft.trim() && stagedAtts.length === 0)}
        >
          {busy ? '…' : '发送 ⏎'}
        </button>
      </div>
    </aside>
  )
}

function PendingBubble({ scenarioId }: { scenarioId: string }) {
  // 订阅 store —— pending 的 stages / streamTail 每次增量都会触发重渲染
  const pending = useForgeChatStore((s) => s.getSession(scenarioId).pending)
  // 每秒 tick 一次让"已 Ns"走秒（store 本身不会为了秒数变化重渲染）
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  if (!pending) return null
  const elapsed = Math.max(0, Math.floor((Date.now() - pending.startedAt) / 1000))

  // 从当前 streamTail 抽"正在写什么"的语义信号
  const sniff = sniffScenarioJson(pending.streamTail)
  const hasSniff =
    sniff.title ||
    sniff.synopsis ||
    sniff.styleNote ||
    sniff.characterNames.length > 0 ||
    sniff.currentSceneTitle ||
    sniff.sceneCount > 0

  return (
    <div className="ks-forge-chat-msg is-assistant">
      <div className="ks-forge-chat-pending">
        <div className="ks-forge-chat-pending-head ks-mono">
          <span className="ks-forge-chat-pending-spinner" />
          锻造中
          <span className="ks-forge-chat-pending-timer">
            {elapsed}s{pending.streamBytes > 0 ? ` · ${pending.streamBytes} chars` : ''}
          </span>
          {pending.abortable && (
            <button
              type="button"
              className="ks-forge-chat-pending-abort"
              onClick={() => abortForge(scenarioId)}
              title="中断当前锻造（已生成的工作流仍会保留在历史里）"
            >
              中断
            </button>
          )}
        </div>

        {pending.stages.length > 0 && (
          <ul className="ks-forge-chat-stages ks-cn">
            {pending.stages.map((st, i) => {
              const isLast = i === pending.stages.length - 1
              return (
                <li
                  key={i}
                  className={`ks-forge-chat-stage ${isLast ? 'is-last' : ''}`}
                >
                  <span className="ks-forge-chat-stage-tick ks-mono">
                    {isLast ? '◆' : '✓'}
                  </span>
                  <span>
                    <span className="ks-forge-chat-stage-label">{st.label}</span>
                    {st.detail && (
                      <span className="ks-forge-chat-stage-detail">
                        · {st.detail}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {hasSniff && (
          <div className="ks-forge-chat-sniff ks-cn">
            {sniff.title && (
              <div className="ks-forge-chat-sniff-title">「{sniff.title}」</div>
            )}
            {sniff.synopsis && (
              <div className="ks-forge-chat-sniff-row">
                <span className="ks-forge-chat-sniff-key ks-mono">梗概</span>
                <span className="ks-forge-chat-sniff-val is-multi">
                  {sniff.synopsis}
                </span>
              </div>
            )}
            {sniff.styleNote && (
              <div className="ks-forge-chat-sniff-row">
                <span className="ks-forge-chat-sniff-key ks-mono">风格</span>
                <span className="ks-forge-chat-sniff-val">{sniff.styleNote}</span>
              </div>
            )}
            {sniff.characterNames.length > 0 && (
              <div className="ks-forge-chat-sniff-row">
                <span className="ks-forge-chat-sniff-key ks-mono">角色</span>
                <span className="ks-forge-chat-sniff-val is-multi">
                  {sniff.characterNames.map((n) => (
                    <span key={n} className="ks-forge-chat-sniff-chip">
                      {n}
                    </span>
                  ))}
                  {sniff.characterCount > sniff.characterNames.length && (
                    <span className="ks-forge-chat-sniff-chip">
                      … +{sniff.characterCount - sniff.characterNames.length}
                    </span>
                  )}
                </span>
              </div>
            )}
            {(sniff.sceneCount > 0 || sniff.currentSceneTitle) && (
              <div className="ks-forge-chat-sniff-row">
                <span className="ks-forge-chat-sniff-key ks-mono">场景</span>
                <span className="ks-forge-chat-sniff-val is-multi">
                  已写 {sniff.sceneCount} 场
                  {sniff.currentSceneTitle &&
                    ` · 正在写「${sniff.currentSceneTitle}」`}
                </span>
              </div>
            )}
          </div>
        )}

        {pending.streamTail.length > 0 && (
          <div className="ks-forge-chat-tail">
            <div className="ks-forge-chat-tail-head">LIVE ·  原始流</div>
            {pending.streamTail.slice(-320)}
            <span className="ks-forge-chat-tail-caret" />
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBubble({
  msg,
  attachments,
}: {
  msg: ChatMessage
  attachments: Record<string, Attachment>
}) {
  if (msg.role === 'system') {
    return (
      <div className="ks-forge-chat-msg is-system">
        <div className="ks-forge-chat-sysnote ks-mono">⌁ {msg.text}</div>
        {msg.stagesArchive && msg.stagesArchive.length > 0 && (
          <ArchivedStages
            stages={msg.stagesArchive}
            elapsedMs={msg.forgeElapsedMs}
            aborted={msg.aborted}
          />
        )}
      </div>
    )
  }
  const isUser = msg.role === 'user'
  const atts = (msg.attachmentIds ?? [])
    .map((id) => attachments[id])
    .filter((a): a is Attachment => Boolean(a))

  return (
    <div className={`ks-forge-chat-msg ${isUser ? 'is-user' : 'is-assistant'}`}>
      <div
        className={`ks-forge-chat-bubble ${isUser ? 'is-user' : 'is-assistant'} ${
          msg.error ? 'is-error' : ''
        }`}
      >
        {atts.length > 0 && (
          <div className="ks-forge-chat-atts">
            {atts.map((a) => (
              <AttPreview key={a.id} att={a} />
            ))}
          </div>
        )}
        <div className="ks-forge-chat-text ks-cn">{msg.text}</div>
        {msg.error && (
          <div className="ks-forge-chat-errbody ks-mono">{msg.error}</div>
        )}
        {msg.productAssets && msg.productAssets.length > 0 && (
          <div className="ks-forge-chat-products">
            {msg.productAssets.map((p, i) => (
              <div key={i} className="ks-forge-chat-product">
                {p.kind === 'image' ? (
                  <img src={p.url} alt={p.label ?? 'product'} />
                ) : (
                  <video src={p.url} controls muted />
                )}
                {p.label && (
                  <span className="ks-forge-chat-prodlabel ks-mono">
                    {p.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {msg.stagesArchive && msg.stagesArchive.length > 0 && (
          <ArchivedStages
            stages={msg.stagesArchive}
            elapsedMs={msg.forgeElapsedMs}
            aborted={msg.aborted}
          />
        )}
      </div>
    </div>
  )
}

/**
 * ArchivedStages —— 历史消息上的"工作流摘要"。
 * 默认折叠成一行 "⏷ 6 步 · 12.4s"，展开后是和 PendingBubble 一致的 stages 清单。
 *
 * 设计取舍：
 *   - 折叠态省屏：刷新后历史里有 N 条产出，每条都全展开会糊
 *   - 展开态点击展开 —— 鼠标 hover 不行，作者经常用键盘操作
 *   - 中断态默认展开：让作者一眼看到"卡在哪"，方便决定下一步
 */
function ArchivedStages({
  stages,
  elapsedMs,
  aborted,
}: {
  stages: PendingStage[]
  elapsedMs?: number
  aborted?: boolean
}) {
  const [open, setOpen] = useState<boolean>(Boolean(aborted))
  const elapsed = elapsedMs ? `${(elapsedMs / 1000).toFixed(1)}s` : ''
  return (
    <div className={`ks-forge-chat-archive ${aborted ? 'is-aborted' : ''}`}>
      <button
        type="button"
        className="ks-forge-chat-archive-head ks-mono"
        onClick={() => setOpen((v) => !v)}
        title={open ? '收起工作流' : '展开本次锻造的工作流'}
      >
        <span className="ks-forge-chat-archive-toggle">{open ? '⏷' : '⏵'}</span>
        {aborted ? '已中断 · ' : ''}
        {stages.length} 步{elapsed ? ` · ${elapsed}` : ''}
      </button>
      {open && (
        <ul className="ks-forge-chat-stages ks-cn">
          {stages.map((st, i) => (
            <li key={i} className="ks-forge-chat-stage">
              <span className="ks-forge-chat-stage-tick ks-mono">✓</span>
              <span>
                <span className="ks-forge-chat-stage-label">{st.label}</span>
                {st.detail && (
                  <span className="ks-forge-chat-stage-detail">
                    · {st.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AttPreview({ att }: { att: Attachment }) {
  if (att.kind === 'image') {
    return (
      <div className="ks-forge-chat-att is-image" title={att.filename}>
        <img src={att.dataUrl} alt={att.filename} />
      </div>
    )
  }
  return (
    <div className="ks-forge-chat-att is-text ks-mono" title={att.filename}>
      <span className="ks-forge-chat-att-icon">📄</span>
      <span className="ks-forge-chat-att-name">{att.filename}</span>
      <span className="ks-forge-chat-att-size">{formatBytes(att.bytes)}</span>
    </div>
  )
}

function StagedChip({
  att,
  onRemove,
}: {
  att: Attachment
  onRemove: () => void
}) {
  return (
    <div className={`ks-forge-chat-chip is-${att.kind}`} title={att.filename}>
      {att.kind === 'image' ? (
        <img src={att.dataUrl} alt={att.filename} />
      ) : (
        <span className="ks-forge-chat-chip-icon">📄</span>
      )}
      <span className="ks-forge-chat-chip-name ks-mono">{att.filename}</span>
      <button
        type="button"
        className="ks-forge-chat-chip-rm"
        onClick={onRemove}
        title="移除"
      >
        ✕
      </button>
    </div>
  )
}

function FileButton({ onPick }: { onPick: (files: FileList) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const accept = [...TEXT_EXTS, ...IMG_MIMES].join(',')
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) onPick(e.target.files)
          if (ref.current) ref.current.value = ''
        }}
      />
      <button
        type="button"
        className="ks-forge-chat-attbtn"
        onClick={() => ref.current?.click()}
        title="上传文本 / 图片"
      >
        ⊕
      </button>
    </>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(file)
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ─────────────────────────────────────────────────────────────────────────────
// runStage 路由 + stage 中文标签 —— 给 dispatchIntent 用
// ─────────────────────────────────────────────────────────────────────────────

function runStageOf(
  stage: ForgeStage,
  args: { scenarioId: string; llm: TextClient; instruction?: string },
): Promise<void> {
  switch (stage) {
    case 'await-style':
      return runStageStyle(args)
    case 'logline':
      return runStageLogline(args)
    case 'synopsis':
      return runStageSynopsis(args)
    case 'outline':
      return runStageOutline(args)
    case 'idle':
    case 'expansion':
    case 'await-assets':
    case 'generating-assets':
    case 'confirmed':
      // expansion / 资产阶段后续 PR 接入; 这里静默忽略避免误调.
      return Promise.resolve()
  }
}

function stageLabel(stage: ForgeStage): string {
  switch (stage) {
    case 'idle':
      return '尚未开始'
    case 'await-style':
      return '风格策展'
    case 'logline':
      return '一句话核心冲突'
    case 'synopsis':
      return '梗概与节拍'
    case 'outline':
      return '故事大纲'
    case 'expansion':
      return '分幕扩写'
    case 'await-assets':
      return '等待资产生成'
    case 'generating-assets':
      return '资产生成中'
    case 'confirmed':
      return '定稿'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 双 CTA —— 仅在合适的 stage 出现:
//   - outline 已 confirm + expansion 还没跑 / 已跑完 → 「锻造完整剧本」 (commit-forge)
//   - expansion 已确认                                  → 「开始生成资产」 (start asset gen)
//   - await-assets / generating-assets                   → 「定稿入库」 (commit-assets)
//
// 触发的真实动作走 ForgeChatPanel 的老路径 runForgeFromChat (start-asset-gen
// 仍是 forgeScenarioFromIdea+characterRefPass 那一坨). PR6 才会拆掉这层.
// ─────────────────────────────────────────────────────────────────────────────

function ForgeDualCta({
  scenarioId,
  llm,
  disabled,
}: {
  scenarioId: string
  llm: TextClient
  disabled: boolean
}) {
  const stage = useForgeChatStore((s) => s.getSession(scenarioId).stages.current)
  const records = useForgeChatStore((s) => s.getSession(scenarioId).stages.records)

  const outlineConfirmed = records.outline?.status === 'confirmed'
  const expansionDone = records.expansion?.status === 'confirmed'

  const showCommitForge =
    stage === 'outline' && outlineConfirmed
  const showStartAssets =
    stage === 'expansion' && expansionDone
  const showCommitAssets =
    stage === 'await-assets' || stage === 'generating-assets'

  if (!showCommitForge && !showStartAssets && !showCommitAssets) return null

  const chat = useForgeChatStore.getState()

  return (
    <div className="ks-forge-chat-dualcta">
      {showCommitForge && (
        <button
          type="button"
          className="ks-forge-chat-cta is-primary"
          disabled={disabled}
          onClick={() => {
            // 直接走老路径完整锻造一份 Scenario, 不再 stage-by-stage. 后续 PR 改.
            chat.appendMessage(scenarioId, {
              role: 'system',
              text: '⌁ 进入剧本锻造 —— 由当前 outline 直接产出完整 Scenario',
            })
            const idea = stageDraftAsIdea(scenarioId)
            void runForgeFromChat({
              scenarioId,
              llm,
              req: { mode: 'idea', idea },
            })
            chat.setStage(scenarioId, 'expansion')
          }}
        >
          ⚒ 锻造完整剧本
        </button>
      )}
      {showStartAssets && (
        <button
          type="button"
          className="ks-forge-chat-cta is-primary"
          disabled={disabled}
          onClick={() => {
            chat.setStage(scenarioId, 'await-assets')
            chat.appendMessage(scenarioId, {
              role: 'system',
              text: '⌁ 准备生成参考图资产 (角色 / 场景 / 道具)',
            })
          }}
        >
          ⊕ 开始生成资产
        </button>
      )}
      {showCommitAssets && (
        <button
          type="button"
          className="ks-forge-chat-cta is-primary"
          disabled={disabled}
          onClick={() => {
            chat.confirmStage(scenarioId, stage, { advance: true })
            chat.appendMessage(scenarioId, {
              role: 'system',
              text: '✓ 已定稿入库',
            })
          }}
        >
          ✓ 定稿入库
        </button>
      )}
    </div>
  )
}

/**
 * 把当前 stage state 里的 logline / synopsis / outline 拼成"老路径 idea 字段"
 * 喂给 forgeScenarioFromIdea —— 让模型在已确认的上游基础上直接产出 Scenario JSON.
 */
function stageDraftAsIdea(scenarioId: string): string {
  const sess = useForgeChatStore.getState().getSession(scenarioId)
  const r = sess.stages.records
  const out: string[] = []
  const style = r['await-style']?.draft
  if (style) {
    if ((style as { director?: string }).director) {
      out.push(`【导演风格】${(style as { director?: string }).director}`)
    }
    if ((style as { writer?: string }).writer) {
      out.push(`【编剧风格】${(style as { writer?: string }).writer}`)
    }
    if ((style as { visualPreset?: string }).visualPreset) {
      out.push(`【视觉基调】${(style as { visualPreset?: string }).visualPreset}`)
    }
  }
  const logline = r['logline']?.draft as { text?: string } | undefined
  if (logline?.text) out.push(`【一句话核心冲突】${logline.text}`)
  const synopsis = r['synopsis']?.draft as { text?: string } | undefined
  if (synopsis?.text) out.push(`【梗概】${synopsis.text}`)
  const outline = r['outline']?.draft as
    | { chapters?: { title: string; summary: string }[] }
    | undefined
  if (outline?.chapters?.length) {
    out.push('【大纲】')
    outline.chapters.forEach((c, i) => {
      out.push(`  ${i + 1}. ${c.title}：${c.summary}`)
    })
  }
  return out.join('\n')
}

/**
 * 把当前 scenario 的 synopsis + outline 拼成一个加强版 idea，
 * 喂给 forgeScenarioFromIdea 路径来重新展开 scenes。
 *
 * v5 · `/expand` 命令的快通道实现 —— 不引入新的 LLM skill，
 *      复用现有 idea → scenes 管线，但让"作者打过的大纲"作为上下文一同送进去。
 */
function composeIdeaFromOutline(scenario: Scenario, extra: string): string {
  const parts: string[] = []
  if (scenario.title) parts.push(`故事标题：${scenario.title}`)
  if (scenario.synopsis) parts.push(`梗概：\n${scenario.synopsis}`)
  const outline = scenario.outline ?? []
  if (outline.length > 0) {
    const acts = outline.filter((n) => !n.parentId).sort((a, b) => a.order - b.order)
    parts.push('剧情大纲：')
    for (const act of acts) {
      parts.push(`- ${act.title}${act.summary ? `：${act.summary}` : ''}`)
      const beats = outline
        .filter((n) => n.parentId === act.id)
        .sort((a, b) => a.order - b.order)
      for (const beat of beats) {
        parts.push(`  · ${beat.title}${beat.summary ? `：${beat.summary}` : ''}`)
      }
    }
  }
  if (extra) parts.push(`【作者补充】${extra}`)
  if (parts.length === 0) return ''
  parts.push('请按以上信息扩写出完整的场景树（包含对话、分支、关键氛围速记）。')
  return parts.join('\n\n')
}

injectStyleOnce('forge-chat-panel', chatPanelCss)
