/**
 * prunePlaybackScenario —— 把一份完整 scenario "瘦身" 成 Player 真正要播的那份。
 *
 * 用途：.reelpkg 的 "playback" 模式导出，配合 collectScenarioRefs 只扫 playback
 * 相关字段，最终只有"真正上屏的视频/图/音"会被打进包。
 *
 * 精简规则（与 Player.tsx 的实际行为严格对齐）：
 *
 *   场景级：
 *     · 只保留从 rootSceneId 顺着 branches[].targetSceneId 可达的 scene
 *     · 删除 scene.shots / sceneImages / sceneVideos / keyShotId
 *       （shots 是编辑态分镜中间产物；sceneImages/sceneVideos 是素材池候选，
 *         Player 只播 scene.media）
 *     · 删除 scene.prompts / background（纯文本 prompt，对读包端无信息量，
 *       避免把内部生成提示词带出去）
 *     · includeSubtitles=false 时清 dialogue[]，并把 DialogueLine 里可能引用
 *       的音频一并剔除（MVP 里 DialogueLine 没有独立音频 ref，但将来可能加）
 *     · audio[] / minigames[] / branches[] / media / qte / durationMs / characterIds /
 *       locationId 全保留（这些都进 Player 的实际播放流）
 *
 *   剧本级：
 *     · 删除 characters / locations / props （生图参考资料，Player 不直接引用）
 *     · 删除 uiStyle（Player 里目前不读，未来加 LOGO/封面再放回）
 *     · 删除 originIdea / directorCustomPersona / directorStyle / visualStyle
 *       （这些都是生成阶段的 persona/prompt，和"播放"无关）
 *     · 保留 id / title / synopsis / rootSceneId / scenes / defaultCharMs / schemaVersion
 *     · 保留 videoConfig —— 便于读包端若走"线上代跑"仍能按同一 provider 重播
 *       （sanitize 阶段已把 secret 擦掉）
 *
 * 设计原则：**这一步只动结构，不碰任何资产**。资产的收集/抓取/去重仍由
 * collectScenarioRefs + exportScenarioPackage 负责。把 "精简" 和 "打包"
 * 彻底解耦，任何一端改规则都不会牵扯另一端。
 */

import type { Scenario, Scene } from '../types'

export interface PrunePlaybackOptions {
  /**
   * 是否保留 dialogue[] 里的台词文本。
   *
   * false（Player 里关闭了字幕显示）→ scene.dialogue 统一清空；
   * true → 原样保留（文本不占包体积，读包端自己决定要不要显示）。
   */
  includeSubtitles: boolean
}

export interface PruneResult {
  scenario: Scenario
  /** 实际保留的 sceneId 列表（调用方写 manifest.includedScenes 用） */
  includedScenes: string[]
  /** 被丢弃的 sceneId 列表（调试 / 告警用） */
  droppedScenes: string[]
}

/**
 * 入口。不修改原 scenario；返回克隆版。
 *
 * 实现分两步：
 *   1) reachableFromRoot：BFS 出所有"Player 顺着分支可以走到"的 scene
 *   2) scrub：对每个 scene 删掉编辑态字段；对 scenario 本体删掉参考库
 */
export function prunePlaybackScenario(
  scenario: Scenario,
  opts: PrunePlaybackOptions,
): PruneResult {
  const reachable = reachableFromRoot(scenario)

  const allIds = Object.keys(scenario.scenes)
  const droppedScenes = allIds.filter((id) => !reachable.has(id))
  const includedScenes = allIds.filter((id) => reachable.has(id))

  const scenes: Record<string, Scene> = {}
  for (const id of includedScenes) {
    const s = scenario.scenes[id]
    if (!s) continue
    scenes[id] = scrubScene(s, opts)
  }

  const next: Scenario = {
    id: scenario.id,
    title: scenario.title,
    ...(scenario.synopsis ? { synopsis: scenario.synopsis } : {}),
    rootSceneId: scenario.rootSceneId,
    scenes,
    defaultCharMs: scenario.defaultCharMs,
    schemaVersion: scenario.schemaVersion,
    ...(scenario.videoConfig ? { videoConfig: scenario.videoConfig } : {}),
    // 数值系统：变量定义是运行时分支条件求值所必需的，必须随播放包保留
    ...(scenario.variables ? { variables: scenario.variables } : {}),
    // 背包系统：物品注册表（含图标 mediaId）+ 模块开关都是运行时所必需的
    ...(scenario.items ? { items: scenario.items } : {}),
    ...(scenario.modules ? { modules: scenario.modules } : {}),
  }

  return { scenario: next, includedScenes, droppedScenes }
}

