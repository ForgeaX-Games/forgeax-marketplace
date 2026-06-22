/**
 * produceNode —— 逐节点「一键产出」总指挥（P4）。
 *
 * 把单个节点的 分镜 → 关键帧 → 视频 串成一条可见、幂等、可逐段覆盖、可逐节点
 * 推进的自动生产线。它本身**不重复实现**任何生成逻辑，而是按序复用三条已落地、
 * 已测试的触发器：
 *   storyboard → triggerStoryboardFromQueue（拆镜，写 scene.shots[] + 时间码）
 *   keyframes  → triggerKeyframeFromQueue（逐镜出关键帧，写 shot.keyframeMediaRef）
 *   video      → orchestrateVideos（逐镜入生成队列出片，后台并发、不挡剪辑）
 *
 * 幂等 / overrides：
 *   - 默认跳过「作者已手工打磨」的阶段：已有 ≥2 镜则跳过拆镜；已有关键帧的镜跳过；
 *     已有 videoMediaRef 的镜跳过出片。
 *   - `stages` 指定只跑某几个阶段；`force=true` 强制重跑全部阶段。
 *
 * 可见性：每阶段透传各触发器自身的对话进度，收尾再发一条节点级树状进度
 *   「分镜(N镜)✓ → 关键帧(k/N) → 视频(v/N 后台出片中)」，逐节点通知作者。
 *
 * 走工坊队列（pollProduceNodeQueue → triggerProduceNodeFromQueue），与其它
 * reel:* 一致：宿主工具入队、浏览器管线消费，工作台必须打开。
 */

import { triggerStoryboardFromQueue } from './storyboardQueueTrigger'
import { triggerKeyframeFromQueue } from './keyframeQueueTrigger'
import { orchestrateVideos } from './orchestrateVideos'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useForgeChatStore } from './forgeChatStore'
import { orderScenesForUpgrade } from '../llm/runActBatchUpgrade'
import type { Scenario } from '../scenario/types'

export type ProduceStage = 'storyboard' | 'keyframes' | 'video'

/** 多节点选择范围：单节点 / 主线前 N 个 / 全部（按 rootSceneId BFS 排序）。 */
export type ProduceScope = 'node' | 'firstN' | 'all'

const DEFAULT_STAGES: ProduceStage[] = ['storyboard', 'keyframes', 'video']

export interface ProduceNodeQueueItem {
  /** 单节点入口（scenario.scenes 的 key）；与 sceneIds/scope 三选一。 */
  sceneId?: string
  /** 显式多节点入口；非空时优先于 sceneId/scope，按给定顺序逐个产出。 */
  sceneIds?: string[]
  /** 范围入口：'all' = 全部主线；'firstN' = 主线前 count 个；'node' = 单节点。 */
  scope?: ProduceScope
  /** scope='firstN' 时取前几个（默认 1）。 */
  count?: number
  /** 可选：目标剧本 id；缺省/匹配当前 active 时直接处理。 */
  scenarioId?: string
  /** 可选：只跑指定阶段（默认全链 storyboard→keyframes→video）。 */
  stages?: ProduceStage[]
  /** 可选：强制重跑全部阶段（默认幂等跳过已完成的阶段/镜）。 */
  force?: boolean
  createdAt: number
}

/**
 * 把一次入队请求解析成「按顺序产出的节点 id 列表」。
 *   1) sceneIds 显式数组优先（过滤掉当前剧本不存在的 id，保留给定顺序）。
 *   2) scope='all' → 全部主线（rootSceneId BFS，不可达追加尾部）。
 *   3) scope='firstN' → 主线前 count 个。
 *   4) 否则回落单节点 sceneId。
 */
export function resolveProduceTargets(
  scenario: Scenario,
  item: ProduceNodeQueueItem,
): string[] {
  if (item.sceneIds && item.sceneIds.length > 0) {
    return item.sceneIds.filter((id) => !!scenario.scenes?.[id])
  }
  if (item.scope === 'all') {
    return orderScenesForUpgrade(scenario)
  }
  if (item.scope === 'firstN') {
    const n = Math.max(1, item.count ?? 1)
    return orderScenesForUpgrade(scenario).slice(0, n)
  }
  if (item.sceneId && scenario.scenes?.[item.sceneId]) {
    return [item.sceneId]
  }
  return []
}

/**
 * 产出单个节点（分镜→关键帧→视频），返回一行树状进度文案。
 * 不发 header；调用方在批量时统一发头尾，单节点时也复用这行做收尾。
 */
