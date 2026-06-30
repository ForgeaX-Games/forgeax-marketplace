import { useEffect, useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import {
  VISUAL_STYLE_LIST,
  VISUAL_STYLE_PRESETS,
  DEFAULT_VISUAL_STYLE,
  type VisualStyle,
} from '../llm/visualStylePresets'
import { PosterCarousel, type PosterItem } from './PosterCarousel'
import { ensureStylePoster } from '../media/stylePosterCache'
import { prebuiltStylePoster } from '../media/prebuiltPosters'
import { createImageProvider } from '../llm/GptImageProvider'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * VisualStyleSelector —— Forge「风格」分区的全局美术风格选择器（电影海报 cover-flow）。
 *
 * 交互：
 *   - 每个视觉风格一张竖版电影海报样张（API 实时生成 + 三层缓存），中间大图、左右切换。
 *   - 浏览（居中项）只更新本地 viewingId，不动 scenario；
 *     点中间「选为此风格」才真正写入 scenario.visualStyle。
 *   - 海报懒生成：只对当前居中项触发 ensureStylePoster，避免一次打爆生图 API。
 *
 * 优雅降级：
 *   - 生图失败 / 无 key / SSR：ensureStylePoster 返回 null，posterUrl 缺失，
 *     PosterCarousel 自动用 swatch 渐变 + label 大字占位，绝不 crash / 白屏。
 *
 * 作用面：
 *   选中后写入 scenario.visualStyle，作为后续所有素材生成（场景图 / 立绘 / 关键帧 / 视频）
 *   的统一美术基准。改风格不追溯重绘已有图。
 */
export function VisualStyleSelector() {
  // raw：作者是否"显式"选过风格（undefined = 未启用，仅用默认值兜底生成）
  const raw = useScenarioStore((s) => s.scenario.visualStyle) as VisualStyle | undefined
  const current: VisualStyle = raw ?? DEFAULT_VISUAL_STYLE
  const setVisualStyle = useScenarioStore((s) => s.setVisualStyle)

  // 「正在看的居中项」—— 单选语义下与 scenario.visualStyle 解耦：浏览不落库。
  const [viewingId, setViewingId] = useState<VisualStyle>(current)
  // 海报来源（预制优先）：先用入仓的静态预制图把所有项填满（同步、零成本），
  // 缺图的 id 才在浏览到时回落到 ensureStylePoster 实时生成。
  const [posters, setPosters] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const p of VISUAL_STYLE_LIST) {
      const url = prebuiltStylePoster(p.id)
      if (url) seed[p.id] = url
    }
    return seed
  })

  const client = useMemo(() => createImageProvider(), [])

  // 居中项海报：预制图已 seed 进 posters；只有缺预制图的 id 才实时生成兜底。
  useEffect(() => {
    let cancelled = false
    const id = viewingId
    if (posters[id]) return
    const preset = VISUAL_STYLE_PRESETS[id]
    if (!preset) return
    void (async () => {
      try {
        const url = await ensureStylePoster(`vstyle:${id}`, preset.posterPrompt, client)
        if (!cancelled && url) {
          setPosters((prev) => (prev[id] ? prev : { ...prev, [id]: url }))
        }
      } catch {
        // 优雅降级：保持 swatch 占位
      }
    })()
    return () => {
      cancelled = true
    }
  }, [viewingId, posters, client])

  const items: PosterItem[] = useMemo(
    () =>
      VISUAL_STYLE_LIST.map((p) => ({
        id: p.id,
        label: p.label,
        tagline: p.tagline,
        swatch: p.swatch,
        posterUrl: posters[p.id],
      })),
    [posters],
  )

  return (
    <section className="ks-vstyle" aria-label="全局美术风格">
      <PosterCarousel
        items={items}
        title="VISUAL STYLE"
        subtitle="全局美术风格 · 影响后续生成的场景图 / 角色立绘 / 关键帧 / 视频"
        activeId={viewingId}
        anchorEnabled={raw != null}
        onActiveChange={(id) => setViewingId(id as VisualStyle)}
        onPrimary={(id) => {
          // 再次点击当前已选风格 → 取消（回落默认、标记未启用）；否则选为此风格
          if (raw === id) setVisualStyle(undefined)
          else setVisualStyle(id as VisualStyle)
        }}
        primaryLabel={(item) =>
          raw === item.id ? '当前风格 ✓ · 点击取消' : '选为此风格'
        }
      />
    </section>
  )
}

const css = `
.ks-vstyle {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1 0 auto;
  min-height: 0;
}
`
injectStyleOnce('visual-style-selector', css)
