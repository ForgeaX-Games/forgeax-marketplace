/**
 * TrackGutter —— 时间轴左侧固定轨头列(剪映式)。
 *
 * 它不在横向缩放滚动的画布(.ks-timeline-tracks)里,而是画布左侧的独立一列:
 *   · 横向:固定不动(画布横滚时轨头钉在左侧)
 *   · 纵向:由父组件把 .ks-timeline-scroll 的 scrollTop 传进来,内层整体上移同步对齐
 *
 * 每行 = 中文轨名 + 控件(眼睛=隐藏此轨;音频额外静音;可选锁定)。行的 top/height 由父组件
 * 量测真实 lane 的 offsetTop/offsetHeight 得到,所以无论 lane 高度怎么变都能像素级对齐。
 */

import type { TrackKey, TrackPrefs } from './trackVisibility'

export const TRACK_GUTTER_W = 80

/** lane 根节点 className → {轨 key, 中文名}。父组件量测时用它把 DOM 行映射成轨头。 */
export const TRACK_CLASS_META: Record<string, { key: TrackKey; label: string }> = {
  'ks-track-fx': { key: 'fx', label: '特效' },
  'ks-track-sticker': { key: 'stk', label: '贴纸' },
  'ks-track-video': { key: 'video', label: '视频' },
  'ks-track-shot': { key: 'image', label: '画面' },
  'ks-track-dialogue': { key: 'dia', label: '字幕' },
  'ks-track-qte': { key: 'qte', label: 'QTE' },
  'ks-track-text': { key: 'txt', label: '文字' },
  'ks-track-search': { key: 'srch', label: '搜索' },
  'ks-track-trig': { key: 'trig', label: '触发' },
  'ks-track-audio': { key: 'audio', label: '音频' },
  'ks-track-minigame': { key: 'game', label: '小游戏' },
  'ks-track-branch': { key: 'br', label: '分支' },
}

export interface GutterRow {
  kind: 'rule' | 'track'
  /** 仅 kind==='track' */
  key?: TrackKey
  label?: string
  top: number
  height: number
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <path
        d="M8 3.5C4.4 3.5 1.7 6 1 8c.7 2 3.4 4.5 7 4.5s6.3-2.5 7-4.5c-.7-2-3.4-4.5-7-4.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  )
}

function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <path d="M3 6h2.5L9 3v10L5.5 10H3Z" fill="currentColor" />
      {muted ? (
        <path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" strokeWidth="1.2" fill="none" />
      ) : (
        <path
          d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 4a5.5 5.5 0 0 1 0 8"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
      )}
    </svg>
  )
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <rect x="4" y="7" width="8" height="6" rx="1" fill="currentColor" />
      <path
        d={locked ? 'M6 7V5.5a2 2 0 0 1 4 0V7' : 'M6 7V5.5a2 2 0 0 1 3.7-1'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

export interface TrackGutterProps {
  rows: GutterRow[]
  prefs: TrackPrefs
  scrollTop: number
  onHide: (key: TrackKey) => void
  onToggleMute: (key: TrackKey) => void
  onToggleLock: (key: TrackKey) => void
  onOpenManager: () => void
}

export function TrackGutter({
  rows,
  prefs,
  scrollTop,
  onHide,
  onToggleMute,
  onToggleLock,
  onOpenManager,
}: TrackGutterProps) {
  return (
    <div className="ks-track-gutter">
      <div
        className="ks-gutter-inner"
        style={{ transform: `translateY(${-scrollTop}px)` }}
      >
        {rows.map((r) => {
          if (r.kind === 'rule') {
            return (
              <div
                key="__rule"
                className="ks-gutter-cell ks-gutter-rule"
                style={{ top: r.top, height: r.height }}
              >
                <button
                  type="button"
                  className="ks-gutter-btn ks-gutter-manage"
                  title="轨道管理 · 显示/隐藏各轨"
                  aria-label="轨道管理"
                  onClick={onOpenManager}
                >
                  ≡
                </button>
              </div>
            )
          }
          const key = r.key as TrackKey
          const st = prefs[key]
          return (
            <div
              key={key}
              className={`ks-gutter-cell ks-gutter-row${st.locked ? ' is-locked' : ''}`}
              style={{ top: r.top, height: r.height }}
            >
              <span className="ks-gutter-name" title={r.label}>
                {r.label}
              </span>
              <span className="ks-gutter-ctrls">
                {key === 'audio' && (
                  <button
                    type="button"
                    className={`ks-gutter-btn${st.muted ? ' is-active' : ''}`}
                    title={st.muted ? '取消静音' : '静音此轨'}
                    aria-label="静音"
                    onClick={() => onToggleMute(key)}
                  >
                    <MuteIcon muted={st.muted} />
                  </button>
                )}
                <button
                  type="button"
                  className={`ks-gutter-btn${st.locked ? ' is-active' : ''}`}
                  title={st.locked ? '解锁此轨' : '锁定此轨 · 禁止编辑'}
                  aria-label="锁定"
                  onClick={() => onToggleLock(key)}
                >
                  <LockIcon locked={st.locked} />
                </button>
                <button
                  type="button"
                  className="ks-gutter-btn"
                  title="隐藏此轨 · 在「轨道」面板可恢复"
                  aria-label="隐藏"
                  onClick={() => onHide(key)}
                >
                  <EyeIcon />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
