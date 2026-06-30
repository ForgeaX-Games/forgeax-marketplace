import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useScenarioStore } from '../scenario/scenarioStore'
import { MINIGAMES, getMinigame } from '../minigames/registry'
import { PosterCarousel, type PosterItem } from './PosterCarousel'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * MinigamePoolSelector —— 「视觉」视图「小游戏库」分区的池选择器。
 *
 * 用 PosterCarousel 多选模式把 registry 里的小游戏排成 cover-flow，
 * 用户多选入池；选中的写进 scenario.enabledMinigameIds，后续剧情树剪辑
 * 节点时只从池中挑选。小游戏没有海报生成提示词，故 posterUrl 留空，
 * 用 swatch 渐变占位并居中显示标题大字。
 *
 * 「打通」运行时（2026-06 作者反馈"小游戏库没打通"）：
 *   - 底部「▶ 试玩」按钮：对当前居中游戏，直接用真实 iframe（dev 由
 *     reelMinigamesPlugin 把 `/__minigames/<id>/...` serve 出来）拉起试玩弹层，
 *     作者可当场确认这个库条目是真能跑的游戏，而非只是个色块占位。
 *   - 入池（onPrimary toggle）与试玩（footer 按钮）是两件事：入池决定它进不进
 *     剧情树可选池，试玩只为预览验证。
 */

// 固定调色板：按 index 取一对色做占位渐变，保证每个小游戏底色稳定可辨。
const SWATCHES: Array<[string, string]> = [
  ['#6c8cff', '#3a4bd8'],
  ['#ff8c6c', '#d83a5a'],
  ['#6cffb0', '#1f9e6e'],
  ['#ffd86c', '#d89a1f'],
  ['#c06cff', '#7a1fd8'],
  ['#6cd8ff', '#1f7ad8'],
]

export function MinigamePoolSelector(): JSX.Element {
  const enabledIds = useScenarioStore((s) => s.scenario.enabledMinigameIds) ?? []
  const toggleEnabledMinigame = useScenarioStore((s) => s.toggleEnabledMinigame)

  const [viewingId, setViewingId] = useState<string>(MINIGAMES[0]?.id ?? '')
  // 试玩弹层：null = 关闭；否则为正在试玩的 minigameId
  const [playingId, setPlayingId] = useState<string | null>(null)

  const items: PosterItem[] = MINIGAMES.map((m, i) => ({
    id: m.id,
    label: m.title,
    tagline: m.blurb || m.tag || '',
    swatch: SWATCHES[i % SWATCHES.length] ?? ['#6c8cff', '#3a4bd8'],
    selected: enabledIds.includes(m.id),
  }))

  const selectedCount = enabledIds.filter((id) => MINIGAMES.some((m) => m.id === id)).length
  const viewingGame = getMinigame(viewingId)

  return (
    <div className="ks-minigame-pool">
      <PosterCarousel
        items={items}
        multiSelect
        title="MINIGAME POOL"
        subtitle="预选小游戏 · 剧情树剪辑节点时可从池中挑选"
        activeId={viewingId}
        onActiveChange={setViewingId}
        onPrimary={(id) => toggleEnabledMinigame(id)}
        primaryLabel={(item) =>
          item.selected ? '已入池 ✓ (点击移除)' : '加入小游戏池'
        }
        footer={
          <div className="ks-minigame-pool-footer">
            <button
              type="button"
              className="ks-minigame-play-btn"
              disabled={!viewingGame}
              onClick={() => viewingGame && setPlayingId(viewingGame.id)}
              title={viewingGame ? `试玩「${viewingGame.title}」验证运行时` : '无可试玩游戏'}
            >
              ▶ 试玩{viewingGame ? `「${viewingGame.title}」` : ''}
            </button>
            <span className="ks-minigame-pool-count ks-faint">
              已入池 {selectedCount} 个
            </span>
          </div>
        }
      />
      {playingId && (
        <MinigamePreviewModal
          minigameId={playingId}
          onClose={() => setPlayingId(null)}
        />
      )}
    </div>
  )
}

/**
 * MinigamePreviewModal —— 库内试玩弹层。
 *
 * 与 player/MinigameOverlay 的区别：那个是"真·游戏卡推进剧情"（绑 MinigameClip +
 * win/lose 回调）；这里只是库里的"预览试玩"，不接剧情分支，仅 iframe + 重开/关闭，
 * 用来当场验证某个库条目是不是真能跑起来。
 */