async function produceOneNode(
  scenarioId: string,
  sceneId: string,
  stages: ProduceStage[],
  force: boolean,
): Promise<string> {
  const chat = useForgeChatStore.getState()

  // ── 阶段 1：分镜 ─────────────────────────────────────────────────────────
  if (stages.includes('storyboard')) {
    const cur = useScenarioStore.getState().scenario.scenes?.[sceneId]
    if (force || (cur?.shots?.length ?? 0) < 2) {
      await triggerStoryboardFromQueue({ scope: 'scene', sceneId, createdAt: Date.now() })
    } else {
      chat.appendMessage(scenarioId, {
        role: 'assistant',
        text: `[${sceneId}] 分镜已存在（${cur?.shots?.length} 镜），跳过拆镜。`,
      })
    }
  }

  // ── 阶段 2：关键帧 ───────────────────────────────────────────────────────
  if (stages.includes('keyframes')) {
    await triggerKeyframeFromQueue({ sceneId, force, createdAt: Date.now() })
  }

  // ── 阶段 3：视频（逐镜入生成队列，后台并发出片，不挡剪辑）────────────────
  if (stages.includes('video')) {
    const final = useScenarioStore.getState().scenario.scenes?.[sceneId]
    if ((final?.shots?.length ?? 0) < 1) {
      chat.appendMessage(scenarioId, {
        role: 'assistant',
        text: `[${sceneId}] 没有分镜，跳过出片。`,
      })
    } else {
      const r = orchestrateVideos({
        sceneIds: [sceneId],
        includeTextOnly: true,
        skipExisting: !force,
      })
      chat.appendMessage(scenarioId, {
        role: 'assistant',
        text: `[${sceneId}] 逐镜出片已入队 ${r.enqueued} 镜（后台并发，不挡剪辑）${
          r.skipped > 0 ? `；跳过 ${r.skipped} 镜（已有视频/无关键帧）` : ''
        }。`,
      })
    }
  }

  // ── 节点级树状进度 ───────────────────────────────────────────────────────
  const finalScene = useScenarioStore.getState().scenario.scenes?.[sceneId]
  const shotN = finalScene?.shots?.length ?? 0
  const kfN = finalScene?.shots?.filter((s) => s.keyframeMediaRef).length ?? 0
  const vidN = finalScene?.shots?.filter((s) => s.videoMediaRef).length ?? 0
  const line =
    `节点 ${sceneId}：` +
    `分镜(${shotN}镜)${shotN > 0 ? '✓' : '—'} → ` +
    `关键帧(${kfN}/${shotN})${shotN > 0 && kfN >= shotN ? '✓' : kfN > 0 ? '⏳' : '—'} → ` +
    `视频(${vidN}/${shotN}${vidN < shotN ? '，逐镜后台出片中' : '✓'})`
  chat.appendMessage(scenarioId, { role: 'assistant', text: line })
  return line
}

export async function triggerProduceNodeFromQueue(item: ProduceNodeQueueItem): Promise<void> {
  const scenario = useScenarioStore.getState().scenario
  const scenarioId = scenario.id
  const chat = useForgeChatStore.getState()

  if (item.scenarioId && item.scenarioId !== scenarioId) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[节点生产] 跳过：目标剧本 ${item.scenarioId} 非当前「${scenario.title}」，请先切到该本。`,
    })
    return
  }

  const targets = resolveProduceTargets(scenario, item)
  if (targets.length === 0) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[节点生产] 跳过：没有解析到要产出的节点（检查 sceneId / sceneIds / scope）。`,
    })
    return
  }

  const stages = item.stages && item.stages.length > 0 ? item.stages : DEFAULT_STAGES
  const force = item.force === true

  const scopeLabel =
    targets.length === 1
      ? `节点 ${targets[0]}`
      : `${targets.length} 个节点（${targets.slice(0, 3).join('、')}${targets.length > 3 ? '…' : ''}）`
  chat.appendMessage(scenarioId, {
    role: 'user',
    text: `[智能体提交 · 一键产出] ${scopeLabel} · 阶段 ${stages.join('→')}${force ? ' · 强制重跑' : ''}`,
  })

  // 顺序逐节点跑「分镜→关键帧」（出片在每节点内入后台并发队列，不挡剪辑）。
  // 顺序而非并行：保证跨节点一致性回流（角色/光源/道具承接）按主线推进。
  const summaries: string[] = []
  for (const sceneId of targets) {
    const line = await produceOneNode(scenarioId, sceneId, stages, force)
    summaries.push(line)
  }

  if (targets.length > 1) {
    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text: `本批 ${targets.length} 个节点生产进度汇总：\n${summaries.join('\n')}`,
    })
  }
}
