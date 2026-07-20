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

/**
 * 媒体类别提示 —— 决定该引用在成品包里落成哪种引擎资产 kind：
 *   - 'video' → 引擎自有 `VideoAsset`（kind:'video'）
 *   - 'image' | 'audio' | 'other' → host `raw-file`（kind:'raw-file'）
 * （P1-A：图片不走 TextureAsset、音频不走引擎音频，产物与 DOM `<img>/<audio>` 不匹配。）
 */
export type RefMediaKind = 'video' | 'image' | 'audio' | 'other'

export interface RefCell {
  /** 当前值 */
  get(): string
  /** 写新值；内部直接改 scenario 对象（scenario 会被深 clone 一次给打包器用） */
  set(next: string): void
  /** 标签，便于 manifest / UI 显示"这个文件属于哪个 scene/shot" */
  label: string
  /** 媒体类别（决定成品资产 kind：video→VideoAsset，其余→raw-file）。 */
  media: RefMediaKind
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
          media: 'image',
        })
      }
      if (refLooksPackable(ch.turnaroundRefImageId)) {
        cells.push({
          get: () => ch.turnaroundRefImageId!,
          set: (v) => { ch.turnaroundRefImageId = v },
          label: `character/${cid}/turnaround`,
          media: 'image',
        })
      }
      if (refLooksPackable(ch.auditionVideoMediaId)) {
        cells.push({
          get: () => ch.auditionVideoMediaId!,
          set: (v) => { ch.auditionVideoMediaId = v },
          label: `character/${cid}/auditionVideo`,
          media: 'video',
        })
      }
      if (refLooksPackable(ch.voiceSampleMediaId)) {
        cells.push({
          get: () => ch.voiceSampleMediaId!,
          set: (v) => { ch.voiceSampleMediaId = v },
          label: `character/${cid}/voiceSample`,
          media: 'audio',
        })
      }
      // 角色外观变体参考图（P1-A 补齐扫描缺口）——缺则角色定妆/换装 variant 参考图漏打包。
      if (Array.isArray(ch.appearanceVariants)) {
        for (const variant of ch.appearanceVariants) {
          if (!refLooksPackable(variant.mediaId)) continue
          cells.push({
            get: () => variant.mediaId!,
            set: (v) => { variant.mediaId = v },
            label: `character/${cid}/variant/${variant.id}`,
            media: 'image',
          })
        }
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
          media: 'image',
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
              media: 'image',
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
          media: 'image',
        })
      }
      // 道具状态变体参考图（P1-A 补齐扫描缺口）——缺则 variant 参考图漏打包。
      if (Array.isArray(pr.variants)) {
        for (const variant of pr.variants) {
          if (!refLooksPackable(variant.mediaId)) continue
          cells.push({
            get: () => variant.mediaId!,
            set: (v) => { variant.mediaId = v },
            label: `prop/${pid}/variant/${variant.id}`,
            media: 'image',
          })
        }
      }
    }
  }

  // ─── Inventory items ─────────────────────────────────────────────
  if (scenario.items) {
    for (const [iid, it] of Object.entries(scenario.items)) {
      if (refLooksPackable(it.iconMediaId)) {
        cells.push({
          get: () => it.iconMediaId!,
          set: (v) => { it.iconMediaId = v },
          label: `item/${iid}/icon`,
          media: 'image',
        })
      }
    }
  }

  // ─── UI assets (v9) ──────────────────────────────────────────────
  // UI 素材库:成品图 mediaId + 图生图参考图 refMediaIds。HUD(scenario.hud)
  // 只引用 uiAssetId(逻辑指针,非媒体),故不在此扫描——运行时经 uiAssets 解引用。
  if (scenario.uiAssets) {
    for (const [uid, ua] of Object.entries(scenario.uiAssets)) {
      if (refLooksPackable(ua.mediaId)) {
        cells.push({
          get: () => ua.mediaId!,
          set: (v) => { ua.mediaId = v },
          label: `uiAsset/${uid}/media`,
          media: 'image',
        })
      }
      if (Array.isArray(ua.refMediaIds)) {
        const arr = ua.refMediaIds
        for (let i = 0; i < arr.length; i++) {
          if (!refLooksPackable(arr[i])) continue
          const idx = i
          cells.push({
            get: () => arr[idx]!,
            set: (v) => { arr[idx] = v },
            label: `uiAsset/${uid}/ref/${idx}`,
            media: 'image',
          })
        }
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
      media: 'image',
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
        media: m.kind === 'VIDEO' ? 'video' : 'image',
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
          media: 'image',
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
          media: 'video',
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
          media: 'audio',
        })
      }
    }

    // scene.stickerClips[] —— 自定义图片贴纸的 mediaId（内置图标/花字不引用素材）
    if (Array.isArray(sc.stickerClips)) {
      for (const stk of sc.stickerClips) {
        if (stk.kind !== 'image' || !refLooksPackable(stk.mediaId)) continue
        cells.push({
          get: () => stk.mediaId!,
          set: (v) => { stk.mediaId = v },
          label: `scene/${sid}/sticker/${stk.id}`,
          media: 'image',
        })
      }
    }

    // scene.shots[]
    if (Array.isArray(sc.shots)) {
      for (const shot of sc.shots) {
        const pairs: Array<[keyof typeof shot, string, RefMediaKind]> = [
          ['keyframeMediaRef', 'keyframe', 'image'],
          ['startFrameMediaRef', 'startFrame', 'image'],
          ['endFrameMediaRef', 'endFrame', 'image'],
          ['videoMediaRef', 'video', 'video'],
        ]
        for (const [field, tag, media] of pairs) {
          const cur = shot[field] as string | undefined
          if (!refLooksPackable(cur)) continue
          cells.push({
            get: () => shot[field] as string,
            set: (v) => {
              (shot as unknown as Record<string, unknown>)[field as string] = v
            },
            label: `scene/${sid}/shot/${shot.id}/${tag}`,
            media,
          })
        }
      }
    }
  }

  return cells
}
