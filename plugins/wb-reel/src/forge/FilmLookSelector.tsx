import { useEffect, useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import {
  FILM_LOOK_LIST,
  FILM_LOOK_PRESETS,
  type FilmLook,
} from '../llm/config/filmLookPresets'
import { ensureStylePoster } from '../media/stylePosterCache'
import { prebuiltFilmLookPoster } from '../media/prebuiltPosters'
import { createImageProvider } from '../llm/providers/GptImageProvider'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * FilmLookSelector —— Forge「风格」分区**下方**的电影美学调色「滤镜条」。
 *
 * 设计意图（与上方 VisualStyleSelector 的大轮播刻意区分）：
 *   - 上方：渲染媒介（写实 / 二次元 / 三渲二…）= "用什么画"，大海报 cover-flow。
 *   - 下方：电影美学调色（复古未来 / 蒂尔橙 / 莫兰迪…）= "整片什么色感"，
 *     横向滤镜缩略条，像相机滤镜一样一排小图铺开，一眼看全、随手叠加。
 *   两者正交叠加（例：写实 + 蒂尔橙），拼出更多组合。
 *
 * 交互：单选 + 可取消。点某格 → 写入 scenario.filmLook；再点当前格 → 取消（回落原色）。
 * 首格「原色」= 显式不加调色。智能体（style-curator）挑的 filmLook 也会高亮到这里，作者可改。
 *
 * 预览：每格一张 2:3 迷你滤镜样张，调 image2 生成（ensureStylePoster 三层缓存，
 * 命中后近乎零成本）；预制图优先 seed，缺图逐个懒生成；失败降级到 swatch 渐变占位。
 */
export function FilmLookSelector() {
  // raw：作者/智能体是否"显式"选过调色（undefined = 原色，不加调色）
  const raw = useScenarioStore((s) => s.scenario.filmLook) as FilmLook | undefined
  const setFilmLook = useScenarioStore((s) => s.setFilmLook)

  const [posters, setPosters] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const p of FILM_LOOK_LIST) {
      const url = prebuiltFilmLookPoster(p.id)
      if (url) seed[p.id] = url
    }
    return seed
  })

  const client = useMemo(() => createImageProvider(), [])

  // 逐个为缺图的 look 生成滤镜预览缩略（image2）。串行跑避免一次打爆生图 API；
  // ensureStylePoster 走三层缓存，二次进入近乎零成本。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const p of FILM_LOOK_LIST) {
        if (cancelled) return
        // 用函数式读取最新 posters 会更严谨，但 seed 已覆盖预制图，
        // 这里只需跳过一开始就有预制图的项即可（懒生成结果由 setPosters 落库）。
        if (prebuiltFilmLookPoster(p.id)) continue
        const preset = FILM_LOOK_PRESETS[p.id]
        if (!preset) continue
        try {
          const url = await ensureStylePoster(`flook:${p.id}`, preset.posterPrompt, client)
          if (!cancelled && url) {
            setPosters((prev) => (prev[p.id] ? prev : { ...prev, [p.id]: url }))
          }
        } catch {
          // 优雅降级：保持 swatch 占位
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client])

  return (
    <section className="ks-flook" aria-label="全局电影美学调色">
      <div className="fl-head">
        <span className="fl-kicker">FILM LOOK</span>
        <span className="fl-sub">
          电影美学调色 · 滤镜叠在上方画风之上，整片色彩统一（随昼夜 / 情绪自适应）
        </span>
        <span
          className={`fl-badge ${raw ? 'is-on' : ''}`}
          title={raw ? '已锁定电影美学调色（点当前格可取消）' : '尚未启用调色，保持画风本色'}
        >
          <span className="fl-badge-dot" aria-hidden />
          {raw ? '已启用' : '未启用'}
        </span>
      </div>

      <div className="fl-strip" role="listbox" aria-label="电影美学调色滤镜">
        <button
          type="button"
          role="option"
          aria-selected={raw == null}
          className={`fl-chip fl-chip-none ${raw == null ? 'is-selected' : ''}`}
          title="不加调色，保持画风本色"
          onClick={() => setFilmLook(undefined)}
        >
          <span className="fl-chip-none-mark" aria-hidden>
            ∅
          </span>
          <span className="fl-chip-label">原色</span>
        </button>

        {FILM_LOOK_LIST.map((p) => {
          const selected = raw === p.id
          const url = posters[p.id]
          const chipStyle: React.CSSProperties = url
            ? { backgroundImage: `url(${url})`, backgroundColor: p.swatch[0] }
            : { background: `linear-gradient(135deg, ${p.swatch[0]} 0%, ${p.swatch[1]} 100%)` }
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              key={p.id}
              className={`fl-chip ${selected ? 'is-selected' : ''}`}
              style={chipStyle}
              title={p.tagline}
              onClick={() => setFilmLook(selected ? undefined : (p.id as FilmLook))}
            >
              <span className="fl-chip-scrim" aria-hidden />
              {selected && (
                <span className="fl-chip-check" aria-hidden>
                  ✓
                </span>
              )}
              <span className="fl-chip-label">{p.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

const css = `
.ks-flook {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--ks-border-soft, rgba(255, 255, 255, 0.1));
  background: rgba(255, 255, 255, 0.02);
}
.fl-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.fl-kicker {
  font-family: var(--ks-font-mono, monospace);
  font-size: 10.5px;
  letter-spacing: 0.22em;
  color: var(--ks-amber, #d4f04a);
  font-weight: 600;
  white-space: nowrap;
}
.fl-sub {
  font-size: 12px;
  color: var(--ks-text-dim, rgba(255, 255, 255, 0.55));
  line-height: 1.4;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fl-badge {
  margin-left: auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  font-family: var(--ks-font-mono, monospace);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  padding: 3px 10px 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.18));
  color: var(--ks-text-dim, rgba(255, 255, 255, 0.55));
  background: rgba(255, 255, 255, 0.04);
}
.fl-badge.is-on {
  color: var(--ks-amber, #d4f04a);
  border-color: color-mix(in srgb, var(--ks-amber, #d4f04a) 50%, transparent);
  background: color-mix(in srgb, var(--ks-amber, #d4f04a) 12%, transparent);
}
.fl-badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.85;
}
.fl-strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 2px 8px;
  scrollbar-width: thin;
}
.fl-chip {
  position: relative;
  flex: 0 0 auto;
  width: 104px;
  height: 156px;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.14));
  background-size: cover;
  background-position: center;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}
.fl-chip:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--color-brand-primary, #6c8cff) 60%, transparent);
}
.fl-chip.is-selected {
  border-color: var(--color-brand-primary, #6c8cff);
  box-shadow:
    0 0 0 1px var(--color-brand-primary, #6c8cff),
    0 0 18px -4px var(--color-brand-primary, #6c8cff);
}
.fl-chip-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 40%, rgba(0, 0, 0, 0.8) 100%);
  pointer-events: none;
}
.fl-chip-label {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  text-align: left;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}
.fl-chip-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-brand-primary, #6c8cff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  z-index: 2;
}
.fl-chip-none {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--ks-text-dim, rgba(255, 255, 255, 0.6));
}
.fl-chip-none.is-selected {
  color: #fff;
}
.fl-chip-none-mark {
  font-size: 26px;
  line-height: 1;
  opacity: 0.7;
}
.fl-chip-none .fl-chip-label {
  position: static;
  text-align: center;
  text-shadow: none;
  color: inherit;
}
`
injectStyleOnce('film-look-selector', css)
