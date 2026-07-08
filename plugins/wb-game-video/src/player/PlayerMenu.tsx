import { useEffect, useState } from 'react'
import { BranchTreeOverlay } from './BranchTreeOverlay'
import { useCinemaHold } from './cinemaGate'
import { injectStyleOnce } from '../styles/injectStyle'

interface Props {
  scenarioTitle: string
  currentSceneTitle: string
  currentSceneId: string
  visitedSceneIds: string[]
  onJumpScene: (sceneId: string) => void
  onHome: () => void
  onReplayScene: () => void
  onRestart: () => void
  onExit: () => void
  /** 字幕（DialogueBox）可见性；与时间轴 DIA 轨开关同步的 pref */
  subtitlesVisible: boolean
  onToggleSubtitles: () => void
}

/**
 * PlayerMenu —— 玩家模式右上角呼出菜单
 *
 * 位置固定在**右上角**（top:18px / right:18px），与左上角的 EXIT 按钮形成对角平衡
 * —— 这是 App.tsx 里的 .ks-playing-exit 的镜像位置。
 *
 * 2026-04 变更：去掉了 useDockable 的"可拖拽贴边停靠"行为。
 *   为什么：作者（原话）"这个作为固定的放在 exit 的对角，也就是右上角，平行 exit"。
 *   FAB 漂移到任意位置对试玩者反而是噪声（找不到、怕碰错），固定锚点 + 与 EXIT
 *   形成可预测的对称关系是更清晰的视觉心智模型。拖拽 + localStorage 的代码被
 *   dockable.ts 保留，但 PlayerMenu 不再消费，以免其他地方有重用需求被连根拔掉。
 *
 * Panel 行为不变：点击 FAB 开合，ESC 关闭，剧情树入口进 BranchTreeOverlay。
 */
