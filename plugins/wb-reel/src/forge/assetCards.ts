import type { Scenario, Scene } from '../scenario/types'
import type { ImageReference } from '../llm/types'

/**
 * 素材库「生成卡片」模型 —— P1（节点生成卡片画板）。
 *
 * 一张卡 = 一个"生成目标"：场景画面 / 某出场角色(+变体) / 某关键道具(+变体) / 自由卡。
 * 卡只负责"生成 + 展示候选"，候选统一进 assetStore 并带 cardTag(本文件) 归组；
 * 是否成为"正式素材"由用户手动「采用」(写 sceneImages) 决定，卡不自动写。
 *
 * 本文件是**纯函数**（只 import 类型），可单测、不碰浏览器 API。
 */

/** 景别中文标签（镜头卡标题用，与 SceneShotGallery 一致）。 */
const SHOT_FRAMING_LABEL: Record<string, string> = {
  wide: '远景',
  medium: '中景',
  close: '近景',
  insert: '插入',
  ots: '过肩',
  pov: '主观',
}

export type CardKind = 'scene' | 'character' | 'prop' | 'free' | 'video' | 'audio'

/** 卡片产物类型：图像 / 视频 / 音频(配音·音色) */
export type CardMediaKind = 'image' | 'video' | 'audio'

/**
 * 锚点引用 —— 指向某角色/场景/道具(可带变体)的参考图。
 * 自由卡 / 视频卡可挂多个；与「视觉-参考图库」强关联（解析到各锚点的 mediaId）。
 */
export interface AnchorRef {
  kind: 'character' | 'location' | 'prop'
  id: string
  /** 变体 id（角色 appearanceVariants / 道具 variants / 场景 angleRefs）；空=主形象/基准 */
  variantId?: string
}

export interface CardVariantOption {
  id: string
  label: string
  /** 与基线 prompt 的增量描述 */
  prompt: string
}

export interface CardSpec {
  /** 稳定标识（不含变体）：用于 React key 与卡状态索引 */
  id: string
  kind: CardKind
  title: string
  /** 产物类型；缺省 image，video 卡为 'video' */
  mediaKind?: CardMediaKind
  /** 锚点 id（character/prop）；scene/free/video 为空 */
  anchorId?: string
  /** 基础 prompt（场景画面 / 锚点 prompt / 自由卡初值） */
  basePrompt: string
  /** 变体清单（character/prop）；供卡内下拉切换 */
  variants?: CardVariantOption[]
  /** 默认选中的变体 id（来自 shot.characterVariantIds 等）；undefined = 主形象 */
  defaultVariantId?: string
  /** 音色卡：说话人角色 id（用于"采用为该角色音色锚点"） */
  speakerId?: string
  /** 音色卡：默认 TTS voice_type（来自角色 voiceAnchor）；空 = 卡内自选 */
  defaultVoiceType?: string
  /**
   * 视频卡专用：是否为「通用视频卡」。
   *   - false/缺省 = 节点视频卡：绑定本节点上下文（场景/角色/道具锚点可选）。
   *   - true = 通用视频卡：全干净，不绑场景锚点，由用户自行上传/选择参考图。
   */
  generic?: boolean
  /**
   * 逐镜「镜头卡」专用：绑定的 shot id。设了它的卡 = 某一镜的视频卡，
   * 候选直接复用编排出片的 tag（reel:orch:sceneId:shotId），无需再生成即自动挂上
   * 该镜已出的视频；从时间轴/生成队列跳「在素材库查看」时滚动聚焦到这张卡。
   */
  shotId?: string
  /**
   * 显式候选归组 tag（覆盖 cardTag 默认推导）。镜头卡用它对齐编排出片 tag，
   * 让「逐镜出片」的视频自动成为该镜卡的候选。
   */
  tag?: string
}

/**
 * 候选归组 tag —— 写进 asset.meta.tags，画板按它把同一张卡（同一变体）的
 * 全部生成历史聚到一起。变体不同 → tag 不同 → 候选分开。
 */
