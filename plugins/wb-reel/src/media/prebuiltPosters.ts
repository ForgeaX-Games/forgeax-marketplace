/**
 * prebuiltPosters —— 风格 / UI 预设的「预制海报」静态资源解析。
 *
 * 设计意图（2026-06 数据持久化重构）：
 *   风格 / UI 的海报样张过去靠 API **每个浏览器各自首次进界面时实时生成**，
 *   表现为「图基本是空的 / 各端不一致 / 清缓存就没了」。现在改为：
 *     一次性生成 → 落盘成静态文件 `src/assets/posters/*.webp` 随插件入仓分发，
 *     所有人打开即有、完全一致、不再运行时调 API。
 *
 *   生成脚本见 `scripts/gen-posters.mjs`（读 key/llm_key.json，调 Azure gpt-image-2，
 *   把每个预设 id 写成 `style-<id>.webp` / `ui-<id>.webp`）。
 *
 * 解析机制：
 *   Vite 的 `import.meta.glob(..., { eager: true })` 在构建期把目录下所有图片
 *   静态导入成「带 hash 的最终 URL」字符串（dev 直接给源路径），运行时零成本。
 *   缺图（脚本还没跑 / 该 id 没生成）→ 返回 undefined，调用方回落到实时生成 + swatch。
 */

// `eager + import` → 每个匹配文件被静态导入，value 是其最终 URL 字符串。
// 收 jpg/webp/png；体积优先 jpg/webp（脚本默认产 1080px 长边 JPEG，~200KB/张），
// png 仅兜底（早期未压缩产物）。
const modules = import.meta.glob<string>('../assets/posters/*.{jpg,jpeg,webp,png}', {
  eager: true,
  import: 'default',
  query: '?url',
})

// 文件名（去扩展名）→ URL。例如 '../assets/posters/style-anime.jpg' → 'style-anime'。
const byBaseName: Record<string, string> = {}
for (const [path, url] of Object.entries(modules)) {
  const file = path.split('/').pop() ?? ''
  const base = file.replace(/\.(jpg|jpeg|webp|png)$/i, '')
  // 压缩格式优先：已有 jpg/webp 时不让 png 覆盖。
  const isCompressed = /\.(jpg|jpeg|webp)$/i.test(file)
  if (!byBaseName[base] || isCompressed) {
    byBaseName[base] = url as unknown as string
  }
}

/** 取某视觉风格的预制海报 URL（竖版 2:3）；没有返回 undefined。 */
export function prebuiltStylePoster(styleId: string): string | undefined {
  return byBaseName[`style-${styleId}`]
}

/** 取某 UI 风格的预制海报 URL（横版 16:9）；没有返回 undefined。 */
export function prebuiltUIPoster(uiId: string): string | undefined {
  return byBaseName[`ui-${uiId}`]
}

/** 取某导演流派的预制海报 URL（竖版 2:3）；没有返回 undefined。 */
export function prebuiltDirectorPoster(directorId: string): string | undefined {
  return byBaseName[`director-${directorId}`]
}
