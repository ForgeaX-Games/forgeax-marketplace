/**
 * auditionQueueTrigger —— 「角色试镜视频 + 音色」生产线的浏览器侧触发器。
 *
 * 当 Reia 调用 reel:generate-auditions，server 把请求投递到 /__reel__/audition-queue，
 * scenarioPersistBoot 的轮询（pollAuditionQueue）捡起后调用本文件 triggerAuditionFromQueue。
 *
 * 为什么必须在浏览器里跑（与 visual/storyboard 等同构）：
 *   - 试镜视频走 Seedance 图生视频（凭据在 settingsStore / 本机），产物入 mediaStore；
 *   - 抽音色用的是浏览器 AudioContext（Node 侧没有）。
 *   所以 server 只负责把"意图"排进队列，真正生成在工作台（必须保持打开）里执行。
 *
 * 流程：
 *   1. 解析目标角色：scope='all'（全部有定妆照的角色）或 characterIds=[...]（指定）。
 *   2. 幂等过滤：默认跳过已有 auditionVideoMediaId 的角色；force=true 时全量重生。
 *   3. 逐角色串行调 generateCharacterAudition（图→台词→3:4/10s 视频→抽 MP3→绑定），
 *      进度写进 forge 对话的 pending stages。
 *   4. 汇总成功 / 降级（音色抽取失败）/ 失败到对话。
 */

import { useScenarioStore } from '../scenario/scenarioStore'
import { useForgeChatStore } from './forgeChatStore'
import { enqueueAuditions } from './enqueueAudition'
import { useMediaStore } from '../media/mediaStore'
import type { Character } from '../scenario/types'

export interface AuditionQueueItem {
  /** 'all'（默认）= 全部有定妆照的角色；'characters' = 仅 characterIds 指定的角色 */
  scope?: 'all' | 'characters'
  /** scope='characters' 时的目标角色 id 列表 */
  characterIds?: string[]
  /** 可选：目标剧本 id；缺省/不匹配时对当前 active 剧本执行 */
  scenarioId?: string
  /** true = 即使已有试镜视频也强制重生（默认 false：跳过已有的，幂等省钱） */
  force?: boolean
  createdAt: number
}

let _aborted = false

export function abortAuditionQueue(): void {
  _aborted = true
}

/** 该角色是否已有可用单人参考图（试镜视频以它为参考，缺则无法生成）。 */
function hasTurnaround(c: Character): boolean {
  const ids = [
    c.headshotMediaId,
    c.fullbodyMediaId,
    c.turnaroundRefImageId,
    c.refImageId,
  ].filter(Boolean) as string[]
  const entries = useMediaStore.getState().entries
  return ids.some((id) => {
    const e = entries[id]
    return !!(e && e.url && e.persistState !== 'failed')
  })
}

export async function triggerAuditionFromQueue(item: AuditionQueueItem): Promise<void> {
  _aborted = false
  const scenario = useScenarioStore.getState().scenario
  const scenarioId = scenario.id
  const chat = useForgeChatStore.getState()

  chat.appendMessage(scenarioId, {
    role: 'user',
    text: `[智能体提交 · 生成试镜视频与音色]${
      item.scenarioId && item.scenarioId !== scenarioId
        ? `\n（请求目标 ${item.scenarioId}，当前对 active 剧本「${scenario.title}」执行）`
        : ''
    }`,
  })

  const all = Object.values(scenario.characters ?? {})
  // 1) 选定目标角色
  let targets: Character[]
  if (item.scope === 'characters' && item.characterIds && item.characterIds.length > 0) {
    const wanted = new Set(item.characterIds)
    targets = all.filter((c) => wanted.has(c.id))
  } else {
    targets = all
  }

  // 2) 必须有定妆照 + 幂等过滤
  const missingTurnaround = targets.filter((c) => !hasTurnaround(c))
  const withTurnaround = targets.filter(hasTurnaround)
  const runList = item.force
    ? withTurnaround
    : withTurnaround.filter((c) => !c.auditionVideoMediaId)

  if (runList.length === 0) {
    const hint =
      withTurnaround.length === 0
        ? '目标角色都还没有定妆照。请先用 reel:generate-visuals 生成角色定妆照，再生成试镜视频。'
        : '目标角色都已有试镜视频。如需重做请带 force=true。'
    chat.appendMessage(scenarioId, { role: 'assistant', text: `[试镜] ${hint}` })
    return
  }

  if (missingTurnaround.length > 0) {
    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text: `[试镜] 跳过 ${missingTurnaround.length} 个无定妆照的角色：${missingTurnaround
        .map((c) => c.name)
        .join('、')}。先生成定妆照后再重试。`,
    })
  }

  if (_aborted) return

  // 统一走 generationQueue：每个角色一个 cardKey=audition:<id> 的 job。
  // 实时进度/失败原因/重试在各角色卡浮层 + 下方「生成队列」可见，不再串行阻塞。
  enqueueAuditions(
    runList.map((c) => ({ id: c.id, name: c.name })),
    { group: `audition-agent-${Date.now().toString(36)}` },
  )

  chat.appendMessage(scenarioId, {
    role: 'assistant',
    text: `[试镜] 已入队 ${runList.length} 个角色的试镜视频生成（3:4 · 10s · 含音色提取）。进度见各角色定妆照卡片与「生成队列」；完成后卡片会自动显示试镜视频与音色试听。`,
  })
}
