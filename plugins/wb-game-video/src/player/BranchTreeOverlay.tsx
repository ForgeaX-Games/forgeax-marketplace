import { useEffect } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { BranchTreeReadonly } from './BranchTreeReadonly'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * BranchTreeOverlay —— 全屏虚化式剧情树浮层（参考"完蛋我被美女包围了"）。
 *
 * 设计迭代说明：
 *   v1: 固定底部小图（缩在右下角，简陋）
 *   v2: 右侧 360px 常驻抽屉（可折叠，但画面空间不够，只读 xyflow 挤得慌）
 *   v3（当前）：**全屏虚化 Overlay**
 *     - 当前游戏画面隐约可见（backdrop-filter: blur + 半透明黑）
 *     - 剧情树占 90% 视野，每个节点是"场景缩略图卡片"
 *     - 已走分支琥珀高亮 + 流光；未走分支灰化 + 虚线
 *     - 当前场景节点有脉冲外发光
 *     - 点节点 = 跳转；ESC / 点空白 / × 关闭
 *
 * 为什么不再是抽屉：
 *   - 游戏中剧情树是"地图"性质，需要全局视野 + 路径感知
 *   - 抽屉 360px 宽容不下分支多的剧本，作者/玩家都用不顺
 *   - 虚化背景保留"我还在游戏里"的上下文，不是切到另一个页面
 *
 * 触发（不变）：PlayerMenu 里点"剧情结构"。
 */
interface Props {
  scenarioTitle: string
  currentSceneId: string
  visitedSceneIds: string[]
  onJump: (sceneId: string) => void
  onClose: () => void
}

export function BranchTreeOverlay({
  scenarioTitle,
  currentSceneId,
  visitedSceneIds,
  onJump,
  onClose,
}: Props) {
  const totalScenes = useScenarioStore((s) => Object.keys(s.scenario.scenes).length)
  // visited 里可能含当前场景，按玩家认知合并去重
  const visitedUnique = new Set([...visitedSceneIds, currentSceneId])
  const progress = `${visitedUnique.size}/${totalScenes}`

  // 打开时批量从磁盘预填缓存 —— 作者锻造阶段已生成的缩略图会直接显示，
  // 没生过的保持 NO PREVIEW（不主动发网络请求，避免 Player 消耗 token）
  useEffect(() => {
    const sceneIds = Object.keys(useScenarioStore.getState().scenario.scenes)
    const loader = useSceneImageCache.getState().loadFromDisk
    for (const id of sceneIds) {
      loader(id)
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 阻止滚动穿透 —— overlay 打开期间 body 不滚
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div
      className="ks-btov-scrim"
      onClick={onClose}
      role="dialog"
      aria-label="剧情树"
      aria-modal="true"
    >
      <div
        className="ks-btov-stage"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ks-btov-bar">
          <div className="ks-btov-titleblock">
            <div className="ks-btov-kicker ks-mono">STORY · TREE</div>
            <div className="ks-btov-title ks-cn">{scenarioTitle}</div>
          </div>
          <div className="ks-btov-progress ks-mono">
            <span className="ks-btov-progress-num">{progress}</span>
            <span className="ks-btov-progress-label">SCENES VISITED</span>
          </div>
          <button
            type="button"
            className="ks-btov-close"
            onClick={onClose}
            aria-label="关闭 (ESC)"
            title="关闭 (ESC)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6 L18 18 M6 18 L18 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="ks-btov-canvas">
          <BranchTreeReadonly
            currentSceneId={currentSceneId}
            visitedSceneIds={Array.from(visitedUnique)}
            onJump={(id) => {
              onJump(id)
              onClose()
            }}
          />
        </div>

        <footer className="ks-btov-legend ks-mono">
          <span className="ks-btov-legend-item">
            <span className="ks-btov-dot is-current" />
            当前场景
          </span>
          <span className="ks-btov-legend-item">
            <span className="ks-btov-dot is-visited" />
            已探索
          </span>
          <span className="ks-btov-legend-item">
            <span className="ks-btov-dot is-unvisited" />
            未抵达
          </span>
          <span className="ks-btov-legend-hint">
            点击场景可跳转 · ESC 返回游戏
          </span>
        </footer>
      </div>
    </div>
  )
}

const css = `
.ks-btov-scrim {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: radial-gradient(
    ellipse at center,
    rgba(4, 6, 10, 0.68),
    rgba(0, 0, 0, 0.9) 80%
  );
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  animation: ks-btov-fade-in 260ms var(--ks-ease);
}
@keyframes ks-btov-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.ks-btov-stage {
  position: relative;
  width: min(1400px, 96vw);
  height: min(90vh, 960px);
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 0;
  background: rgba(16, 18, 26, 0.78);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--ks-radius-xl);
  box-shadow:
    0 30px 100px rgba(0, 0, 0, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  overflow: hidden;
  animation: ks-btov-rise 300ms var(--ks-ease);
}
@keyframes ks-btov-rise {
  from { transform: translateY(14px) scale(0.97); opacity: 0; }
  to   { transform: translateY(0)    scale(1);    opacity: 1; }
}
.ks-btov-bar {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 24px;
  padding: 18px 26px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.ks-btov-titleblock {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ks-btov-kicker {
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.28em;
  color: #ffb686;
  text-transform: uppercase;
}
.ks-btov-title {
  font-family: var(--ks-font-display);
  font-size: 20px;
  font-weight: 600;
  color: #fff;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ks-btov-progress {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding: 8px 18px;
  border: 1px solid rgba(255, 179, 71, 0.35);
  border-radius: var(--ks-radius-pill);
  background: rgba(255, 179, 71, 0.08);
}
.ks-btov-progress-num {
  font-family: var(--ks-font-mono);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #ffcc9a;
}
.ks-btov-progress-label {
  font-family: var(--ks-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.22em;
  color: rgba(255, 179, 71, 0.7);
  text-transform: uppercase;
}
.ks-btov-close {
  all: unset;
  cursor: pointer;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-btov-close:hover,
.ks-btov-close:focus-visible {
  background: rgba(240, 119, 157, 0.18);
  border-color: rgba(240, 119, 157, 0.5);
  color: #fff;
  transform: rotate(90deg) scale(1.05);
  outline: none;
}
.ks-btov-canvas {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(255, 179, 71, 0.08), transparent 60%),
    radial-gradient(ellipse at 70% 80%, rgba(125, 211, 252, 0.06), transparent 60%),
    transparent;
}
.ks-btov-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 26px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-family: var(--ks-font-ui);
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.7);
  flex-wrap: wrap;
}
.ks-btov-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: var(--ks-radius-pill);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-weight: 500;
}
.ks-btov-legend-hint {
  margin-left: auto;
  font-family: var(--ks-font-mono);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.ks-btov-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.ks-btov-dot.is-current {
  background: #ffb347;
  box-shadow: 0 0 0 3px rgba(255, 179, 71, 0.25), 0 0 12px rgba(255, 179, 71, 0.75);
}
.ks-btov-dot.is-visited {
  background: rgba(255, 179, 71, 0.6);
}
.ks-btov-dot.is-unvisited {
  background: transparent;
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.4) inset;
}
@media (max-width: 720px) {
  .ks-btov-scrim { padding: 10px; }
  .ks-btov-stage { width: 100%; height: 100%; border-radius: var(--ks-radius-lg); }
  .ks-btov-bar { padding: 12px 14px; gap: 10px; }
  .ks-btov-title { font-size: 16px; }
  .ks-btov-legend-hint { display: none; }
}
`
injectStyleOnce('branch-tree-overlay', css)
