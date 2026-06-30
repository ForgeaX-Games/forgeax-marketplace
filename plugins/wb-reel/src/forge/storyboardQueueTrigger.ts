/**
 * storyboardQueueTrigger —— module-level「为节点拆分镜」pipeline trigger.
 *
 * 当 Reia / 分镜导演子智能体调用 reel:generate-storyboard，server 把
 * 「{scope, sceneId?}」投递到 `/__reel__/storyboard-queue`，scenarioPersistBoot 的
 * 轮询（pollStoryboardQueue）捡起后调用本文件 triggerStoryboardFromQueue。
 *
 * 做什么：复用已落地、已测试的批量分镜引擎 runActBatchUpgradeOnScenario
 * （内部走 forgePromptTrioForAct + batch-prompt-trio.skill），把目标场景拆成
 * 多个镜头（含 framing / durationSec / continuityGroupId），写回 scene.shots[]，
 * 并用 assignShotTimecodes 按节奏铺定每镜的 startMs/endMs —— 于是时间轴立刻出现
 * N 个分镜站位（关键帧未生成时显示 hatched 占位条），作者可先预览分镜文字与节奏，
 * 下一步再逐镜生成关键帧 / 视频。
 *
 *   - scope='scene'（默认，带 sceneId）：只拆这一节点（聚焦、省钱）。
 *   - scope='all'：整本走一遍 batch（享受跨场角色/光影一致性回流），逐节点铺满。
 *
 * 归属规则：job.scenarioId 与当前 active 剧本不一致 → 跳过并在对话里提示。
 * 不改剧情结构（scenes/branches/characters 全保留），只升级 prompts/shots。
 */

import { createTextProvider } from '../llm'
import { runActBatchUpgradeOnScenario } from '../llm/runActBatchUpgrade'
import { assignShotTimecodes } from '../llm/assignShotTimecodes'
import { realignSceneDialogue } from '../scenario/realignDialogue'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useForgeChatStore } from './forgeChatStore'
import type { Scenario } from '../scenario/types'

export interface StoryboardQueueItem {
  /** 'scene'（默认，需 sceneId）只拆单节点；'all' 整本铺底。 */
  scope?: 'scene' | 'all'
  /** scope='scene' 时必填：要拆分镜的节点（scenario.scenes 的 key）。 */
  sceneId?: string
  /** 可选：目标剧本 id；缺省/匹配当前 active 时直接处理。 */
  scenarioId?: string
  /**
   * 重拆并清理旧分镜（用户说「重新生成/重做/重拆」时为 true）。已有分镜的节点会先弹
   * 确认再用新分镜替换时间轴上的旧镜头；旧视频/关键帧不删除（归档进素材库，可拿回）。
   */
  force?: boolean
  createdAt: number
}

/**
 * force 重拆前的确认 —— 与 produceNode.confirmForceRegen 同语义：替换时间轴旧分镜
 * （旧视频/关键帧不删，归档进素材库可拿回）。无 window（测试/SSR）默认放行。
 * 返回 false=用户取消。
 */
function confirmStoryboardRegen(sceneId: string, shotN: number): boolean {
  if (shotN === 0) return true
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true
  return window.confirm(
    `重新拆分镜节点「${sceneId}」前确认：\n\n` +
      `将用新分镜替换当前时间轴上的旧 ${shotN} 镜。\n` +
      `旧的视频 / 关键帧不会删除 —— 会归档进素材库（按镜头归到历史版本），随时可拿回采用。\n\n` +
      `确认开始重新拆分镜？`,
  )
}

let _aborted = false

export function abortStoryboardQueue(): void {
  _aborted = true
}

