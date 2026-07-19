import type { Scenario } from '../scenario/types'

export interface AssetRef {
  /** mediaStore 里的 id */
  mediaId: string
  /** 该素材归属的 scene id（跨场景去重后的"首次出现"scene） */
  sceneId: string
}

export interface ScenarioAssets {
  images: AssetRef[]
  videos: AssetRef[]
}

/**
 * collectScenarioAssets —— 把一整本 scenario 的所有 scene.sceneImages /
 * scene.sceneVideos 平铺成"全剧本素材库"数据。
 *
 * 作者需求（v3.9.4）：
 *   "我在这个剧本中生成的、上传的图像和视频历史，要在当前的素材库中能看到。"
 *
 * 排序：按 scene.pos.y 升序（剧情树里从上往下的视觉顺序 ≈ 作者创作顺序），
 * 缺省 pos.y 则回退到 scene.id 字典序。场景内部保留 sceneImages / sceneVideos
 * 的数组原有顺序（作者自己调整过的先后）。
 *
 * 去重：mediaStore 里的实体是单源，素材库是"引用视图"。同一个 mediaId 被
 * 多个 scene 引用时，只输出一次，归属到遍历顺序里第一个撞到的 scene。
 */
export function collectScenarioAssets(scenario: Scenario): ScenarioAssets {
  const entries = Object.values(scenario.scenes ?? {})
  const sorted = entries.slice().sort((a, b) => {
    const ay = a.pos?.y ?? Number.POSITIVE_INFINITY
    const by = b.pos?.y ?? Number.POSITIVE_INFINITY
    if (ay !== by) return ay - by
    return a.id.localeCompare(b.id)
  })

  const images: AssetRef[] = []
  const videos: AssetRef[] = []
  const seenImg = new Set<string>()
  const seenVid = new Set<string>()

  for (const scene of sorted) {
    for (const mediaId of scene.sceneImages ?? []) {
      if (seenImg.has(mediaId)) continue
      seenImg.add(mediaId)
      images.push({ mediaId, sceneId: scene.id })
    }
    for (const mediaId of scene.sceneVideos ?? []) {
      if (seenVid.has(mediaId)) continue
      seenVid.add(mediaId)
      videos.push({ mediaId, sceneId: scene.id })
    }
  }
  return { images, videos }
}
