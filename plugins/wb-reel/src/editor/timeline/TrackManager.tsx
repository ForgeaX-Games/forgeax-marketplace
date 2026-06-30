/**
 * TrackManager —— 「轨道」管理浮层(剪映式)。
 *
 * 列出全部 12 条轨(含被隐藏 / 当前为空 / 逻辑轨),逐项勾选显示/隐藏,并提供「全部显示」。
 * 这是「隐藏此轨」后把它找回来的唯一入口 —— 轨头眼睛只负责隐藏(折叠整行)。
 *
 * 「显示」的语义由父组件 onSetShown 决定:
 *   · 恒显轨(视频/画面/QTE/音频):visible=true 即显示
 *   · 有内容的可选轨:visible=true 即显示
 *   · 空的可选轨:visible=true 且 showEmpty=true → 铺一条空 lane 便于拖入
 */

import type { TrackKey, TrackPrefs } from './trackVisibility'

/** 面板里展示的固定轨顺序与中文名(与时间轴渲染顺序一致)。 */
const TRACK_ROWS: { key: TrackKey; label: string; hint?: string }[] = [
  { key: 'fx', label: '特效', hint: '滤镜 / 调节 / 特效' },
  { key: 'stk', label: '贴纸', hint: '花字 / 图标 / emoji' },
  { key: 'video', label: '视频' },
  { key: 'image', label: '画面', hint: '关键帧镜头带' },
  { key: 'dia', label: '字幕', hint: '台词(同时控制画面字幕)' },
  { key: 'qte', label: 'QTE' },
  { key: 'txt', label: '文字', hint: '富文本贴字' },
  { key: 'srch', label: '搜索', hint: '道具搜寻段' },
  { key: 'trig', label: '触发', hint: '子弹时间区间' },
  { key: 'audio', label: '音频', hint: 'BGM / 音效 / 配音' },
  { key: 'game', label: '小游戏' },
  { key: 'br', label: '分支', hint: '剧情选择' },
]

export interface TrackManagerProps {
  prefs: TrackPrefs
  /** 当前是否「显示」(综合 visible + 内容 + showEmpty),由父组件算好传入。 */
  isShown: (key: TrackKey) => boolean
  /** 该轨当前是否有内容(用于在面板里标注「空」)。 */
  hasContent: (key: TrackKey) => boolean
  onSetShown: (key: TrackKey, shown: boolean) => void
  onShowAll: () => void
  onClose: () => void
}

export function TrackManager({
  prefs: _prefs,
  isShown,
  hasContent,
  onSetShown,
  onShowAll,
  onClose,
}: TrackManagerProps) {
  return (
    <div className="ks-trackmgr-backdrop" onPointerDown={onClose}>
      <div
        className="ks-trackmgr"
        role="dialog"
        aria-label="轨道管理"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="ks-trackmgr-head">
          <span className="ks-trackmgr-title">轨道</span>
          <button
            type="button"
            className="ks-trackmgr-allbtn"
            onClick={onShowAll}
            title="显示全部轨道"
          >
            全部显示
          </button>
        </div>
        <div className="ks-trackmgr-list">
          {TRACK_ROWS.map(({ key, label, hint }) => {
            const shown = isShown(key)
            const empty = !hasContent(key)
            return (
              <label key={key} className="ks-trackmgr-item">
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={() => onSetShown(key, !shown)}
                />
                <span className="ks-trackmgr-name">{label}</span>
                {hint && <span className="ks-trackmgr-hint">{hint}</span>}
                {empty && <span className="ks-trackmgr-empty">空</span>}
              </label>
            )
          })}
        </div>
        <p className="ks-trackmgr-foot">
          勾选 = 显示该轨;取消 = 折叠隐藏。视觉轨隐藏后预览与试玩里也不出现。
        </p>
      </div>
    </div>
  )
}
