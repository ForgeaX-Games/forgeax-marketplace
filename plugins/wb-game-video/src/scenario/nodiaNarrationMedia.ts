/**
 * nodia 叙事旁白视频（narr-*）—— 项目内 bundle 数据源。
 *
 * 把 `assets/zhandou/narr-*.mp4` 经 Vite 静态导入成带 hash 的最终 URL，运行时
 * 灌进 mediaStore，供 `Scene.media.ref`（如 'narr-door'）直接解析。这样 nodia
 * 试玩的旁白视频与游戏同源、离线可播，不再依赖易丢的运行时 reel 库
 * （/__reel__/assets/...）。
 */
import { useMediaStore } from '../media/mediaStore'

// Vite 构建期把 zhandou/narr-*.mp4 静态导入成带 hash 的最终 URL（dev 直接给源路径），运行时零成本。
const narrationModules = import.meta.glob<string>('../assets/zhandou/narr-*.mp4', {
  eager: true,
  import: 'default',
  query: '?url',
})

/** 资产 id（= 文件名去扩展名，如 'narr-door'）→ 本地 bundle URL。 */
export const NODIA_NARRATION_VIDEOS: Record<string, string> = {}
for (const [path, url] of Object.entries(narrationModules)) {
  const file = path.split('/').pop() ?? ''
  const id = file.replace(/\.mp4$/, '')
  if (id) NODIA_NARRATION_VIDEOS[id] = url as unknown as string
}

/**
 * 把 nodia 旁白视频（narr-*）灌进 mediaStore，供 Scene.media.ref 解析（本地 bundle
 * 覆盖运行时 reel 直链）。
 *
 * 每个文件注册两个 key，覆盖两条引用来源：
 *   - `narr-door`   —— demo 蓝图 nodia.graph.json 直接用文件名做 media.ref。
 *   - `m-narr-door` —— 运行时场景（asset.meta.mediaId 规范加 `m-` 前缀）用它做 media.ref。
 */
export function primeNodiaNarrationMedia(): void {
  useMediaStore.setState((s) => {
    const entries = { ...s.entries }
    for (const [file, url] of Object.entries(NODIA_NARRATION_VIDEOS)) {
      for (const id of [file, `m-${file}`]) {
        entries[id] = {
          id,
          name: `${file}.mp4`,
          mimeType: 'video/mp4',
          size: 0,
          url,
          createdAt: entries[id]?.createdAt ?? 0,
          persistState: 'saved',
        }
      }
    }
    return { entries }
  })
}