export async function triggerStoryboardFromQueue(item: StoryboardQueueItem): Promise<void> {
  _aborted = false
  const llm = createTextProvider()
  const fullScenario = useScenarioStore.getState().scenario
  const scenarioId = fullScenario.id
  const chat = useForgeChatStore.getState()

  if (item.scenarioId && item.scenarioId !== scenarioId) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[分镜] 跳过：目标剧本 ${item.scenarioId} 非当前「${fullScenario.title}」，请先切到该本再生成分镜。`,
    })
    return
  }

  const scope = item.scope ?? 'scene'

  // 单节点：把 scenario 裁到只含该节点（root 指向它），复用同一条批量管线，
  // 避免重复实现 ActSceneInput 装配；产出再 merge 回真实 store。
  let targetScenario: Scenario = fullScenario
  if (scope !== 'all') {
    const sceneId = item.sceneId
    if (!sceneId) {
      chat.appendMessage(scenarioId, {
        role: 'system',
        text: '[分镜] 跳过：scope=scene 但未提供 sceneId。',
      })
      return
    }
    const scene = fullScenario.scenes?.[sceneId]
    if (!scene) {
      chat.appendMessage(scenarioId, {
        role: 'system',
        text: `[分镜] 跳过：当前剧本里没有节点 ${sceneId}。`,
      })
      return
    }
    // force 重拆：已有分镜时先确认（清理前先问）；用户取消则整条跳过。
    if (item.force) {
      const ok = confirmStoryboardRegen(sceneId, scene.shots?.length ?? 0)
      if (!ok) {
        chat.appendMessage(scenarioId, {
          role: 'assistant',
          text: `[分镜] 已取消重拆节点 ${sceneId} —— 旧分镜原样保留。`,
        })
        return
      }
    }
    targetScenario = {
      ...fullScenario,
      scenes: { [sceneId]: scene },
      rootSceneId: sceneId,
    }
  }

  const sceneCount = Object.keys(targetScenario.scenes).length
  chat.appendMessage(scenarioId, {
    role: 'user',
    text:
      scope === 'all'
        ? `[智能体提交 · 生成分镜] 整本 ${sceneCount} 个节点`
        : `[智能体提交 · 生成分镜] 节点 ${item.sceneId}`,
  })

  chat.setPending(scenarioId, {
    reason: 'forging',
    startedAt: Date.now(),
    stages: [{ label: '拆分镜', detail: `${sceneCount} 个节点排队中`, at: Date.now() }],
    streamTail: '',
    streamBytes: 0,
    abortable: false,
  })

  try {
    const result = await runActBatchUpgradeOnScenario(llm, targetScenario, {
      onBatchStart: (batch) => {
        useForgeChatStore.getState().appendPendingStage(scenarioId, {
          label: '拆分镜',
          detail: `批次 ${batch.sceneIds.length} 节点`,
        })
      },
      onBatchDone: (batch) => {
        useForgeChatStore.getState().appendPendingStage(scenarioId, {
          label: '分镜完成',
          detail: `${batch.sceneIds.length} 节点`,
        })
      },
    })

    if (_aborted) return

    // 把升级后的 scene 写回真实 store（只动 shots/prompts/media，剧情结构不变），
    // 并用 durationSec 占比铺定时间轴站位。
    const store = useScenarioStore.getState()
    let totalShots = 0
    for (const sceneId of result.upgradedSceneIds) {
      const upgraded = result.scenario.scenes[sceneId]
      if (!upgraded) continue
      const shots = assignShotTimecodes(upgraded.shots ?? [], upgraded.durationMs)
      totalShots += shots.length
      // 台词时间随分镜重排：把 scene.dialogue 的 startMs/endMs 对齐到各镜窗口
      // （按 shot.dialogueText 回匹配 + 字数占比铺时间，未认领句线性插值补位、不丢句）。
      // 解决「台词全挤在场景开头、与画面/视频/播放头错位、预览字幕乱」的根因。
      const dialogue = realignSceneDialogue({ ...upgraded, shots })
      store.updateScene(sceneId, {
        shots,
        dialogue,
        prompts: upgraded.prompts,
        media: upgraded.media,
      })
    }

    const okCount = result.upgradedSceneIds.length
    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text:
        `分镜生成完成 · ${okCount}/${sceneCount} 个节点已拆镜（共 ${totalShots} 镜，已在时间轴铺成站位，可预览）。` +
        `\n下一步可对节点逐镜生成关键帧（reel:generate-keyframes）。` +
        (result.failedSceneIds.length > 0
          ? `\n失败 ${result.failedSceneIds.length}：${result.failedSceneIds.join('、')}`
          : '') +
        (result.warnings.length > 0 ? `\n⚠ ${result.warnings.slice(0, 5).join('；')}` : ''),
    })
  } catch (e) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[分镜生成失败] ${(e as Error).message}`,
    })
  } finally {
    useForgeChatStore.getState().clearPending(scenarioId)
  }
}
