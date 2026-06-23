/**
 * Scenario 引用扫描 —— 把剧本里所有指向媒体的字段"指针化"。
 *
 * 背景：scenario 里分散在 10+ 个字段里都存着媒体引用（mediaId / URL / dataURL），
 * 打包流程要能做到：
 *   1) 枚举所有引用 → 逐个抓成 Blob 丢进 zip
 *   2) 把每个引用原地改写成稳定的 `pkg:<hash>`
 *
 * 返回 `RefCell` 数组，每个 cell 有 `get()` 和 `set(newRef)`，
 * 下游流程直接在每个 cell 上执行"读 → 解析 → 写回"，
 * 不用按字段名 switch 二十次。
 *
 * 覆盖字段（types.ts · v3）：
 *   · Scene
 *       - media.ref                        任意媒体
 *       - sceneImages[]                    mediaId
 *       - sceneVideos[]                    mediaId
 *       - audio[].ref                      mediaId（音频）
 *   · Shot
 *       - keyframeMediaRef / startFrameMediaRef / endFrameMediaRef   mediaId（图）
 *       - videoMediaRef                    mediaId（视频）
 *   · Character
 *       - refImageId / turnaroundRefImageId  mediaId（图）
 *   · Location
 *       - refImageId                       mediaId
 *       - angleRefs[].mediaId              mediaId
 *   · Prop
 *       - refImageId                       mediaId
 *   · UIStyle
 *       - refImageId                       mediaId
 *
 * 注意：
 *   · `MediaRef.kind='PLACEHOLDER'` 时 ref 可空或占位，collect 不扫
 *   · 空串 / undefined / 'none' 等空值一律跳过
 *   · mediaId / URL / dataURL 是混杂的，由下游 resolveRef 识别
 */

import type { Scenario } from '../types'

export interface RefCell {
  /** 当前值 */
  get(): string
  /** 写新值；内部直接改 scenario 对象（scenario 会被深 clone 一次给打包器用） */
  set(next: string): void
  /** 标签，便于 manifest / UI 显示"这个文件属于哪个 scene/shot" */
  label: string
}

/**
 * 判断某个引用是否"需要打包"。
 * 外链 / 空串 / 占位符直接跳过。
 */
export function refLooksPackable(ref: string | undefined): boolean {
  if (!ref) return false
  if (ref === 'none' || ref === '__placeholder__') return false
  return true
}

/**
 * 就地扫 scenario，返回所有需要解析的引用 cells。
 *
 * 调用方约定：传进来的 scenario 应当是**打包器专用的深拷贝**，扫描 + 改写
 * 都是破坏性的。
 */