export function cardTag(
  spec: { kind: CardKind; anchorId?: string; id: string; tag?: string },
  variantId?: string,
): string {
  // 镜头卡等显式指定 tag 的卡：直接用它（对齐编排出片 reel:orch:* tag）。
  if (spec.tag) return spec.tag
  const v = variantId ?? 'main'
  switch (spec.kind) {
    case 'scene':
      return 'reel:card:scene'
    case 'character':
      return `reel:card:char:${spec.anchorId ?? '?'}:${v}`
    case 'prop':
      return `reel:card:prop:${spec.anchorId ?? '?'}:${v}`
    case 'free':
      return `reel:card:free:${spec.id}`
    case 'video':
      return `reel:card:video:${spec.id}`
    case 'audio':
      return `reel:card:audio:${spec.id}`
  }
}

/** 场景画面 prompt：优先 prompts.scene，回退 media.prompt */
export function resolveScenePrompt(scene: Scene): string {
  return (scene.prompts?.scene || scene.media?.prompt || '').trim()
}

/** 音色卡说话人选项：出场角色 + 其已锚定音色（缺省走旁白/通用兜底）。 */
export interface SceneSpeaker {
  /** 'narrator' = 旁白（无角色）；否则 = character id */
  charId: string
  name: string
  /** 已锚定的 TTS voice_type（characterVoiceAnchor）；空 = 未锚定，由卡内选音色 */
  voiceType?: string
  voiceLabel?: string
  speedRatio?: number
}

/** 解析某角色已锚定的音色（voiceAnchor）。 */
export function characterVoice(
  scenario: Scenario,
  charId: string,
): { voiceType?: string; label?: string; speedRatio?: number } {
  const c = scenario.characters?.[charId]
  const va = c?.voiceAnchor
  return { voiceType: va?.voiceType, label: va?.label, speedRatio: va?.speedRatio }
}

/** 本节点说话人：出场角色（去重保序）+ 旁白；带各自已锚定音色。 */
export function collectSceneSpeakers(scene: Scene, scenario: Scenario): SceneSpeaker[] {
  const out: SceneSpeaker[] = []
  const chars = scenario.characters ?? {}
  const seen = new Set<string>()
  for (const cid of scene.characterIds ?? []) {
    if (seen.has(cid)) continue
    const c = chars[cid]
    if (!c) continue
    seen.add(cid)
    const va = c.voiceAnchor
    out.push({
      charId: cid,
      name: c.name,
      voiceType: va?.voiceType,
      voiceLabel: va?.label,
      speedRatio: va?.speedRatio,
    })
  }
  // 对白里出现、但不在 characterIds 的说话人（按名字兜底匹配 character）
  for (const d of scene.dialogue ?? []) {
    if (d.role !== 'character' || !d.speaker) continue
    const match = Object.values(chars).find((c) => c.name === d.speaker)
    if (match && !seen.has(match.id)) {
      seen.add(match.id)
      const va = match.voiceAnchor
      out.push({
        charId: match.id,
        name: match.name,
        voiceType: va?.voiceType,
        voiceLabel: va?.label,
        speedRatio: va?.speedRatio,
      })
    }
  }
  return out
}

/** 本节点所有 shot 出现过的关键道具 id（去重，保序） */
export function collectScenePropIds(scene: Scene): string[] {
  const set = new Set<string>()
  for (const sh of scene.shots ?? []) {
    for (const pid of sh.propIds ?? []) set.add(pid)
  }
  return [...set]
}

/** 取本场景任一 shot 对该锚点锁定的变体（首个命中） */
function pickShotVariant(
  scene: Scene,
  kind: 'character' | 'prop',
  anchorId: string,
): string | undefined {
  for (const sh of scene.shots ?? []) {
    const map = kind === 'character' ? sh.characterVariantIds : sh.propVariantIds
    if (map && map[anchorId]) return map[anchorId]
  }
  return undefined
}

/**
 * 自动播种：进节点算出卡片清单 —— 1 张场景卡 + 每个出场角色一张(绑定其选中变体)
 *   + 每个关键道具一张。自由卡由组件本地 state 维护，不在这里。
 */
