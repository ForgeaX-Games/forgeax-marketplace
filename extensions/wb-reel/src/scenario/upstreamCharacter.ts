// 跨工作台交接(走文件):把上游「角色设计 / 动画」工作台的产出作为参考素材
// 注入 reel 剧本,而不是让用户在 reel 里从零再生一遍角色三视图。
//
// 事实源是工程目录里的指针文件 .forgeax/games/<slug>/active-character.json
// (由 server /api/wb/character/active-character 读写,wb-character 生成角色后
// 写入)。这里在 App boot 时读它,拿到 charId → 读 manifest 的 portrait →
// fetch 成 dataUrl → 复用 reel 现成的 ingestDataUrl + upsertCharacter 注入成
// 一个预置角色。其它工作台(wb-anim/wb-skill)用的是同一套指针 + API。
//
// 幂等:角色 id 用确定性的 `upstream-<charId>`,split-pane 双 iframe / 重复
// boot 都只会覆盖同一条,不产生重复角色。

import { useMediaStore } from '../media/mediaStore'
import { useScenarioStore } from '../scenario/scenarioStore'

interface UpstreamManifest {
  charId?: string
  name?: string
  role?: string
  portrait?: Record<string, string>
}

/** 同源 asset URL → base64 data-URL(reel 的媒体管线需要 dataUrl)。 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * 启动时尝试把上游 active-character 注入为 reel 预置角色。
 * 无 slug / 无指针 / 无 portrait 时静默 no-op,绝不抛错(reel 仍可独立使用)。
 */
export async function bootUpstreamCharacter(): Promise<void> {
  const slug = new URLSearchParams(location.search).get('slug')
  if (!slug) return

  // 1) 读指针文件,确定要拉哪个 charId。
  let charId = ''
  try {
    const res = await fetch(
      `/api/wb/character/active-character?slug=${encodeURIComponent(slug)}`,
    )
    if (!res.ok) return
    const j = (await res.json()) as { charId?: string | null }
    if (!j.charId) return
    charId = j.charId
  } catch {
    return
  }

  // 幂等:已注入过同一上游角色就不重复拉图。
  const presetId = `upstream-${charId}`
  const existing = useScenarioStore.getState().scenario.characters?.[presetId]
  if (existing?.refImageId) return

  // 2) 读 manifest,拿 portrait.front 相对路径。
  let manifest: UpstreamManifest | undefined
  let urls: Record<string, string> | undefined
  try {
    const res = await fetch(
      `/api/wb/character/characters/${encodeURIComponent(charId)}?slug=${encodeURIComponent(slug)}`,
    )
    if (!res.ok) return
    const j = (await res.json()) as { manifest?: UpstreamManifest; urls?: Record<string, string> }
    manifest = j.manifest
    urls = j.urls
  } catch {
    return
  }
  if (!manifest) return

  const front = manifest.portrait?.front
  const portraitUrl =
    urls?.['portrait/front'] ??
    (front
      ? `/api/wb/character/asset?path=${encodeURIComponent(
          `.forgeax/games/${slug}/characters/${manifest.charId ?? charId}/${front}`,
        )}`
      : null)

  // 没有 portrait 也注入角色(只带名字/prompt),用户可后续补图。
  let refImageId: string | undefined
  if (portraitUrl) {
    const dataUrl = await fetchAsDataUrl(portraitUrl)
    if (dataUrl) {
      refImageId = useMediaStore.getState().ingestDataUrl(dataUrl, {
        name: `${manifest.name ?? charId}.png`,
      })
    }
  }

  useScenarioStore.getState().upsertCharacter({
    id: presetId,
    name: manifest.name ?? charId,
    prompt: '（来自角色设计工作台的上游设定图）',
    refImageId,
  })
}
