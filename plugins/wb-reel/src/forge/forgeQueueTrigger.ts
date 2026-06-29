/**
 * forgeQueueTrigger —— module-level forge pipeline trigger for the queue.
 *
 * When the agent submits a script/idea via reel:forge-script, the queue poll
 * (scenarioPersistBoot) picks it up and calls triggerForgeFromQueue here.
 *
 * Flow: runs the modular stage pipeline (style → logline → synopsis → outline)
 * auto-advancing between stages, then does the final expansion pass
 * (full Scenario JSON) and adoptForgedScenario. Each step is observable in the
 * store. The user can abort at any point via abortForgeQueue().
 */

import { createTextProvider } from '../llm'
import {
  forgeScenarioFromIdea,
  type ForgeProgress,
} from '../llm/promptForge'
import { forgeScenarioFromScriptSegmented } from '../llm/forgeScriptSegmented'
import { characterRefPass } from '../llm/forgePasses'
import { createImageProvider } from '../llm'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { useForgeChatStore } from './forgeChatStore'
import {
  runStageStyle,
  runStageLogline,
  runStageSynopsis,
  runStageOutline,
} from './runStages'
import {
  distillOutline,
  distillRelations,
  distillCharacters,
  distillLocations,
  distillProps,
} from './forgeDistillSkills'
import { broadcastScenarioAdopt } from '../shell/crossPaneSync'

export interface ForgeQueueItem {
  mode: 'idea' | 'script'
  text: string
  title?: string
  createdAt: number
}

let _aborted = false

export function abortForgeQueue(): void {
  _aborted = true
}

