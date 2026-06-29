import type { Scenario, Scene, Shot, Character, Location, Prop } from '../scenario/types'
import { SEEDANCE_MAX_REF_IMAGES } from './seedanceContent'

/**
 * `buildVideoReferenceSet` —— 为单个 shot 构造 Seedance 的参考图序列。
 *
 * 需求来源（作者 2026-05-07）：
 *   "智能体根据当前分镜自动加上自动排序引用等"
 *   · Seedance 2.0 支持最多 9 张 reference_image，如果全塞会超额；
 *     作者不想每次自己勾选，希望系统"按相关性"挑出 9 张最能稳一致性的。
 *   · 首位必须是当前 shot 的关键帧（首帧）—— 这是 Seedance 的约定。
 *   · 其余槽位按"同场同角色 > 同场 > 同角色 > 兜底"打分，去重。
 *
 * 本函数是纯函数，不 fetch / 不 side effect，便于单测；
 * 只接 "mediaLookup(id) => url | undefined"，不关心底层是 assetStore 还是 mediaStore。
 *
 * 返回值永远是"去重、截断到 9 张、首位为 shot keyframe（若存在）"的 URL 数组。
 * 如果 shot 没有 keyframeMediaRef，返回数组**可能为空**（调用方应 fallback 到 scene cache）。
 */

export interface BuildVideoReferenceSetInput {
  scenario: Scenario
  scene: Scene
  shot: Shot
  /** mediaId → 资产 URL 查询；返回 undefined 说明资产还没 ready，自动跳过 */
  mediaLookup: (mediaId: string) => string | undefined
  /**
   * 可选的 max 限制（测试用 / 兼容其他模型 kling=1）。
   * 默认 Seedance 2.0 上限 9。
   */
  max?: number
}

export interface BuildVideoReferenceSetOutput {
  /** 最终要喂进 content[reference_image] 的顺序数组 */
  urls: string[]
  /** 每张图的来源 trace，UI 可以展示"这些图为什么被选中" */
  trace: Array<{
    url: string
    source:
      | 'shot-keyframe'
      | 'prev-shot-keyframe'
      | 'next-shot-keyframe'
      | 'far-shot-keyframe'
      | 'location-ref'
      | 'location-angle'
      | 'character-turnaround'
      | 'prop-ref'
    entityId?: string
    score: number
  }>
}

/**
 * 权重表（数字越大越优先入选）——调得比较保守，保证"当前 shot + 当前 scene
 * 全部 location/character 参考"大概能占满 6-7 张，剩 2-3 张给邻近 shot。
 */
const WEIGHTS = {
  shotKeyframe: 1000,        // 首帧，永远第一
  currentSceneLocation: 90,  // 当前场所基准图
  locationAngle: 80,         // 当前场所特定角度（按 scene.locationAngle 匹配时 +20）
  sceneCharacter: 70,        // 当前场景任意一个角色的 turnaround
  sceneProp: 60,             // 当前场景出现的关键道具
  adjacentShotKeyframe: 40,  // 相邻 shot 的 keyframe（提供运动前后参考）
  farShotKeyframe: 20,       // 同场其他 shot 的 keyframe
}

