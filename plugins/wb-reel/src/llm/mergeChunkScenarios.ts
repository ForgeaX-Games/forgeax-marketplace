/**
 * mergeChunkScenarios —— 把"逐段结构化"产出的多个 Scenario 合并成一本完整剧本
 *
 * 背景：长剧本（> chunkPlanner.CHUNK_THRESHOLD_CHARS）若整本塞进单次
 * forgeScenarioFromScript，会撞上下游 LLM 输出 token 截断 / 长连接被重置
 * （ECONNRESET）。分段方案是：planChunks 把原文切成若干语义内聚段，逐段
 * 调 forgeScenarioFromScript（每段都是合法 Scenario），最后用本函数把它们
 * 拼回**一本**剧本。
 *
 * 纯函数，不调 LLM、不碰 store。输入是"已归一化"的 Scenario 数组（顺序 = 叙事
 * 顺序），输出是合并后的单本 Scenario。
 *
 * 合并规则：
 *   1. **id 命名空间隔离**：第 i 段的所有 scene/branch id 前缀 `c{i}_`，
 *      杜绝不同段 LLM 各自吐出 "scene-1" 造成的撞 id。
 *   2. **角色/场所/道具按名字去重**：同一角色（秋月）会在多段里反复出现，
 *      按归一化名字合并成一个 canonical 条目；第一段定义 canonical id，
 *      后续段的同名引用统一映射过去。空字段（prompt/refImageId）用后段补齐。
 *   3. **跨段缝合**：段内分支（LLM 在该段里能看到的目标）保留；指向"段外"的
 *      悬空分支（LLM 凭空造的 next id）重指到**下一段的根场景**；最后一段的
 *      悬空分支丢弃（视作结局）。每段的尾场景若没有任何出边，补一条 auto 边
 *      连到下一段根，保证整条故事线连通、Player 不断链。
 *
 * 已知限制（分段抽取的物理上限，非 bug）：
 *   - 跨段的"选择分支"（第 1 段的选项跳到第 3 段某场景）无法自动重建 ——
 *     逐段抽取时 LLM 看不到别的段，无从得知目标。作者可在剧情树里手动连。
 */

import type { Scenario, Scene, Character, Location, Prop, Branch } from '../scenario/types'

