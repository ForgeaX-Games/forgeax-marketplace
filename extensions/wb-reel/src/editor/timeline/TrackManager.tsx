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

import { useT } from '../../i18n'
import type { TrackKey, TrackPrefs } from './trackVisibility'

/** 面板里展示的固定轨顺序(与时间轴渲染顺序一致)。 */
const TRACK_ROWS: { key: TrackKey; labelKey: string; hintKey?: string }[] = [
  { key: 'fx', labelKey: 'track.fx', hintKey: 'track.fxHint' },
  { key: 'stk', labelKey: 'track.sticker', hintKey: 'track.stickerHint' },
  { key: 'video', labelKey: 'track.video' },
  { key: 'image', labelKey: 'track.image', hintKey: 'track.imageHint' },
  { key: 'dia', labelKey: 'track.dia', hintKey: 'track.diaHint' },
  { key: 'qte', labelKey: 'track.qte' },
  { key: 'txt', labelKey: 'track.txt', hintKey: 'track.txtHint' },
  { key: 'srch', labelKey: 'track.search', hintKey: 'track.searchHint' },
  { key: 'trig', labelKey: 'track.trig', hintKey: 'track.trigHint' },
  { key: 'audio', labelKey: 'track.audio', hintKey: 'track.audioHint' },
  { key: 'game', labelKey: 'track.game' },
  { key: 'br', labelKey: 'track.branch', hintKey: 'track.branchHint' },
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
  const t = useT()
  return (
    <div className="ks-trackmgr-backdrop" onPointerDown={onClose}>
      <div
        className="ks-trackmgr"
        role="dialog"
        aria-label={t('track.manageAria')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="ks-trackmgr-head">
          <span className="ks-trackmgr-title">{t('track.managerTitle')}</span>
          <button
            type="button"
            className="ks-trackmgr-allbtn"
            onClick={onShowAll}
            title={t('track.showAllTitle')}
          >
            {t('track.showAll')}
          </button>
        </div>
        <div className="ks-trackmgr-list">
          {TRACK_ROWS.map(({ key, labelKey, hintKey }) => {
            const shown = isShown(key)
            const empty = !hasContent(key)
            return (
              <label key={key} className="ks-trackmgr-item">
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={() => onSetShown(key, !shown)}
                />
                <span className="ks-trackmgr-name">{t(labelKey)}</span>
                {hintKey && <span className="ks-trackmgr-hint">{t(hintKey)}</span>}
                {empty && <span className="ks-trackmgr-empty">{t('track.empty')}</span>}
              </label>
            )
          })}
        </div>
        <p className="ks-trackmgr-foot">{t('track.foot')}</p>
      </div>
    </div>
  )
}