function MinigamePreviewModal({
  minigameId,
  onClose,
}: {
  minigameId: string
  onClose: () => void
}): JSX.Element {
  const desc = getMinigame(minigameId)
  const [ready, setReady] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Esc 关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 监听小游戏 ready 信号（去掉 loading 遮罩）。弹层一次只挂一个 iframe，
  // 故不强校验 id（个别游戏上报 id 可能与注册表不一致），只认 source 即可。
  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      const data = e.data as { source?: string; type?: string } | null
      if (!data || data.source !== 'reel-minigame') return
      if (data.type === 'minigame-ready') setReady(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // 兜底：个别游戏不发 ready 信号时，2.5s 后也收起 loading，避免遮挡能玩的游戏
  useEffect(() => {
    setReady(false)
    const t = setTimeout(() => setReady(true), 2500)
    return () => clearTimeout(t)
  }, [reloadTick])

  return createPortal(
    <div className="ks-mgp-overlay" role="dialog" aria-label={desc?.title ?? '小游戏试玩'}>
      <div className="ks-mgp-bar">
        <span className="ks-mgp-title">
          ▶ 试玩 · {desc?.title ?? minigameId}
          <span className="ks-mgp-tag ks-mono">预览模式 · 不影响剧情</span>
        </span>
        <span className="ks-mgp-spacer" />
        <button
          type="button"
          className="ks-mgp-btn"
          onClick={() => {
            setReady(false)
            setReloadTick((n) => n + 1)
          }}
          title="重新开始"
        >
          ↻ 重开
        </button>
        <button type="button" className="ks-mgp-btn" onClick={onClose} title="关闭试玩 (Esc)">
          × 关闭
        </button>
      </div>
      <div className="ks-mgp-frame-wrap">
        {desc ? (
          <>
            {!ready && (
              <div className="ks-mgp-loading">
                <div className="ks-mgp-spinner" aria-hidden />
                <div>{desc.title} · 加载中…</div>
              </div>
            )}
            <iframe
              key={reloadTick}
              src={desc.src}
              className="ks-mgp-iframe"
              title={desc.title}
              allow="fullscreen; autoplay"
            />
          </>
        ) : (
          <div className="ks-mgp-missing">
            小游戏未注册：<span className="ks-mono">{minigameId}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

injectStyleOnce(
  'minigame-pool-selector',
  `
.ks-minigame-pool {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1 0 auto;
  min-height: 0;
}
.ks-minigame-pool-footer {
  display: flex;
  align-items: center;
  gap: 14px;
}
.ks-minigame-play-btn {
  padding: 7px 16px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--ks-amber, #ff7b3d) 50%, transparent);
  background: color-mix(in srgb, var(--ks-amber, #ff7b3d) 12%, transparent);
  color: var(--ks-amber, #ff7b3d);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 160ms ease, transform 160ms ease;
  white-space: nowrap;
}
.ks-minigame-play-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ks-amber, #ff7b3d) 22%, transparent);
  transform: translateY(-1px);
}
.ks-minigame-play-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ks-minigame-pool-count {
  font-size: 12px;
  letter-spacing: 0.04em;
}

/* ── 试玩弹层 ── */
.ks-mgp-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(5, 4, 10, 0.94);
  display: flex;
  flex-direction: column;
}
.ks-mgp-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: rgba(16, 12, 18, 0.9);
  border-bottom: 1px solid color-mix(in srgb, var(--ks-amber, #ff7b3d) 30%, transparent);
}
.ks-mgp-title {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--ks-amber, #ffcf80);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.03em;
}
.ks-mgp-tag {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ks-text-dim, rgba(255, 255, 255, 0.55));
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
}
.ks-mgp-spacer { flex: 1; }
.ks-mgp-btn {
  border: 1px solid color-mix(in srgb, var(--ks-amber, #ff7b3d) 45%, transparent);
  background: rgba(32, 22, 16, 0.6);
  color: var(--ks-amber, #ffcf80);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: background 160ms ease, transform 160ms ease;
}
.ks-mgp-btn:hover {
  background: rgba(64, 40, 24, 0.8);
  transform: translateY(-1px);
}
.ks-mgp-frame-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0710;
}
.ks-mgp-iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #0a0710;
}
.ks-mgp-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #d4b0e8;
  font-size: 14px;
  letter-spacing: 0.1em;
  z-index: 1;
  pointer-events: none;
}
.ks-mgp-spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.12);
  border-top-color: var(--ks-amber, #ffcf80);
  animation: ks-mgp-spin 0.85s linear infinite;
}
@keyframes ks-mgp-spin {
  to { transform: rotate(360deg); }
}
.ks-mgp-missing {
  color: #ff9999;
  font-size: 14px;
}
`,
)