/**
 * BFS：以 scenario.rootSceneId 为起点，按 branches[].targetSceneId
 * 广度扩张，直到无可扩展节点。
 *
 * 边界：
 *   · rootSceneId 不存在 → 返回空集合（读包端会看到空场）
 *   · branch.targetSceneId 指向不存在的 scene → 跳过（不抛错，也不打包该 scene）
 *   · 自环（branch 指向自身）→ visited 去重即可，不会死循环
 *   · branch.kind 不做过滤：choice / auto / qte_pass / qte_fail 都视为"Player 可能走到"
 */
function reachableFromRoot(scenario: Scenario): Set<string> {
  const visited = new Set<string>()
  const root = scenario.rootSceneId
  if (!root || !scenario.scenes[root]) return visited

  const queue: string[] = [root]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    const scene = scenario.scenes[id]
    if (!scene) continue
    visited.add(id)
    for (const b of scene.branches ?? []) {
      const tgt = b.targetSceneId
      if (tgt && !visited.has(tgt) && scenario.scenes[tgt]) {
        queue.push(tgt)
      }
    }
  }
  return visited
}

/**
 * 单个 scene 的字段精简。
 *
 * 保留清单（Player 直接消费）：
 *   id / title / media / durationMs / branches / qte / pos / characterIds /
 *   locationId / audio / minigames / isEnding
 *
 * 不保留：
 *   shots / sceneImages / sceneVideos / keyShotId / prompts / background
 *   （纯编辑态 / 生图中间产物 / 候选素材池，Player 不会读）
 *
 * 按 includeSubtitles 决定 dialogue[] 是否清空。
 */
function scrubScene(scene: Scene, opts: PrunePlaybackOptions): Scene {
  const next: Scene = {
    id: scene.id,
    title: scene.title,
    media: { ...scene.media },
    durationMs: scene.durationMs,
    dialogue: opts.includeSubtitles ? (scene.dialogue ?? []).slice() : [],
    branches: (scene.branches ?? []).slice(),
  }
  if (scene.qte) next.qte = scene.qte
  if (scene.pos) next.pos = scene.pos
  if (scene.characterIds) next.characterIds = scene.characterIds.slice()
  if (scene.locationId) next.locationId = scene.locationId
  if (scene.audio) next.audio = scene.audio.slice()
  if (scene.minigames) next.minigames = scene.minigames.slice()
  if (scene.isEnding) next.isEnding = scene.isEnding
  // 数值系统：进入节点的数值副作用是运行时播放流的一部分
  if (scene.onEnterEffects) next.onEnterEffects = scene.onEnterEffects.slice()
  // 数值系统：进入门槛（改道/阻断）是运行时导航的一部分
  if (scene.entryGate) next.entryGate = scene.entryGate
  // 背包系统：进入节点的物品副作用 + 现场搜索热点都参与运行时
  if (scene.onEnterItemEffects) next.onEnterItemEffects = scene.onEnterItemEffects.slice()
  if (scene.searchLoot) next.searchLoot = scene.searchLoot.slice()
  // 文字叠加（剪映式贴字）+ 搜索段（定格循环找物）都参与运行时叠层/玩法
  if (scene.textOverlays) next.textOverlays = scene.textOverlays.slice()
  if (scene.searchSegments) next.searchSegments = scene.searchSegments.slice()
  // 剪映式后期效果（滤镜/调节/特效/贴纸/转场/首尾动画）—— 全是运行时实时渲染所需
  if (scene.filterClips) next.filterClips = scene.filterClips.slice()
  if (scene.adjustClips) next.adjustClips = scene.adjustClips.slice()
  if (scene.effectClips) next.effectClips = scene.effectClips.slice()
  if (scene.stickerClips) next.stickerClips = scene.stickerClips.slice()
  if (scene.transition) next.transition = scene.transition
  if (scene.clipAnim) next.clipAnim = scene.clipAnim
  return next
}