export async function triggerForgeFromQueue(item: ForgeQueueItem): Promise<void> {
  _aborted = false
  const llm = createTextProvider()
  const scenarioId = useScenarioStore.getState().scenario.id
  const chat = useForgeChatStore.getState()

  // Record the agent submission as a user message in forge chat
  chat.appendMessage(scenarioId, {
    role: 'user',
    text: `[智能体提交 · ${item.mode === 'idea' ? '想法' : '剧本'}]\n${item.text.slice(0, 500)}${item.text.length > 500 ? '…' : ''}`,
  })

  const idea = item.mode === 'idea' ? item.text : item.text.slice(0, 1200)

  const stageOk = (stage: string): boolean => {
    const recs = useForgeChatStore.getState().getSession(scenarioId).stages.records
    const rec = (recs as Record<string, { status?: string } | undefined>)[stage]
    return rec?.status === 'await-confirm'
  }

  // ── 创作型前置 stage（仅 idea 模式）──────────────────────────────────────
  //
  // style → logline → synopsis → outline 是"从一句话想法发散创作"的阶段。
  // 对**上传的完整剧本**(mode='script')它们既无意义(作者要的是"严格按原文
  // 抽取"而非二创)又脆弱(4 次额外 LLM 调用, 任一没走到 await-confirm 就静默
  // return → 永远到不了下面的 adopt, 表现为"智能体说提交了, 但 workbench 没动静")。
  // 所以 script 模式**直接跳到结构化 + adopt**, 与「导入完整剧本」面板同款路径。
  if (item.mode === 'idea') {
    // ── Stage 1: Style ──────────────────────────────────────────────────
    chat.setStage(scenarioId, 'await-style')
    await runStageStyle({ scenarioId, llm, idea })
    if (_aborted || !stageOk('await-style')) return
    chat.confirmStage(scenarioId, 'await-style', { advance: true })

    // ── Stage 2: Logline ────────────────────────────────────────────────
    await runStageLogline({ scenarioId, llm, idea })
    if (_aborted || !stageOk('logline')) return
    chat.confirmStage(scenarioId, 'logline', { advance: true })

    // ── Stage 3: Synopsis ───────────────────────────────────────────────
    await runStageSynopsis({ scenarioId, llm })
    if (_aborted || !stageOk('synopsis')) return
    chat.confirmStage(scenarioId, 'synopsis', { advance: true })

    // ── Stage 4: Outline ────────────────────────────────────────────────
    await runStageOutline({ scenarioId, llm })
    if (_aborted || !stageOk('outline')) return
    chat.confirmStage(scenarioId, 'outline', { advance: true })
  }

  // ── Stage 5: Full expansion (Scenario JSON) ─────────────────────────────
  chat.setPending(scenarioId, {
    reason: 'forging',
    startedAt: Date.now(),
    stages: [{ label: '全量扩写', detail: '生成完整 Scenario JSON', at: Date.now() }],
    streamTail: '',
    streamBytes: 0,
    abortable: false,
  })

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
    const res =
      item.mode === 'idea'
        ? await forgeScenarioFromIdea(llm, { idea: item.text }, { onProgress })
        : await forgeScenarioFromScriptSegmented(llm, { script: item.text }, { onProgress })

    if (_aborted) return

    useScenarioStore.getState().adoptForgedScenario(res.scenario, {
      mode: 'create-new',
    })
    // 处理本队列项的可能是不可见的 sidebar(pane=left) iframe —— 广播让用户所在的
    // center pane 也切到这本新剧本(否则会停在旧剧本, 以为没生成)。
    broadcastScenarioAdopt(useScenarioStore.getState().scenario)

    const sceneCount = Object.keys(res.scenario.scenes).length
    const charCount = Object.keys(res.scenario.characters ?? {}).length

    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text: `已锻造「${res.scenario.title}」 · ${sceneCount} 场景 · ${charCount} 角色${
        res.warnings.length > 0 ? `\n\n⚠ ${res.warnings.join('\n')}` : ''
      }`,
    })

    // ── Stage 5.5a: 锚点回填（角色 / 场所 / 道具）—— 仅在缺失时跑 ───────────
    // 根因修复：全量扩写（forgeScenarioFromIdea / forgeScriptSegmented）有时只产
    // 场景+对白，characters/locations/props 稀疏甚至为空 —— 表现为"智能体不会自己
    // 拆角色、场景、道具也没有"。这里复用 generate-visuals 的同款蒸馏器，从对白
    // 发言人 + 画面线索反向提取主要角色/场所/关键道具并入库，让后续关系蒸馏与参考图
    // 都有锚点可用。镜像 visualQueueTrigger 的守卫：只在该类目为空时补，不覆盖已有。
    if (_aborted) return
    {
      const cur = useScenarioStore.getState().scenario
      const hasChar = Object.keys(cur.characters ?? {}).length > 0
      const hasLoc = Object.keys(cur.locations ?? {}).length > 0
      const hasProp = Object.keys(cur.props ?? {}).length > 0
      if (!hasChar || !hasLoc || !hasProp) {
        useForgeChatStore.getState().appendPendingStage(cur.id, {
          label: '回填锚点',
          detail: '从剧本蒸馏角色 / 场景 / 关键道具',
        })
        const [chars, locs, props] = await Promise.all([
          hasChar ? Promise.resolve([]) : distillCharacters(llm, cur),
          hasLoc ? Promise.resolve([]) : distillLocations(llm, cur),
          hasProp ? Promise.resolve([]) : distillProps(llm, cur),
        ])
        if (_aborted) return
        const ss = useScenarioStore.getState()
        for (const c of chars) ss.upsertCharacter(c)
        for (const l of locs) ss.upsertLocation(l)
        for (const p of props) ss.upsertProp(p)
        if (chars.length > 0 || locs.length > 0 || props.length > 0) {
          chat.appendMessage(scenarioId, {
            role: 'assistant',
            text: `锚点回填完成 · 新增 ${chars.length} 角色 · ${locs.length} 场景 · ${props.length} 关键道具`,
          })
        }
      }
    }

    // ── Stage 5.5b: Distill outline + relations from the forged scenario ────
    // 关系蒸馏需 ≥2 角色，故必须在锚点回填之后跑（否则纯场景剧本永远抽不出关系）。
    if (_aborted) return
    const adoptedScenario = useScenarioStore.getState().scenario
    useForgeChatStore.getState().appendPendingStage(
      adoptedScenario.id,
      { label: '提取大纲与人物关系', detail: '从剧本中蒸馏结构信息' },
    )
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

    // ── Stage 6: Character/location reference images (if available) ───────
    // 计数与出图都读**回填后**的 store 剧本，而非原始 res.scenario —— 否则
    // 回填出来的角色/场景/道具拿不到定妆照。
    if (_aborted) return
    const imgClient = createImageProvider()
    const isMock = imgClient.getProviderName() === 'Mock'
    const refScenario = useScenarioStore.getState().scenario
    const refCharCount = Object.keys(refScenario.characters ?? {}).length
    const locCount = Object.keys(refScenario.locations ?? {}).length
    const propCount = Object.keys(refScenario.props ?? {}).length

    if (!isMock && (refCharCount > 0 || locCount > 0 || propCount > 0)) {
      useForgeChatStore.getState().setPending(scenarioId, {
        reason: 'forging',
        startedAt: Date.now(),
        stages: [{ label: '生成参考图', detail: `${refCharCount} 角色 · ${locCount} 场所 · ${propCount} 道具`, at: Date.now() }],
        streamTail: '',
        streamBytes: 0,
        abortable: false,
      })

      const mediaStore = useMediaStore.getState()
      const scenarioStore = useScenarioStore.getState()
      await characterRefPass({
        scenario: refScenario,
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

      chat.appendMessage(scenarioId, {
        role: 'assistant',
        text: `参考图生成完成 · ${refCharCount} 角色 · ${locCount} 场所 · ${propCount} 道具`,
      })
    }

    chat.setStage(scenarioId, 'confirmed')
  } catch (e) {
    const msg = (e as Error).message ?? String(e)
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[锻造失败] ${msg}`,
    })
  } finally {
    useForgeChatStore.getState().clearPending(scenarioId)
  }
}