function normName(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 合并多段 Scenario 为一本。partials 须按叙事顺序排列。
 * 空场景的段会被跳过；若全空则抛错（调用方应在更上层兜底）。
 */
export function mergeChunkScenarios(partials: Scenario[]): Scenario {
  const valid = partials.filter(
    (p) => p && p.scenes && Object.keys(p.scenes).length > 0,
  )
  if (valid.length === 0) {
    throw new Error('mergeChunkScenarios: 所有分段都没有有效场景，无法合并')
  }
  if (valid.length === 1) return valid[0]!

  const mergedScenes: Record<string, Scene> = {}
  const mergedChars: Record<string, Character> = {}
  const mergedLocs: Record<string, Location> = {}
  const mergedProps: Record<string, Prop> = {}

  // 归一化名字 → canonical id（去重锚点）
  const charByName = new Map<string, string>()
  const locByName = new Map<string, string>()
  const propByName = new Map<string, string>()

  const partialRoots: string[] = []
  const partialTailKeys: string[] = []
  const partialSceneKeys: string[][] = []

  valid.forEach((p, i) => {
    const prefix = `c${i}_`
    const ns = (id: string): string => `${prefix}${id}`

    // ── 角色去重 ───────────────────────────────────────────────
    const charMap = new Map<string, string>()
    for (const [cid, c] of Object.entries(p.characters ?? {})) {
      const key = normName(c.name || cid)
      let canon = charByName.get(key)
      if (!canon) {
        canon = ns(cid)
        charByName.set(key, canon)
        mergedChars[canon] = { ...c, id: canon }
      } else {
        const ex = mergedChars[canon]!
        if (!ex.prompt && c.prompt) ex.prompt = c.prompt
        if (!ex.refImageId && c.refImageId) ex.refImageId = c.refImageId
        if (!ex.turnaroundRefImageId && c.turnaroundRefImageId) {
          ex.turnaroundRefImageId = c.turnaroundRefImageId
        }
        const aliases = new Set([...(ex.aliases ?? []), ...(c.aliases ?? [])])
        if (aliases.size > 0) ex.aliases = [...aliases]
      }
      charMap.set(cid, canon)
    }

    // ── 场所去重 ───────────────────────────────────────────────
    const locMap = new Map<string, string>()
    for (const [lid, l] of Object.entries(p.locations ?? {})) {
      const key = normName(l.name || lid)
      let canon = locByName.get(key)
      if (!canon) {
        canon = ns(lid)
        locByName.set(key, canon)
        mergedLocs[canon] = { ...l, id: canon }
      }
      locMap.set(lid, canon)
    }

    // ── 道具去重 ───────────────────────────────────────────────
    const propMap = new Map<string, string>()
    for (const [pid, pr] of Object.entries(p.props ?? {})) {
      const key = normName(pr.name || pid)
      let canon = propByName.get(key)
      if (!canon) {
        canon = ns(pid)
        propByName.set(key, canon)
        mergedProps[canon] = { ...pr, id: canon }
      }
      propMap.set(pid, canon)
    }

    // ── 场景：命名空间化 id + 重写引用 ─────────────────────────
    const orderedKeys = Object.keys(p.scenes)
    partialSceneKeys.push(orderedKeys.map(ns))
    for (const sid of orderedKeys) {
      const sc = p.scenes[sid]!
      const newId = ns(sid)
      const branches: Branch[] = (sc.branches ?? []).map((b) => ({
        ...b,
        id: ns(b.id),
        targetSceneId: ns(b.targetSceneId),
      }))
      const characterIds = (sc.characterIds ?? []).map(
        (c) => charMap.get(c) ?? ns(c),
      )
      const locationId = sc.locationId
        ? locMap.get(sc.locationId) ?? ns(sc.locationId)
        : undefined
      mergedScenes[newId] = {
        ...sc,
        id: newId,
        branches,
        ...(characterIds.length > 0 ? { characterIds } : {}),
        ...(locationId ? { locationId } : {}),
      }
    }
    void propMap // props 仅靠名字去重进库，scene 不直接引用 propId

    partialRoots.push(ns(p.rootSceneId))
    partialTailKeys.push(ns(orderedKeys[orderedKeys.length - 1]!))
  })

  // ── 跨段缝合 ─────────────────────────────────────────────────
  for (let i = 0; i < valid.length; i++) {
    const nextRoot = i + 1 < valid.length ? partialRoots[i + 1]! : null
    for (const sid of partialSceneKeys[i]!) {
      const sc = mergedScenes[sid]
      if (!sc) continue
      const fixed: Branch[] = []
      for (const b of sc.branches) {
        if (mergedScenes[b.targetSceneId]) {
          fixed.push(b)
        } else if (nextRoot) {
          // 悬空分支 → 重指到下一段根（最后一段的悬空分支丢弃 = 结局）
          fixed.push({ ...b, targetSceneId: nextRoot })
        }
      }
      sc.branches = fixed
    }
    // 尾场景无出边 → 补 auto 边连到下一段根，保证整条线连通
    if (nextRoot) {
      const tail = mergedScenes[partialTailKeys[i]!]
      if (tail && tail.branches.length === 0) {
        tail.branches = [
          { id: `${tail.id}_stitch`, kind: 'auto', targetSceneId: nextRoot, label: '' },
        ]
      }
    }
  }

  const first = valid[0]!
  return {
    id: first.id,
    title: first.title,
    synopsis: first.synopsis,
    rootSceneId: partialRoots[0]!,
    scenes: mergedScenes,
    defaultCharMs: first.defaultCharMs,
    schemaVersion: first.schemaVersion,
    characters: Object.keys(mergedChars).length > 0 ? mergedChars : undefined,
    locations: Object.keys(mergedLocs).length > 0 ? mergedLocs : undefined,
    props: Object.keys(mergedProps).length > 0 ? mergedProps : undefined,
    visualStyle: first.visualStyle,
    uiStyle: first.uiStyle,
    originIdea: first.originIdea,
  }
}
