/**
 * graph 引擎自带资产层 —— 把 `assets/zhandou/*.mp4` 构建期静态导入成 `文件名(basename) → 直链`。
 *
 * 唯一约定：**所有初始数据统一在 `demo/nodia.graph.json` 里按 basename 引用**（如
 * `media.ref: "idle01"` / `"narr-door"`）；解析时按 basename 取本地直链。不再有 id 映射表 /
 * 远程回落 / 标签等额外配置——需要的都写进 demo。
 */
const zhandouModules = import.meta.glob<string>('../../assets/zhandou/*.mp4', {
  eager: true,
  import: 'default',
  query: '?url',
})

/** 文件名(去扩展名) → 本地 bundle 直链。如 'idle01' / 'narr-door'。 */
export const ZHANDOU_VIDEOS: Record<string, string> = {}
for (const [path, url] of Object.entries(zhandouModules)) {
  const id = (path.split('/').pop() ?? '').replace(/\.mp4$/, '')
  if (id) ZHANDOU_VIDEOS[id] = url as unknown as string
}

/** 按 basename 取本地视频直链；非本地(不在 zhandou/)返回 undefined。 */
export function zhandouUrl(id: string | undefined): string | undefined {
  return id ? ZHANDOU_VIDEOS[id] : undefined
}
