import { injectStyleOnce } from '../styles/injectStyle'

/**
 * PlaybackControls —— 画面两侧快进/快退 + 底部暂停
 *
 * 位置：
 *   - 左中：-10s（后退 10 秒）
 *   - 右中：+10s（前进 10 秒）
 *   - 下中：暂停 / 继续
 *
 * 风格对齐 App.tsx 的 `.ks-playing-exit` 与 PlayerMenu 的 `.ks-fab`：
 *   - 同款半透明毛玻璃 + 细描边 + 深影
 *   - 比 EXIT / FAB 再小一号（34×34 圆 / 胶囊），以免在画面边缘喧宾夺主
 *   - 用 `.ks-pb-btn` 作为公共 class，App.tsx 里的 cinema 淡出规则已
 *     一并把它纳入，idle 时跟 EXIT / FAB 一起隐退
 *   - EXIT 在左上 / FAB 在右上 —— 左右中轴的位置刚好形成"左右对称次优先级"
 *
 * 交互：
 *   - 仅渲染"按钮层"，不负责时间轴真源。seek / pause 委托给上层 Player。
 *   - 点击不冒泡到画面，避免和 QTE/拖拽等交互冲突。
 */

interface Props {
  paused: boolean
  onSeekBy: (deltaMs: number) => void
  onTogglePause: () => void
}

const SEEK_STEP_MS = 10_000