export function PlayerMenu({
  scenarioTitle,
  currentSceneTitle,
  currentSceneId,
  visitedSceneIds,
  onJumpScene,
  onHome,
  onReplayScene,
  onRestart,
  onExit,
  subtitlesVisible,
  onToggleSubtitles,
}: Props) {
  const [open, setOpen] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)

  // 菜单或剧情树打开期间：阻止电影模式（玩家在看菜单，不是在"观影"）
  useCinemaHold(open || treeOpen)

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (treeOpen) setTreeOpen(false)
        else if (open) setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, treeOpen])

  return (
    <>
      <button
        type="button"
        className={`ks-fab ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? '关闭菜单' : '打开菜单'}
        title="菜单"
      >
        <span className="ks-fab-icon">
          {open ? <CloseGlyph /> : <GearGlyph />}
        </span>
      </button>

      {open && !treeOpen && (
        <>
          <div
            className="ks-pm-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside
            className="ks-pm-panel"
            role="dialog"
            aria-label="影游菜单"
          >
            <header className="ks-pm-head">
              <span className="ks-pm-mark" />
              <div className="ks-pm-head-text">
                <div className="ks-pm-title ks-cn">{scenarioTitle}</div>
                <div className="ks-pm-sub ks-mono">
                  CURRENT · {currentSceneTitle}
                </div>
              </div>
            </header>

            <SettingSection>
              <SettingRow
                glyph={<TreeGlyph />}
                label="剧情结构"
                hint="STORY TREE"
                trailing={<Chevron />}
                onClick={() => setTreeOpen(true)}
              />
              <SettingRow
                glyph={<SubtitleGlyph />}
                label={subtitlesVisible ? '隐藏字幕' : '显示字幕'}
                hint={subtitlesVisible ? 'SUBTITLES ON' : 'SUBTITLES OFF'}
                trailing={
                  <span
                    className={`ks-pm-toggle ${subtitlesVisible ? 'is-on' : ''}`}
                    aria-hidden
                  />
                }
                onClick={onToggleSubtitles}
              />
            </SettingSection>

            <SettingSection>
              <SettingRow
                glyph={<ReplayGlyph />}
                label="重播本场"
                hint="REPLAY SCENE"
                onClick={() => {
                  setOpen(false)
                  onReplayScene()
                }}
              />
              <SettingRow
                glyph={<RestartGlyph />}
                label="回到起点"
                hint="RESTART"
                onClick={() => {
                  setOpen(false)
                  onRestart()
                }}
              />
              <SettingRow
                glyph={<HomeGlyph />}
                label="返回主页"
                hint="HOME"
                onClick={() => {
                  setOpen(false)
                  onHome()
                }}
              />
            </SettingSection>

            <SettingSection>
              <SettingRow
                glyph={<ExitGlyph />}
                label="退出试玩"
                hint="EXIT"
                tone="danger"
                onClick={() => {
                  setOpen(false)
                  onExit()
                }}
              />
            </SettingSection>

            <footer className="ks-pm-foot ks-faint ks-mono">
              ESC 关闭 · 右上角齿轮呼出
            </footer>
          </aside>
        </>
      )}

      {treeOpen && (
        <BranchTreeOverlay
          scenarioTitle={scenarioTitle}
          currentSceneId={currentSceneId}
          visitedSceneIds={visitedSceneIds}
          onJump={(id) => {
            setTreeOpen(false)
            setOpen(false)
            onJumpScene(id)
          }}
          onClose={() => setTreeOpen(false)}
        />
      )}
    </>
  )
}

interface SettingRowProps {
  glyph: React.ReactNode
  label: string
  hint?: string
  trailing?: React.ReactNode
  tone?: 'default' | 'danger'
  onClick?: () => void
}

function SettingRow({
  glyph,
  label,
  hint,
  trailing,
  tone = 'default',
  onClick,
}: SettingRowProps) {
  return (
    <button
      type="button"
      className={`ks-pm-row tone-${tone}`}
      onClick={onClick}
    >
      <span className="ks-pm-row-glyph">{glyph}</span>
      <span className="ks-pm-row-label ks-cn">{label}</span>
      {hint ? <span className="ks-pm-row-hint ks-mono">{hint}</span> : null}
      {trailing ? <span className="ks-pm-row-trailing">{trailing}</span> : null}
    </button>
  )
}

function SettingSection({ children }: { children: React.ReactNode }) {
  return <section className="ks-pm-section">{children}</section>
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 6 L15 12 L9 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ── 简单 SVG 字符 —— 不依赖任何图标包 ──────────────────── */

function GearGlyph() {
  // 故意做成"小太阳"：中心一颗实心圆盘 + 八根对称光芒。
  // 既是"设置"的隐喻（旋转对称），也呼应作者口中的"小太阳"视觉。
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3.6" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="12" y1="2.4" x2="12" y2="5.2" />
        <line x1="12" y1="18.8" x2="12" y2="21.6" />
        <line x1="2.4" y1="12" x2="5.2" y2="12" />
        <line x1="18.8" y1="12" x2="21.6" y2="12" />
        <line x1="5.2" y1="5.2" x2="7.2" y2="7.2" />
        <line x1="16.8" y1="16.8" x2="18.8" y2="18.8" />
        <line x1="5.2" y1="18.8" x2="7.2" y2="16.8" />
        <line x1="16.8" y1="7.2" x2="18.8" y2="5.2" />
      </g>
    </svg>
  )
}
function CloseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 6 L18 18 M6 18 L18 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
function TreeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 5 V19" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 9 H14" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 14 H12" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="5" r="1.6" fill="currentColor" />
      <circle cx="14" cy="9" r="1.4" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="14" r="1.4" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="6" cy="19" r="1.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
function SubtitleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="6"
        width="18"
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M6 12 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13 12 H18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 15.5 H15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function HomeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 11 L12 4 L20 11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6 11 V19 H18 V11" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 19 V14 H14 V19" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
function ReplayGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12 a7 7 0 1 0 2.5 -5.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M5 4 V8 H9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function RestartGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 19 V5 L17 12 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function ExitGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M14 4 H6 a2 2 0 0 0 -2 2 V18 a2 2 0 0 0 2 2 H14"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M11 12 H21 M17 8 L21 12 L17 16"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const pmCss = `
/* ── FAB · 固定右上角，与左上角 EXIT 按钮形成对角平衡 ────────
 * 视觉上刻意对齐 App.tsx 里 .ks-playing-exit：
 *   - 都是 top:18px，位于视口最外层安全区
 *   - 都是胶囊 / 半透明玻璃 / 同款阴影，只是 FAB 是正圆
 *   - 都用 backdrop-filter 蒙上底，试玩场景暗/亮切换都可读
 * EXIT 在左上、FAB 在右上 —— 观众一眼能分辨"出口" vs "选项"。
 */
.ks-fab {
  position: fixed;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(18, 18, 22, 0.48);
  color: rgba(255, 255, 255, 0.88);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 10px 28px rgba(0, 0, 0, 0.45);
  opacity: 0;
  animation: ks-fab-in 320ms var(--ks-ease) 200ms forwards;
  transition:
    background var(--ks-dur-fast) var(--ks-ease),
    color var(--ks-dur-fast) var(--ks-ease),
    transform var(--ks-dur-fast) var(--ks-ease),
    border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-fab:hover,
.ks-fab:focus-visible {
  background: rgba(255, 123, 61, 0.92);
  color: #fff;
  border-color: rgba(255, 123, 61, 0.9);
  transform: rotate(30deg);
  outline: none;
}
.ks-fab.is-open {
  background: rgba(255, 123, 61, 0.92);
  color: #fff;
  border-color: rgba(255, 123, 61, 0.9);
  transform: rotate(90deg);
}
.ks-fab-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
@keyframes ks-fab-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Backdrop ──────────────────────────────────────────── */
.ks-pm-backdrop {
  position: fixed; inset: 0;
  background: rgba(2, 4, 8, 0.42);
  backdrop-filter: blur(6px) saturate(110%);
  -webkit-backdrop-filter: blur(6px) saturate(110%);
  z-index: 1490;
  animation: ks-pm-fade 220ms ease-out;
}

/* ── Panel · 右侧抽屉，从 FAB 下方长出 ───────────────────
 * top 刻意留出 FAB 的 40px + 18(边距) + 10(气口)，让抽屉和 FAB 形成视觉挂钩。
 * z-index 比 FAB 低 1，这样 FAB 的"×"符号始终在抽屉之上（方便关闭）。
 */
.ks-pm-panel {
  position: fixed;
  top: 72px;
  right: 18px;
  bottom: 18px;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 14px 12px;
  background: rgba(14, 16, 22, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow:
    0 32px 72px rgba(0, 0, 0, 0.65),
    inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(18px) saturate(120%);
  -webkit-backdrop-filter: blur(18px) saturate(120%);
  z-index: 1499;
  overflow: auto;
  color: rgba(255, 255, 255, 0.92);
  animation: ks-pm-slide-right 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes ks-pm-slide-right {
  from { opacity: 0; transform: translate(8px, -4px); }
  to   { opacity: 1; transform: translate(0, 0); }
}
@keyframes ks-pm-fade { from { opacity: 0; } to { opacity: 1; } }

/* Head —— 紧凑标题块 */
.ks-pm-head {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.ks-pm-mark {
  width: 7px; height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.86);
}
.ks-pm-head-text {
  display: flex; flex-direction: column; min-width: 0; gap: 3px;
}
.ks-pm-title { font-size: 14px; font-weight: 500; }
.ks-pm-sub {
  font-size: 9px;
  letter-spacing: 0.28em;
  color: rgba(255, 255, 255, 0.42);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Section · 一组连续行（中间无分隔，外层有 border） */
.ks-pm-section {
  display: flex; flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
}
.ks-pm-section + .ks-pm-section { margin-top: 0; }

/* Row · 每行 48px，icon + label + (hint) + trailing */
.ks-pm-row {
  all: unset;
  cursor: pointer;
  display: grid;
  grid-template-columns: 28px 1fr auto auto;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 14px;
  color: rgba(255, 255, 255, 0.86);
  transition: background 140ms ease, color 140ms ease;
}
.ks-pm-row + .ks-pm-row {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.ks-pm-row:hover, .ks-pm-row:focus-visible {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  outline: none;
}
.ks-pm-row.tone-danger { color: rgba(251, 113, 133, 0.86); }
.ks-pm-row.tone-danger:hover, .ks-pm-row.tone-danger:focus-visible {
  background: rgba(251, 113, 133, 0.08);
  color: var(--ks-rose);
}
.ks-pm-row-glyph {
  display: flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, 0.7);
}
.ks-pm-row.tone-danger .ks-pm-row-glyph { color: inherit; }
.ks-pm-row-label {
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-pm-row-hint {
  font-size: 8.5px;
  letter-spacing: 0.24em;
  color: rgba(255, 255, 255, 0.32);
  white-space: nowrap;
}
.ks-pm-row-trailing {
  display: flex; align-items: center;
  color: rgba(255, 255, 255, 0.42);
}

/* 开关指示器 —— 圆角胶囊 + 小圆点（类似 iOS switch，但极简）。
   不做 click target（整行 row 本身是点击区），只做视觉状态。 */
.ks-pm-toggle {
  position: relative;
  display: inline-block;
  width: 26px;
  height: 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.22);
  transition:
    background var(--ks-dur-fast) var(--ks-ease),
    border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-pm-toggle::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.78);
  transition: transform var(--ks-dur-fast) var(--ks-ease);
}
.ks-pm-toggle.is-on {
  background: rgba(255, 123, 61, 0.7);
  border-color: var(--ks-amber);
}
.ks-pm-toggle.is-on::after {
  transform: translateX(12px);
  background: #fff;
}

.ks-pm-foot {
  margin-top: auto;
  padding: 8px 10px 2px;
  font-size: 9px;
  letter-spacing: 0.22em;
  color: rgba(255, 255, 255, 0.32);
  text-align: center;
}
`
injectStyleOnce('player-menu', pmCss)