export function computeNodeCards(scene: Scene, scenario: Scenario): CardSpec[] {
  const cards: CardSpec[] = []

  cards.push({
    id: 'scene',
    kind: 'scene',
    title: '场景画面',
    basePrompt: resolveScenePrompt(scene),
  })

  const chars = scenario.characters ?? {}
  for (const cid of scene.characterIds ?? []) {
    const c = chars[cid]
    if (!c) continue
    const variants: CardVariantOption[] = (c.appearanceVariants ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      prompt: v.prompt,
    }))
    cards.push({
      id: `char:${cid}`,
      kind: 'character',
      anchorId: cid,
      title: `角色 · ${c.name}`,
      basePrompt: [c.name, c.prompt].filter(Boolean).join('. ').trim(),
      variants,
      defaultVariantId: pickShotVariant(scene, 'character', cid),
    })
  }

  const props = scenario.props ?? {}
  for (const pid of collectScenePropIds(scene)) {
    const p = props[pid]
    if (!p) continue
    const variants: CardVariantOption[] = (p.variants ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      prompt: v.prompt,
    }))
    cards.push({
      id: `prop:${pid}`,
      kind: 'prop',
      anchorId: pid,
      title: `道具 · ${p.name}`,
      basePrompt: [p.name, p.prompt].filter(Boolean).join('. ').trim(),
      variants,
      defaultVariantId: pickShotVariant(scene, 'prop', pid),
    })
  }

  // 逐镜「镜头卡」：每个 shot 一张视频卡，候选 tag 对齐编排出片
  //   （reel:orch:sceneId:shotId）—— 这样「逐镜出片」生成的视频会自动成为该镜卡的
  //   候选，作者在素材库中区就能看到这一镜的完整信息卡（视频 + prompt + 参考），
  //   而不用从右侧托盘的小缩略里找。prompt 预填该镜画面意图，首帧预填该镜关键帧。
  const sortedShots = (scene.shots ?? []).slice().sort((a, b) => a.order - b.order)
  sortedShots.forEach((sh, i) => {
    const framing = SHOT_FRAMING_LABEL[sh.framing] ?? sh.framing
    cards.push({
      id: `shot:${sh.id}`,
      kind: 'video',
      mediaKind: 'video',
      shotId: sh.id,
      tag: `reel:orch:${scene.id}:${sh.id}`,
      title: `镜${i + 1} · ${framing}`,
      basePrompt: (sh.prompt || resolveScenePrompt(scene)).trim(),
    })
  })

  // 音色卡：每个出场说话人一张（预填其首句台词 + 已锚定音色）。
  for (const sp of collectSceneSpeakers(scene, scenario)) {
    const firstLine =
      (scene.dialogue ?? []).find(
        (d) => d.role === 'character' && d.speaker === sp.name,
      )?.text ?? ''
    cards.push({
      id: `audio:${sp.charId}`,
      kind: 'audio',
      mediaKind: 'audio',
      anchorId: sp.charId,
      title: `配音 · ${sp.name}`,
      basePrompt: firstLine,
      speakerId: sp.charId,
      defaultVoiceType: sp.voiceType,
    })
  }

  return cards
}

/**
 * 组合送生图的最终 prompt（不含全局美术风格前缀——那个在生成时再叠）：
 *   编辑后的 prompt + 选中变体的增量描述。
 */
export function composeCardPrompt(
  editedPrompt: string,
  variants: CardVariantOption[] | undefined,
  variantId: string | undefined,
): string {
  const v = variantId ? variants?.find((x) => x.id === variantId) : undefined
  return [editedPrompt.trim(), v?.prompt?.trim()].filter(Boolean).join('. ')
}

// ───────────────────────────────────────────────────────────────────────────
// 锚点 / 参考图解析 —— 与「视觉-参考图库」强关联。
//   把角色/场景/道具(+变体)解析成 mediaId，再经 mediaLookup 换成可喂 provider 的 URL。
//   纯函数：mediaLookup 由调用方注入（通常是 mediaStore.entries[id]?.url），便于单测。
// ───────────────────────────────────────────────────────────────────────────