export function collectScenarioRefs(scenario: Scenario): RefCell[] {
  const cells: RefCell[] = []

  // ─── Characters ──────────────────────────────────────────────────
  if (scenario.characters) {
    for (const [cid, ch] of Object.entries(scenario.characters)) {
      if (refLooksPackable(ch.refImageId)) {
        cells.push({
          get: () => ch.refImageId!,
          set: (v) => { ch.refImageId = v },
          label: `character/${cid}/refImage`,
        })
      }
      if (refLooksPackable(ch.turnaroundRefImageId)) {
        cells.push({
          get: () => ch.turnaroundRefImageId!,
          set: (v) => { ch.turnaroundRefImageId = v },
          label: `character/${cid}/turnaround`,
        })
      }
      if (refLooksPackable(ch.auditionVideoMediaId)) {
        cells.push({
          get: () => ch.auditionVideoMediaId!,
          set: (v) => { ch.auditionVideoMediaId = v },
          label: `character/${cid}/auditionVideo`,
        })
      }
      if (refLooksPackable(ch.voiceSampleMediaId)) {
        cells.push({
          get: () => ch.voiceSampleMediaId!,
          set: (v) => { ch.voiceSampleMediaId = v },
          label: `character/${cid}/voiceSample`,
        })
      }
    }
  }

  // ─── Locations ───────────────────────────────────────────────────
  if (scenario.locations) {
    for (const [lid, loc] of Object.entries(scenario.locations)) {
      if (refLooksPackable(loc.refImageId)) {
        cells.push({
          get: () => loc.refImageId!,
          set: (v) => { loc.refImageId = v },
          label: `location/${lid}/refImage`,
        })
      }
      if (loc.angleRefs) {
        for (let i = 0; i < loc.angleRefs.length; i++) {
          const a = loc.angleRefs[i]!
          if (refLooksPackable(a.mediaId)) {
            cells.push({
              get: () => a.mediaId!,
              set: (v) => { a.mediaId = v },
              label: `location/${lid}/angle${i + 1}`,
            })
          }
        }
      }
    }
  }

  // ─── Props ───────────────────────────────────────────────────────
  if (scenario.props) {
    for (const [pid, pr] of Object.entries(scenario.props)) {
      if (refLooksPackable(pr.refImageId)) {
        cells.push({
          get: () => pr.refImageId!,
          set: (v) => { pr.refImageId = v },
          label: `prop/${pid}/refImage`,
        })
      }
    }
  }

  // ─── UIStyle ─────────────────────────────────────────────────────
  if (scenario.uiStyle && refLooksPackable(scenario.uiStyle.refImageId)) {
    const ui = scenario.uiStyle
    cells.push({
      get: () => ui.refImageId!,
      set: (v) => { ui.refImageId = v },
      label: 'uiStyle/refImage',
    })
  }

  // ─── Scenes ──────────────────────────────────────────────────────
  for (const [sid, sc] of Object.entries(scenario.scenes ?? {})) {
    // scene.media.ref
    if (sc.media && refLooksPackable(sc.media.ref)) {
      const m = sc.media
      cells.push({
        get: () => m.ref!,
        set: (v) => { m.ref = v },
        label: `scene/${sid}/media`,
      })
    }

    // scene.sceneImages[]
    if (Array.isArray(sc.sceneImages)) {
      const arr = sc.sceneImages
      for (let i = 0; i < arr.length; i++) {
        if (!refLooksPackable(arr[i])) continue
        const idx = i
        cells.push({
          get: () => arr[idx]!,
          set: (v) => { arr[idx] = v },
          label: `scene/${sid}/sceneImages/${idx}`,
        })
      }
    }

    // scene.sceneVideos[]
    if (Array.isArray(sc.sceneVideos)) {
      const arr = sc.sceneVideos
      for (let i = 0; i < arr.length; i++) {
        if (!refLooksPackable(arr[i])) continue
        const idx = i
        cells.push({
          get: () => arr[idx]!,
          set: (v) => { arr[idx] = v },
          label: `scene/${sid}/sceneVideos/${idx}`,
        })
      }
    }

    // scene.audio[].ref
    if (Array.isArray(sc.audio)) {
      for (let i = 0; i < sc.audio.length; i++) {
        const clip = sc.audio[i]!
        if (!refLooksPackable(clip.ref)) continue
        cells.push({
          get: () => clip.ref,
          set: (v) => { clip.ref = v },
          label: `scene/${sid}/audio/${clip.id}`,
        })
      }
    }

    // scene.shots[]
    if (Array.isArray(sc.shots)) {
      for (const shot of sc.shots) {
        const pairs: Array<[keyof typeof shot, string]> = [
          ['keyframeMediaRef', 'keyframe'],
          ['startFrameMediaRef', 'startFrame'],
          ['endFrameMediaRef', 'endFrame'],
          ['videoMediaRef', 'video'],
        ]
        for (const [field, tag] of pairs) {
          const cur = shot[field] as string | undefined
          if (!refLooksPackable(cur)) continue
          cells.push({
            get: () => shot[field] as string,
            set: (v) => {
              (shot as unknown as Record<string, unknown>)[field as string] = v
            },
            label: `scene/${sid}/shot/${shot.id}/${tag}`,
          })
        }
      }
    }
  }

  return cells
}
