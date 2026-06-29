/**
 * buildSeedanceReferenceSet —— 统一锚点装配器（P1-A）
 *
 * 把我们的视觉锚点（角色 / 场景 / 道具 / 关键帧 / 展位 blockout）装配成符合
 * **Seedance 2.0 + sd2-pe** 契约的参考图集：
 *   - `@图片N`：按上传顺序编号（ord，1 起），对应最终发送顺序。
 *   - `<主体N>`：角色主体标签（subject），供 sd2-pe 第一段「主体定义」用。
 *   - 角色锚点用 **大头照(headshot) + 全身照(fullbody)**（替代三视图）。
 *   - 「重要素材前置」：人脸大头照排最前，其次全身照，再关键帧/场景/道具/展位。
 *
 * 与 `buildVideoReferenceSet.ts` 的关系：本文件是 sd2-pe 通道的新装配器（④⑤ 共用），
 * 旧者保留给现存路径，待 P2/P4 切换后逐步退役。
 *
 * 设计约束：
 *   1) **纯函数**：不 import provider / React / scenario store；输入用解耦的最小形状，
 *      url 由调用方通过 resolveUrl 注入（便于单测）。
 *   2) 打码不在此处做 —— 这里只标 `realisticFace`，真正打码在上传层 faceMaskTool。
 *   3) 首尾帧模式与多模态参考模式**互斥**（Seedance 2.0 硬约束）：
 *      - mode='startEnd'：只放 first_frame（关键帧），锚点图忽略并记 droppedReasons。
 *      - mode='multimodal'：全部 reference_image，按优先级排序、截断到 cap.maxRefImages。
 */

import type { ModelCapability } from './modelCapabilities'

export type AnchorKind = 'character' | 'location' | 'prop' | 'keyframe' | 'blockout'

export interface SeedanceRefImage {
  /** 上传顺序号，1 起；对应 sd2-pe 的 @图片N */
  ord: number
  url: string
  kind: AnchorKind
  /** 角色主体标签（sd2-pe <主体N>），仅 character 有 */
  subject?: string
  /** 角色锚点细分用途 */
  charRole?: 'headshot' | 'fullbody'
  frameRole: 'first_frame' | 'last_frame' | 'reference_image'
  /** 是否写实真人 → 上传层据此决定是否半脸打码 */
  realisticFace?: boolean
  label?: string
}

export interface SeedanceSubject {
  subject: string
  headshotOrd?: number
  fullbodyOrd?: number
}

export interface SeedanceReferenceSet {
  images: SeedanceRefImage[]
  subjects: SeedanceSubject[]
  /** 超限丢弃 / 缺图 / 模式互斥 等告警 */
  droppedReasons: string[]
}

export interface RefCharacterInput {
  id: string
  name: string
  headshotMediaId?: string
  fullbodyMediaId?: string
  /** 写实真人 → 标 realisticFace */
  realistic?: boolean
}

export interface BuildSeedanceRefArgs {
  characters: RefCharacterInput[]
  location?: { id: string; mediaId?: string; name?: string }
  props?: Array<{ id: string; name: string; mediaId?: string }>
  /** ④ 产出的关键帧；multimodal 下作 reference_image，startEnd 下作 first_frame */
  keyframeMediaId?: string
  /** 3D 机位静帧（展位参考，软参考，永不进 first_frame，防白模泄漏） */
  blockoutStillMediaId?: string
  mode: 'startEnd' | 'multimodal'
  cap: ModelCapability
  /** mediaId → url；返回 undefined 表示取不到（静默跳过 + 告警） */
  resolveUrl: (mediaId: string) => string | undefined
}

/** 优先级权重（越小越靠前），实现「重要素材前置」。 */
const WEIGHT = {
  charHeadshot: 0,
  charFullbody: 1,
  keyframe: 2,
  location: 3,
  prop: 4,
  blockout: 5,
} as const

interface Candidate {
  weight: number
  url: string
  kind: AnchorKind
  subject?: string
  charRole?: 'headshot' | 'fullbody'
  realisticFace?: boolean
  label?: string
}