export function PlaybackControls({ paused, onSeekBy, onTogglePause }: Props) {
  return (
    <>
      <button
        type="button"
        className="ks-pb-btn ks-pb-seek ks-pb-seek-back"
        onClick={(e) => {
          e.stopPropagation()
          onSeekBy(-SEEK_STEP_MS)
        }}
        title="快退 10 秒"
        aria-label="快退 10 秒"
      >
        <span className="ks-pb-seek-icon" aria-hidden>
          <SeekGlyph dir="back" />
        </span>
        <span className="ks-pb-seek-label ks-mono">10s</span>
      </button>

      <button
        type="button"
        className="ks-pb-btn ks-pb-seek ks-pb-seek-fwd"
        onClick={(e) => {
          e.stopPropagation()
          onSeekBy(SEEK_STEP_MS)
        }}
        title="快进 10 秒"
        aria-label="快进 10 秒"
      >
        <span className="ks-pb-seek-label ks-mono">10s</span>
        <span className="ks-pb-seek-icon" aria-hidden>
          <SeekGlyph dir="fwd" />
        </span>
      </button>

      <button
        type="button"
        className={`ks-pb-btn ks-pb-pause ${paused ? 'is-paused' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onTogglePause()
        }}
        title={paused ? '继续播放' : '暂停播放'}
        aria-label={paused ? '继续播放' : '暂停播放'}
      >
        <span className="ks-pb-pause-icon" aria-hidden>
          {paused ? <PlayGlyph /> : <PauseGlyph />}
        </span>
      </button>
    </>
  )
}

/**
 * 快退 / 快进图标 —— 双三角（类似播放器 rewind/forward 标志）。
 * 用 SVG 手画以保持 stroke 质感跟 EXIT 按钮的 "←" 字形统一。
 */
function SeekGlyph({ dir }: { dir: 'back' | 'fwd' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: dir === 'back' ? 'scaleX(-1)' : undefined }}
      aria-hidden
    >
      <path
        d="M5 6 L12 12 L5 18 Z M12 6 L19 12 L12 18 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.1" fill="currentColor" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.1" fill="currentColor" />
    </svg>
  )
}
function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 5 V19 L19 12 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const pbCss = `
/* ── 快进 / 快退 / 暂停 悬浮按钮 ─────────────────────────
 * 视觉规格：
 *   - 胶囊（seek）/ 正圆（pause）
 *   - 比 .ks-playing-exit / .ks-fab 小一号：高 32px（EXIT 40px，FAB 40px）
 *   - 同款半透玻璃 + 描边 + 阴影，保证整体视觉语言一致
 * 位置：
 *   - 左/右中轴，top:50% 垂直居中；距边 22px（略大于 EXIT/FAB 的 18px，
 *     因为它们在顶部安全区内更贴边，而中轴按钮需要远离 QTE 常出现的中心区）
 *   - 暂停按钮位于底部中央，离底 26px，高于默认字幕位置避免遮挡
 * 电影模式：
 *   - App.tsx 的 .ks-app-root.is-cinema 下的"EXIT / FAB 淡出"规则已把
 *     .ks-pb-btn 一并纳入，这里不再重复声明；UI 随空闲自动渐隐
 */
.ks-pb-btn {
  position: fixed;
  z-index: 1500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  height: 32px;
  min-width: 32px;
  border-radius: var(--ks-radius-pill, 999px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(18, 18, 22, 0.48);
  color: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 10px 28px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  font-family: var(--ks-font-ui);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  opacity: 0;
  /* 进场动画 —— 与 .ks-playing-exit / .ks-fab 使用同一条时序 */
  animation: ks-pb-in 320ms var(--ks-ease, cubic-bezier(0.2, 0.8, 0.2, 1)) 260ms forwards;
  /* transition 与 EXIT/FAB 对齐：电影模式淡出 480ms；hover 走 fast */
  transition:
    opacity 480ms var(--ks-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
    transform 480ms var(--ks-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
    background var(--ks-dur-fast, 140ms) var(--ks-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
    color var(--ks-dur-fast, 140ms) var(--ks-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
    border-color var(--ks-dur-fast, 140ms) var(--ks-ease, cubic-bezier(0.2, 0.8, 0.2, 1));
}
.ks-pb-btn:hover,
.ks-pb-btn:focus-visible {
  background: rgba(255, 123, 61, 0.92);
  color: #fff;
  border-color: rgba(255, 123, 61, 0.9);
  outline: none;
}
.ks-pb-btn:active {
  transform: translate(var(--ks-pb-x, 0), var(--ks-pb-y, 0)) scale(0.94);
}
@keyframes ks-pb-in {
  from { opacity: 0; transform: translate(var(--ks-pb-x, 0), calc(var(--ks-pb-y, 0) + 6px)); }
  to   { opacity: 1; transform: translate(var(--ks-pb-x, 0), var(--ks-pb-y, 0)); }
}

/* ── seek 按钮（左右中轴） ───────────────────────────── */
.ks-pb-seek {
  top: 50%;
  /*
   * 用 CSS var 把"静止时应有的 transform"拆出来，保证 animation / hover /
   * active 三套 transform 都能复用 translate 基准；否则三个地方各写一遍
   * translate(-50%) 很容易漂。
   */
  --ks-pb-y: -50%;
  transform: translate(var(--ks-pb-x, 0), var(--ks-pb-y));
  padding: 0 11px;
}
.ks-pb-seek-back { left: 22px; }
.ks-pb-seek-fwd  { right: 22px; }

.ks-pb-seek-icon {
  display: inline-flex;
  align-items: center;
  color: inherit;
}
.ks-pb-seek-label {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: inherit;
  line-height: 1;
}

/* ── 暂停按钮（底部中轴） ───────────────────────────── */
.ks-pb-pause {
  bottom: 26px;
  left: 50%;
  width: 38px;
  height: 38px;
  padding: 0;
  min-width: 0;
  border-radius: 50%;
  --ks-pb-x: -50%;
  transform: translate(var(--ks-pb-x), var(--ks-pb-y, 0));
}
.ks-pb-pause.is-paused {
  /* 暂停中：用 amber 主题色强调"正在暂停"状态，让玩家一眼看到
   * 当前是"被动停住"（区别于 hover 态也是橙色但不是常驻态）。 */
  background: rgba(255, 123, 61, 0.22);
  border-color: rgba(255, 123, 61, 0.55);
  color: rgba(255, 200, 160, 0.95);
}
.ks-pb-pause.is-paused:hover,
.ks-pb-pause.is-paused:focus-visible {
  background: rgba(255, 123, 61, 0.92);
  color: #fff;
}
.ks-pb-pause-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
`
injectStyleOnce('player-controls', pbCss)