/** 解析一个锚点引用对应的参考图 mediaId（变体优先，回退主图/三视图）。 */
export function anchorRefMediaId(
  scenario: Scenario,
  ref: AnchorRef,
): string | undefined {
  if (ref.kind === 'character') {
    const c = scenario.characters?.[ref.id]
    if (!c) return undefined
    if (ref.variantId) {
      const v = c.appearanceVariants?.find((x) => x.id === ref.variantId)
      if (v?.mediaId) return v.mediaId
    }
    return c.turnaroundRefImageId ?? c.refImageId
  }
  if (ref.kind === 'location') {
    const l = scenario.locations?.[ref.id]
    if (!l) return undefined
    if (ref.variantId) {
      const a = l.angleRefs?.find((x) => x.id === ref.variantId)
      if (a?.mediaId) return a.mediaId
    }
    return l.refImageId
  }
  const p = scenario.props?.[ref.id]
  if (!p) return undefined
  if (ref.variantId) {
    const v = p.variants?.find((x) => x.id === ref.variantId)
    if (v?.mediaId) return v.mediaId
  }
  return p.refImageId
}

/** 锚点人类可读标签（含变体后缀），UI / debug 用。 */
export function anchorLabel(scenario: Scenario, ref: AnchorRef): string {
  let base = ref.id
  let variantLabel: string | undefined
  if (ref.kind === 'character') {
    const c = scenario.characters?.[ref.id]
    base = c?.name ?? ref.id
    variantLabel = c?.appearanceVariants?.find((v) => v.id === ref.variantId)?.label
  } else if (ref.kind === 'location') {
    const l = scenario.locations?.[ref.id]
    base = l?.name ?? ref.id
    variantLabel = l?.angleRefs?.find((v) => v.id === ref.variantId)?.label
  } else {
    const p = scenario.props?.[ref.id]
    base = p?.name ?? ref.id
    variantLabel = p?.variants?.find((v) => v.id === ref.variantId)?.label
  }
  return variantLabel ? `${base} · ${variantLabel}` : base
}

const ROLE_BY_KIND: Record<AnchorRef['kind'], ImageReference['role']> = {
  character: 'character',
  location: 'location',
  prop: 'prop',
}

/** 把一组锚点引用解析成 ImageReference[]（丢弃无参考图的锚点）。 */
export function buildAnchorRefs(
  scenario: Scenario,
  anchors: AnchorRef[],
  mediaLookup: (id: string) => string | undefined,
): ImageReference[] {
  const out: ImageReference[] = []
  const seen = new Set<string>()
  for (const a of anchors) {
    const mid = anchorRefMediaId(scenario, a)
    if (!mid || seen.has(mid)) continue
    const url = mediaLookup(mid)
    if (!url) continue
    seen.add(mid)
    out.push({ dataUrl: url, role: ROLE_BY_KIND[a.kind], label: anchorLabel(scenario, a) })
  }
  return out
}

/**
 * 自动播种卡片(scene/character/prop)的参考图：
 *   - scene 卡  → 场景基准图 + 出场角色三视图 + 关键道具图（一致性锚点）
 *   - character → 该角色(变体优先)三视图/立绘
 *   - prop      → 该道具(变体优先)基准图
 *   - free/video→ 不在这里（用 buildAnchorRefs(选中锚点)）
 */
export function buildSeededCardRefs(args: {
  spec: CardSpec
  variantId?: string
  scene: Scene
  scenario: Scenario
  mediaLookup: (id: string) => string | undefined
}): ImageReference[] {
  const { spec, variantId, scene, scenario, mediaLookup } = args
  const anchors: AnchorRef[] = []
  if (spec.kind === 'scene') {
    if (scene.locationId) anchors.push({ kind: 'location', id: scene.locationId })
    for (const cid of (scene.characterIds ?? []).slice(0, 3)) {
      anchors.push({ kind: 'character', id: cid })
    }
    for (const pid of collectScenePropIds(scene).slice(0, 2)) {
      anchors.push({ kind: 'prop', id: pid })
    }
  } else if (spec.kind === 'character' && spec.anchorId) {
    anchors.push({ kind: 'character', id: spec.anchorId, variantId })
  } else if (spec.kind === 'prop' && spec.anchorId) {
    anchors.push({ kind: 'prop', id: spec.anchorId, variantId })
  }
  return buildAnchorRefs(scenario, anchors, mediaLookup)
}