export function buildVideoReferenceSet(
  input: BuildVideoReferenceSetInput,
): BuildVideoReferenceSetOutput {
  const { scenario, scene, shot, mediaLookup } = input
  const max = input.max ?? SEEDANCE_MAX_REF_IMAGES

  // 候选池（url 可能重复 —— 同一资产被多路径引用；后续统一去重）
  type Cand = BuildVideoReferenceSetOutput['trace'][number]
  const pool: Cand[] = []

  // 1) 当前 shot keyframe ——  永远最高分，确保排第 0
  if (shot.keyframeMediaRef) {
    const url = mediaLookup(shot.keyframeMediaRef)
    if (url) {
      pool.push({ url, source: 'shot-keyframe', entityId: shot.id, score: WEIGHTS.shotKeyframe })
    }
  }

  // 2) 相邻 shot（order 差 1）keyframe —— 让模型感知前后连贯
  const shots = (scene.shots ?? []).slice().sort((a, b) => a.order - b.order)
  const idx = shots.findIndex((s) => s.id === shot.id)
  if (idx >= 0) {
    const prev = idx > 0 ? shots[idx - 1] : undefined
    const next = idx < shots.length - 1 ? shots[idx + 1] : undefined
    if (prev?.keyframeMediaRef) {
      const u = mediaLookup(prev.keyframeMediaRef)
      if (u) {
        pool.push({
          url: u,
          source: 'prev-shot-keyframe',
          entityId: prev.id,
          score: WEIGHTS.adjacentShotKeyframe + 1, // prev 比 next 略高（更接近运动起点）
        })
      }
    }
    if (next?.keyframeMediaRef) {
      const u = mediaLookup(next.keyframeMediaRef)
      if (u) {
        pool.push({
          url: u,
          source: 'next-shot-keyframe',
          entityId: next.id,
          score: WEIGHTS.adjacentShotKeyframe,
        })
      }
    }
    // 同场其他更远的 shot
    for (const s of shots) {
      if (s.id === shot.id) continue
      if (s.id === prev?.id || s.id === next?.id) continue
      if (!s.keyframeMediaRef) continue
      const u = mediaLookup(s.keyframeMediaRef)
      if (u) {
        pool.push({
          url: u,
          source: 'far-shot-keyframe',
          entityId: s.id,
          score: WEIGHTS.farShotKeyframe,
        })
      }
    }
  }

  // 3) Location 基准图 + angle 参考
  const locationId = scene.locationId
  if (locationId) {
    const loc: Location | undefined = scenario.locations?.[locationId]
    if (loc?.refImageId) {
      const u = mediaLookup(loc.refImageId)
      if (u) {
        pool.push({
          url: u,
          source: 'location-ref',
          entityId: loc.id,
          score: WEIGHTS.currentSceneLocation,
        })
      }
    }
    // Scene 有可能指定了 locationAngle，优先选同 id；否则把所有 angle 加进去打分
    // NB: reel-studio 目前还没落地 scene.locationAngleId schema，这里做柔性读取 ——
    //   如果未来加上了，这段代码自动生效。
    const preferredAngle = (scene as unknown as { locationAngleId?: string })
      .locationAngleId
    for (const a of loc?.angleRefs ?? []) {
      if (!a.mediaId) continue
      const u = mediaLookup(a.mediaId)
      if (!u) continue
      const bonus = a.id === preferredAngle ? 20 : 0
      pool.push({
        url: u,
        source: 'location-angle',
        entityId: a.id,
        score: WEIGHTS.locationAngle + bonus,
      })
    }
  }

  // 4) 角色 turnaround（shot.characterIds 优先；fallback 到 scene.characterIds）
  const charIds =
    (shot.characterIds && shot.characterIds.length > 0
      ? shot.characterIds
      : scene.characterIds) ?? []
  for (const cid of charIds) {
    const c: Character | undefined = scenario.characters?.[cid]
    if (!c?.turnaroundRefImageId) continue
    const u = mediaLookup(c.turnaroundRefImageId)
    if (!u) continue
    pool.push({
      url: u,
      source: 'character-turnaround',
      entityId: cid,
      score: WEIGHTS.sceneCharacter,
    })
  }

  // 5) 关键道具 —— 当前 scope 用"所有 scenario.props 中 ref 存在的"作为候选池，
  //    评分相同；后续接 scene.propIds 后可以精确到 scene 级。
  const sceneProps = (scene as unknown as { propIds?: string[] }).propIds
  const propIter = sceneProps && sceneProps.length > 0
    ? sceneProps
    : Object.keys(scenario.props ?? {})
  for (const pid of propIter) {
    const p: Prop | undefined = scenario.props?.[pid]
    if (!p?.refImageId) continue
    const u = mediaLookup(p.refImageId)
    if (!u) continue
    pool.push({
      url: u,
      source: 'prop-ref',
      entityId: pid,
      // 未在 scene 中显式声明的 prop 给更低分
      score:
        sceneProps && sceneProps.includes(pid)
          ? WEIGHTS.sceneProp
          : WEIGHTS.sceneProp - 30,
    })
  }

  // 去重：按 url；同一 url 多源取分最高那条；保留 shot-keyframe 的 source 优先级
  const byUrl = new Map<string, Cand>()
  for (const c of pool) {
    const prev = byUrl.get(c.url)
    if (!prev || c.score > prev.score) byUrl.set(c.url, c)
  }

  // 按 score 降序；同分按 source 的重要度打破平局（shot-keyframe > ...）
  const sortOrder: Record<string, number> = {
    'shot-keyframe': 0,
    'location-ref': 1,
    'location-angle': 2,
    'character-turnaround': 3,
    'prop-ref': 4,
    'prev-shot-keyframe': 5,
    'next-shot-keyframe': 6,
    'far-shot-keyframe': 7,
  }
  const sorted = Array.from(byUrl.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (sortOrder[a.source] ?? 99) - (sortOrder[b.source] ?? 99)
  })

  // 强制首位 = shot-keyframe（如果存在）
  const head = sorted.find((c) => c.source === 'shot-keyframe')
  const rest = sorted.filter((c) => c !== head)
  const ordered = head ? [head, ...rest] : rest

  const truncated = ordered.slice(0, max)
  return {
    urls: truncated.map((c) => c.url),
    trace: truncated.map((c) => ({ ...c })),
  }
}