export function buildSeedanceReferenceSet(
  args: BuildSeedanceRefArgs,
): SeedanceReferenceSet {
  const droppedReasons: string[] = []
  const maxImages = args.cap.maxRefImages ?? 9

  const resolve = (mediaId: string | undefined, what: string): string | undefined => {
    if (!mediaId) return undefined
    const url = args.resolveUrl(mediaId)
    if (!url) {
      droppedReasons.push(`${what} 取不到 url（mediaId=${mediaId}），已跳过`)
      return undefined
    }
    return url
  }

  // ── 首尾帧模式：只放关键帧作 first_frame，锚点图与之互斥 ──
  if (args.mode === 'startEnd') {
    const images: SeedanceRefImage[] = []
    const kfUrl = resolve(args.keyframeMediaId, '关键帧')
    if (kfUrl) {
      images.push({
        ord: 1,
        url: kfUrl,
        kind: 'keyframe',
        frameRole: 'first_frame',
        label: '关键帧（首帧）',
      })
    }
    const anchorCount =
      args.characters.length +
      (args.location ? 1 : 0) +
      (args.props?.length ?? 0) +
      (args.blockoutStillMediaId ? 1 : 0)
    if (anchorCount > 0) {
      droppedReasons.push(
        '首尾帧模式与多模态参考互斥：角色/场景/道具/展位锚点图已忽略（如需锚点请用 multimodal 模式）',
      )
    }
    return { images, subjects: [], droppedReasons }
  }

  // ── 多模态参考模式：全部 reference_image，按优先级排序后截断 ──
  const candidates: Candidate[] = []

  // 角色大头照（全部，按角色顺序）→ 再角色全身照
  for (const c of args.characters) {
    const url = resolve(c.headshotMediaId, `角色「${c.name}」大头照`)
    if (url) {
      candidates.push({
        weight: WEIGHT.charHeadshot,
        url,
        kind: 'character',
        subject: c.name,
        charRole: 'headshot',
        realisticFace: c.realistic === true,
        label: `${c.name}（大头照）`,
      })
    }
  }
  for (const c of args.characters) {
    const url = resolve(c.fullbodyMediaId, `角色「${c.name}」全身照`)
    if (url) {
      candidates.push({
        weight: WEIGHT.charFullbody,
        url,
        kind: 'character',
        subject: c.name,
        charRole: 'fullbody',
        realisticFace: c.realistic === true,
        label: `${c.name}（全身照）`,
      })
    }
  }

  const kfUrl = resolve(args.keyframeMediaId, '关键帧')
  if (kfUrl) {
    candidates.push({ weight: WEIGHT.keyframe, url: kfUrl, kind: 'keyframe', label: '关键帧' })
  }

  if (args.location) {
    const url = resolve(args.location.mediaId, '场景参考')
    if (url) {
      candidates.push({
        weight: WEIGHT.location,
        url,
        kind: 'location',
        label: args.location.name ? `场景：${args.location.name}` : '场景参考',
      })
    }
  }

  for (const p of args.props ?? []) {
    const url = resolve(p.mediaId, `道具「${p.name}」`)
    if (url) {
      candidates.push({ weight: WEIGHT.prop, url, kind: 'prop', label: `道具：${p.name}` })
    }
  }

  const boUrl = resolve(args.blockoutStillMediaId, '展位静帧')
  if (boUrl) {
    candidates.push({ weight: WEIGHT.blockout, url: boUrl, kind: 'blockout', label: '展位（机位静帧）' })
  }

  // 稳定排序：按权重升序，权重相同保持插入顺序
  const sorted = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.weight - b.c.weight) || (a.i - b.i))
    .map((x) => x.c)

  const kept = sorted.slice(0, maxImages)
  const dropped = sorted.slice(maxImages)
  if (dropped.length > 0) {
    droppedReasons.push(
      `参考图超过上限 ${maxImages}，已按优先级截断 ${dropped.length} 张：` +
        dropped.map((d) => d.label ?? d.kind).join('、'),
    )
  }

  const images: SeedanceRefImage[] = kept.map((c, idx) => ({
    ord: idx + 1,
    url: c.url,
    kind: c.kind,
    subject: c.subject,
    charRole: c.charRole,
    frameRole: 'reference_image',
    realisticFace: c.realisticFace,
    label: c.label,
  }))

  // 主体清单：按角色出现顺序，记录其 headshot/fullbody 的 ord（被截断的为 undefined）
  const subjects: SeedanceSubject[] = []
  for (const c of args.characters) {
    const headshot = images.find((im) => im.subject === c.name && im.charRole === 'headshot')
    const fullbody = images.find((im) => im.subject === c.name && im.charRole === 'fullbody')
    if (headshot || fullbody) {
      subjects.push({
        subject: c.name,
        headshotOrd: headshot?.ord,
        fullbodyOrd: fullbody?.ord,
      })
    }
  }

  return { images, subjects, droppedReasons }
}
