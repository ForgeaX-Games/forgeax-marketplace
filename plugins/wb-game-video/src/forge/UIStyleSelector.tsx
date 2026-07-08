import { useEffect, useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { UI_STYLE_PRESETS, getUIStylePreset } from '../llm/uiStylePresets'
import { PosterCarousel, type PosterItem } from './PosterCarousel'
import { ensureStylePoster } from '../media/stylePosterCache'
import { prebuiltUIPoster } from '../media/prebuiltPosters'
import { createImageProvider } from '../llm/GptImageProvider'
import { UIStylePanel } from '../editor/UIStylePanel'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * UIStyleSelector —— Forge「UI」分区的游戏化 UI 风格选择器（海报 cover-flow）。
 *
 * 交互：
 *   - 每个 UI 风格一张竖版海报样张（API 实时生成 + 三层缓存），中间大图、左右切换。
 *   - 浏览（居中项）只更新本地 viewingId，不动 scenario；
 *     点中间「选用此 UI」才真正写入 scenario.uiStyle.prompt（取 preset.promptText）。
 *   - 海报懒生成：只对当前居中项触发 ensureStylePoster，避免一次打爆生图 API。
 *   - 底部「自定义」可折叠区，展开后复用现有 <UIStylePanel/> 手填覆盖 prompt。
 *
 * 优雅降级：
 *   - 生图失败 / 无 key / SSR：ensureStylePoster 返回 null，posterUrl 缺失，
 *     PosterCarousel 自动用 swatch 渐变 + label 大字占位，绝不 crash / 白屏。
 *
 * 作用面：
 *   选中后写入 scenario.uiStyle.prompt，作为后续视频里游戏化 UI 元素
 *   （按钮 / 字幕条 / HUD）的视觉基准。
 */
export function UIStyleSelector() {
  const currentPrompt = useScenarioStore((s) => s.scenario.uiStyle?.prompt ?? '')
  const setUIStyle = useScenarioStore((s) => s.setUIStyle)

  // 「正在看的居中项」—— 与 scenario.uiStyle 解耦：浏览不落库。
  // 初始：若当前 prompt 恰好等于某 preset.promptText 则取该 id，否则取第一个 preset。
  const [viewingId, setViewingId] = useState<string>(() => {
    const matched = UI_STYLE_PRESETS.find((p) => p.promptText === currentPrompt)
    return matched?.id ?? UI_STYLE_PRESETS[0]?.id ?? ''
  })
  // 已生成的海报（预制优先）：先用入仓静态预制图填满，缺图 id 才实时生成兜底。
  const [posters, setPosters] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const p of UI_STYLE_PRESETS) {
      const url = prebuiltUIPoster(p.id)
      if (url) seed[p.id] = url
    }
    return seed
  })
  // 自定义子面板折叠态（默认折叠）
  const [showCustom, setShowCustom] = useState(false)

  const client = useMemo(() => createImageProvider(), [])

  // 居中项海报：预制图已 seed；只有缺预制图的 id 才实时生成兜底。
  useEffect(() => {
    let cancelled = false
    const id = viewingId
    if (!id || posters[id]) return
    const preset = getUIStylePreset(id)
    if (!preset) return
    void (async () => {
      try {
        const url = await ensureStylePoster(
          `uistyle:${id}:16x9`,
          preset.posterPrompt,
          client,
          '1536x1024',
        )
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
      UI_STYLE_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        tagline: p.tagline,
        swatch: p.swatch,
        posterUrl: posters[p.id],
      })),
    [posters],
  )

  return (
    <section className="ks-uistyle-sel" aria-label="游戏化 UI 风格">
      <PosterCarousel
        items={items}
        orientation="landscape"
        title="GAME UI STYLE"
        subtitle="游戏化 UI 风格 · 按钮 / 字幕条 / HUD 的视觉规范"
        activeId={viewingId}
        anchorEnabled={currentPrompt.trim() !== ''}
        onActiveChange={(id) => setViewingId(id)}
        onPrimary={(id) => {
          const preset = getUIStylePreset(id)
          if (!preset) return
          // 再次点击当前已选风格 → 取消选中（清空锚点）；否则选用
          if (preset.promptText === currentPrompt && currentPrompt.trim() !== '') {
            setUIStyle({ prompt: '' })
          } else {
            setUIStyle({ prompt: preset.promptText })
          }
        }}
        primaryLabel={(item) => {
          const preset = getUIStylePreset(item.id)
          return preset && preset.promptText === currentPrompt && currentPrompt.trim() !== ''
            ? '当前 UI ✓ · 点击取消'
            : '选用此 UI'
        }}
        footer={
          <div className="ks-uistyle-sel-custom">
            <button
              type="button"
              className="ks-uistyle-sel-custom-toggle ks-mono"
              aria-expanded={showCustom}
              onClick={() => setShowCustom((v) => !v)}
            >
              {showCustom ? '▾' : '▸'} ✎ 自定义 UI 提示词
            </button>
            {showCustom && (
              <div className="ks-uistyle-sel-custom-body">
                <UIStylePanel />
              </div>
            )}
          </div>
        }
      />
    </section>
  )
}

const css = `
.ks-uistyle-sel {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1 0 auto;
  min-height: 0;
}
.ks-uistyle-sel-custom {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ks-uistyle-sel-custom-toggle {
  align-self: flex-start;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--ks-font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--ks-text-dim);
  transition: color 160ms ease;
}
.ks-uistyle-sel-custom-toggle:hover {
  color: var(--ks-amber);
}
.ks-uistyle-sel-custom-body {
  padding-top: 4px;
}
`
injectStyleOnce('ui-style-selector', css)
