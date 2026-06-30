import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useOnboardingStore } from '../onboarding/onboardingStore'
import { TimelineRestoreMenu } from './TimelineRestoreMenu'
import { formatTimeCode } from './timelineFormat'

/**
 * TimelineToolbar —— 位于时间轴左上的常驻工具条（剪映 style）。
 *
 * 操作对象是"当前选中的 clip"（shot 或 audio）。当没有选中时：
 *   - 剪切：不可用
 *   - 自动左对齐：永远可用（按轨道整体压实）
 *   - 删除：不可用
 *
 * "选中" 态由 props 传入（由父组件 Timeline 管理）。按钮激活条件在父组件决定，
 * 这里只负责 UI。
 */

export interface TimelineToolbarProps {
  /** 当前 hoverMs —— 影响"剪切"按钮 tooltip 的"在 X.XXs 处切开"文案 */
  hoverMs: number
  selection: ToolbarSelection | null
  onSplit: () => void
  onCompactShots: () => void
  onCompactAudio: () => void
  onDelete: () => void
  /** 复制 / 粘贴 / 再制（剪映式，落点在播放头）。粘贴是否可用由剪贴板是否有内容决定。 */
  onCopy: () => void
  onPaste: () => void
  onDuplicate: () => void
  canPaste: boolean
  /** 播放头跳转(剪映标配:回到起点 / 跳到末尾) */
  onSeekToStart: () => void
  onSeekToEnd: () => void
  /** 当前节点总时长(ms)——播放头读数显示 mm:ss.SSS / 总时长 */
  totalMs: number
  /** 一键清空当前场景时间轴（字幕 / QTE / 镜头 / 音频 / 场景素材库；剧情分支保留） */
  onClearAll: () => void
  /** 微调选中 clip 位置：dir=-1 左移 / +1 右移；stepMs 已计入 Shift/Alt 修饰 */
  onNudge: (dir: -1 | 1, stepMs: number) => void
  snapEnabled: boolean
  onToggleSnap: () => void
  /** 光标跟随模式 —— true 时时间线跟随鼠标，false 时锁定不动 */
  followCursor: boolean
  onToggleFollow: () => void
  /** 时间轴缩放倍率（1× = 整段铺满，放大出现横向滚动） */
  zoom: number
  onZoomChange: (zoom: number) => void
  /** 一键回到「适配宽度」（zoom=1） */
  onZoomFit: () => void
  /** 当前节点总时长（秒，取整）—— 可直接键入加长，不再被自动生成的素材秒数限制 */
  durationSec: number
  onDurationSecChange: (sec: number) => void
}

const ZOOM_MIN = 1
const ZOOM_MAX = 20

export type ToolbarSelection =
  | { kind: 'shot'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'dialogue'; id: string }
  | { kind: 'cue'; id: string }
  | { kind: 'branch'; id: string }
  | { kind: 'minigame'; id: string }
  | { kind: 'textOverlay'; id: string }
  | { kind: 'searchSegment'; id: string }
  | { kind: 'filter'; id: string }
  | { kind: 'adjust'; id: string }
  | { kind: 'effect'; id: string }
  | { kind: 'sticker'; id: string }
  | { kind: 'transition'; id: string }
  // v3.9.8：video 是"每场景唯一"的视频裁剪条（scene.media.kind='VIDEO'），
  //   没有独立 id，统一用 'scene:<sceneId>' 之类的自描述字符串方便调试。
  | { kind: 'video'; id: string }

export function TimelineToolbar(props: TimelineToolbarProps) {
  const { selection, hoverMs } = props
  // 剪切仅对"可在 hoverMs 处切成两段"的 clip 成立：shot / audio
  const canSplit = !!selection && (selection.kind === 'shot' || selection.kind === 'audio')
  const canDelete = !!selection
  const canNudge = !!selection

  // 撤销 / 重做 —— 直接订阅 scenarioStore 的 zundo 历史栈（与右上 TopBar 同一份栈）。
  // 作者反馈「主区域编辑时间轴时，时间轴上方看不到撤销」：因为 TopBar 只在左侧栏渲染，
  // 主区域没有。这里把撤销/重做就地放进时间轴工具条，误删后立刻能找回（最多 50 步，
  // 注意是内存栈、刷新会清空）。
  const pastCount = useStore(useScenarioStore.temporal, (s) => s.pastStates.length)
  const futureCount = useStore(useScenarioStore.temporal, (s) => s.futureStates.length)
  function doUndo(): void {
    useScenarioStore.temporal.getState().undo()
  }
  function doRedo(): void {
    useScenarioStore.temporal.getState().redo()
  }

  // ⌘/Ctrl+Z 撤销、⌘/Ctrl+Shift+Z（或 Ctrl+Y）重做 —— TopBar 的同款快捷键只在
  // 左侧栏 iframe 注册，主区域（时间轴所在 iframe）收不到，所以这里在主区域窗口
  // 单独挂一份，保证作者在时间轴里也能按快捷键撤销误删。输入框聚焦时不抢键。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 去重：独立运行时 TopBar 也挂了同款 ⌘Z 监听（同一 window）。谁先处理谁
      // preventDefault，另一个见 defaultPrevented 即跳过，避免一次按键撤销两步。
      if (e.defaultPrevented) return
      const tgt = e.target as HTMLElement | null
      const tag = tgt?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (tgt?.isContentEditable ?? false)) {
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useScenarioStore.temporal.getState().undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        useScenarioStore.temporal.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function nudge(dir: -1 | 1) {
    return (e: React.MouseEvent) => {
      // Shift=10ms 精细；Alt=500ms 大步；默认 100ms
      const step = e.shiftKey ? 10 : e.altKey ? 500 : 100
      props.onNudge(dir, step)
    }
  }

  const setHelpOpen = useOnboardingStore((s) => s.setHelpOpen)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!moreOpen) return
    const onDocDown = (e: PointerEvent): void => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', onDocDown, true)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true)
      document.removeEventListener('keydown', onEsc)
    }
  }, [moreOpen])

  return (
    <div className="ks-tltb">
      <div className="ks-tltb-left">
        <TbButton
          icon="↶"
          label="撤销"
          hint={
            pastCount > 0
              ? `撤销上一步（还可撤 ${pastCount} 步）· ⌘/Ctrl+Z · 误删可在此找回`
              : '没有可撤销的操作（撤销记录在内存里，刷新会清空）'
          }
          onClick={doUndo}
          disabled={pastCount === 0}
        />
        <TbButton
          icon="↷"
          label="重做"
          hint={
            futureCount > 0
              ? `重做（还可重做 ${futureCount} 步）· ⌘/Ctrl+Shift+Z`
              : '没有可重做的操作'
          }
          onClick={doRedo}
          disabled={futureCount === 0}
          variant="ghost"
        />
        {/* 误删恢复 · 回收站 —— 读持久化的删除快照，刷新也能找回（区别于内存里的撤销栈） */}
        <TimelineRestoreMenu />
        <span className="ks-tltb-sep" aria-hidden />
        {/* 高频常驻：剪切 / 删除 */}
        <TbButton
          icon="✂"
          label="剪切"
          hint={
            canSplit
              ? `在 ${(hoverMs / 1000).toFixed(2)}s 处切开当前选中`
              : selection
                ? `${selLabel(selection.kind)} 无法被剪切（只支持 SHOT / AUDIO）`
                : '先选中一段 SHOT 或 AUDIO'
          }
          onClick={props.onSplit}
          disabled={!canSplit}
        />
        <TbButton
          icon="🗑"
          label="删除"
          hint={canDelete ? '删除选中 clip（Delete / Backspace）' : '先选中 clip'}
          onClick={props.onDelete}
          disabled={!canDelete}
          variant="danger"
        />
        <span className="ks-tltb-sep" aria-hidden />
        {/* 更多 —— 低频操作收进弹层，根治工具栏拥挤/裁切 */}
        <div className="ks-tltb-more-wrap" ref={moreRef}>
          <button
            type="button"
            className={`ks-tltb-btn ks-tltb-more-btn ${moreOpen ? 'is-open' : ''}`}
            onClick={() => setMoreOpen((v) => !v)}
            title="更多编辑操作（复制/粘贴/再制 · 左对齐 · 微调 · 清空）"
            aria-label="更多"
            aria-expanded={moreOpen}
          >
            <span className="ks-tltb-btn-icon" aria-hidden>⋯</span>
            <span className="ks-tltb-btn-label">更多</span>
          </button>
          {moreOpen && (
            <div className="ks-tltb-more" role="menu">
              <div className="ks-tltb-more-group">剪贴板</div>
              <TbMenuItem icon="⧉" label="复制" hint="⌘/Ctrl+C" disabled={!canDelete} onClick={() => { props.onCopy(); setMoreOpen(false) }} />
              <TbMenuItem icon="⎘" label="粘贴到播放头" hint="⌘/Ctrl+V" disabled={!props.canPaste} onClick={() => { props.onPaste(); setMoreOpen(false) }} />
              <TbMenuItem icon="⊞" label="再制" hint="⌘/Ctrl+D" disabled={!canDelete} onClick={() => { props.onDuplicate(); setMoreOpen(false) }} />
              <div className="ks-tltb-more-group">对齐</div>
              <TbMenuItem icon="⇤" label="镜头左对齐" hint="所有 SHOT 段按顺序紧挨" onClick={() => { props.onCompactShots(); setMoreOpen(false) }} />
              <TbMenuItem icon="♪" label="音频左对齐" hint="各 audio role 内部紧挨" onClick={() => { props.onCompactAudio(); setMoreOpen(false) }} />
              <div className="ks-tltb-more-group">微调（Shift=10ms · Alt=500ms）</div>
              <TbMenuItem icon="◀" label="左移选中" hint="默认 100ms" disabled={!canNudge} onClick={(e) => { nudge(-1)(e); }} keepOpen />
              <TbMenuItem icon="▶" label="右移选中" hint="默认 100ms" disabled={!canNudge} onClick={(e) => { nudge(1)(e); }} keepOpen />
              <div className="ks-tltb-more-group">危险</div>
              <TbMenuItem icon="⌫" label="清空时间轴" hint="字幕/QTE/镜头/音频/素材库 · 分支保留 · 会确认" variant="danger" onClick={() => { props.onClearAll(); setMoreOpen(false) }} />
            </div>
          )}
        </div>
      </div>

      <div className="ks-tltb-right">
        {/* 播放头读数 + 跳转（剪映标配）：当前时间码 / 总时长，回到起点 / 跳到末尾 */}
        <button
          type="button"
          className="ks-tltb-jump"
          onClick={props.onSeekToStart}
          title="回到起点（播放头跳到 0）"
          aria-label="回到起点"
        >
          ⏮
        </button>
        <span className="ks-tltb-timecode ks-mono" title="播放头位置 / 节点总时长">
          {formatTimeCode(hoverMs)} / {formatTimeCode(props.totalMs)}
        </span>
        <button
          type="button"
          className="ks-tltb-jump"
          onClick={props.onSeekToEnd}
          title="跳到末尾（播放头跳到结尾）"
          aria-label="跳到末尾"
        >
          ⏭
        </button>
        <span className="ks-tltb-sep" aria-hidden />
        {/* 总长（秒）—— 直接键入加长当前节点时间轴；player 仍按素材实际长度播放 */}
        <label
          className="ks-tltb-num"
          title="节点总时长（秒）· 起步 50s · 可任意加长 · 时间轴不被自动生成的素材秒数限制 · player 播完素材即跳下一节点"
        >
          <span className="ks-mono">总长</span>
          <input
            type="number"
            min={1}
            step={5}
            value={props.durationSec}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v > 0) props.onDurationSecChange(v)
            }}
          />
          <span className="ks-tltb-num-unit ks-mono">s</span>
        </label>
        {/* 缩放滑块（剪映式）· Ctrl/⌘ + 滚轮也可缩放 */}
        <div
          className="ks-tltb-zoom"
          title="时间轴缩放 · 拖滑块或 Ctrl/⌘ + 滚轮 · 点 1× 回到适配宽度"
        >
          <button
            type="button"
            className="ks-tltb-zoom-fit"
            onClick={props.onZoomFit}
            title="适配宽度（1×）"
          >
            <span className="ks-mono">{props.zoom.toFixed(1)}×</span>
          </button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.1}
            value={Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, props.zoom))}
            onChange={(e) => props.onZoomChange(Number(e.target.value))}
            aria-label="时间轴缩放"
          />
        </div>
        <span className="ks-tltb-sep" aria-hidden />
        <button
          type="button"
          className={`ks-tltb-snap ${props.followCursor ? 'is-on' : ''}`}
          onClick={props.onToggleFollow}
          title={
            props.followCursor
              ? '光标跟随 · 鼠标移到哪，时间线就到哪；拖入素材落点 = 当前时间线。点击关闭'
              : '光标已锁定 · 鼠标移动不改时间线；只有点击时间轴才会跳；拖入素材落点 = 锁定位置。点击开启'
          }
          aria-pressed={props.followCursor}
        >
          <span className="ks-tltb-snap-dot" aria-hidden />
          <span className="ks-mono">FOLLOW</span>
        </button>
        <button
          type="button"
          className={`ks-tltb-snap ${props.snapEnabled ? 'is-on' : ''}`}
          onClick={props.onToggleSnap}
          title={
            props.snapEnabled
              ? '吸附已开启 · 默认 100ms / Shift=10ms / Alt=500ms · 点击关闭（刷新不丢）'
              : '吸附已关闭 · 拖拽走 1ms 自由位移 · 点击开启'
          }
          aria-pressed={props.snapEnabled}
        >
          <span className="ks-tltb-snap-dot" aria-hidden />
          <span className="ks-mono">SNAP</span>
        </button>
        <span className="ks-tltb-sep" aria-hidden />
        <button
          type="button"
          className="ks-tltb-help"
          onClick={() => setHelpOpen(true)}
          title="帮助 · 快捷键与功能速查（新手引导）"
          aria-label="帮助"
        >
          ?
        </button>
        {/*
         * v3.9.11：右侧拿掉了两个"只读装饰"元素 —— 时间码徽章（.ks-tltb-tc）
         *   和选中徽章（.ks-tltb-sel）。
         *   - 时间码：轨道上的 5 个刻度 + 拖拽时的 DragHud 浮标已经覆盖了
         *     "当前在哪 / 场景多长" 的信息，常驻徽章是视觉噪声。
         *   - 选中 id：id 对作者没业务意义；clip 自身 is-selected 高亮
         *     已经足够反馈"谁被选中"。
         *   作者 2026-05-07 反馈"工具条还是太挤"，两块占位最大的先砍掉。
         *   保留 hoverMs 和 selection 还通过 props 进来，因为剪切按钮
         *   的 tooltip（"在 X.XXs 处切开"/"只支持 SHOT / AUDIO"）仍要用。
         */}
      </div>
    </div>
  )
}

function selLabel(kind: ToolbarSelection['kind']): string {
  switch (kind) {
    case 'shot':
      return 'SHOT'
    case 'audio':
      return 'AUDIO'
    case 'dialogue':
      return 'DIALOGUE'
    case 'cue':
      return 'QTE'
    case 'branch':
      return 'BRANCH'
    case 'minigame':
      return 'MINIGAME'
    case 'textOverlay':
      return 'TEXT'
    case 'searchSegment':
      return 'SEARCH'
    case 'filter':
      return 'FILTER'
    case 'adjust':
      return 'ADJUST'
    case 'effect':
      return 'EFFECT'
    case 'sticker':
      return 'STICKER'
    case 'transition':
      return 'TRANS'
    case 'video':
      return 'VIDEO'
  }
}

function TbButton({
  icon,
  label,
  hint,
  onClick,
  disabled,
  variant,
}: {
  icon: string
  label: string
  hint: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  variant?: 'ghost' | 'danger'
}) {
  return (
    <button
      type="button"
      className={`ks-tltb-btn ${variant ? `is-${variant}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={hint}
      aria-label={label}
    >
      <span className="ks-tltb-btn-icon" aria-hidden>
        {icon}
      </span>
      {/* 文字 label 仅留作无障碍(aria-label)，视觉上隐藏 —— 工具条只展示图标，
          鼠标悬停看 title tooltip(含功能名)。作者: "文字标签被遮盖, 尽量只展示图标"。 */}
      <span className="ks-tltb-btn-label">{label}</span>
    </button>
  )
}

/** 「更多」弹层里的菜单项：图标 + 文字 + 副提示。keepOpen 用于微调（可连点）。 */
function TbMenuItem({
  icon,
  label,
  hint,
  onClick,
  disabled,
  variant,
}: {
  icon: string
  label: string
  hint?: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  variant?: 'danger'
  keepOpen?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`ks-tltb-more-item ${variant ? `is-${variant}` : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="ks-tltb-more-item-icon" aria-hidden>{icon}</span>
      <span className="ks-tltb-more-item-label">{label}</span>
      {hint && <span className="ks-tltb-more-item-hint">{hint}</span>}
    </button>
  )
}

const css = `
.ks-tltb {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 6px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-elev);
  box-shadow: var(--ks-shadow-inset-hi);
  min-width: 0;
  flex-wrap: nowrap;
  /* overflow 不再 hidden：左侧低频操作已折叠进「更多」弹层，按钮量大幅减少，
     无需裁切；且弹层(下拉/帮助)需要溢出工具栏显示。 */
  overflow: visible;
}
.ks-tltb-left {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 0 1 auto;
  overflow: visible;
}
.ks-tltb-sep {
  display: inline-block;
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--ks-border);
  flex-shrink: 0;
}
.ks-tltb-btn {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  /* icon-only: 方形 chip 点击区 —— 带底色描边, 不再是细窄的纯图标 */
  padding: 0 7px;
  min-width: 30px;
  height: 28px;
  box-sizing: border-box;
  border-radius: var(--ks-radius-sm);
  font-size: 11px;
  line-height: 1;
  color: var(--ks-text-soft);
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border-soft);
  transition: all var(--ks-dur-fast) var(--ks-ease);
  white-space: nowrap;
  flex-shrink: 0;
}
.ks-tltb-btn:hover:not(:disabled) {
  background: var(--ks-panel-elev);
  color: var(--ks-text);
  border-color: var(--ks-border-strong);
}
.ks-tltb-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ks-tltb-btn.is-ghost { color: var(--ks-text-dim); }
.ks-tltb-btn.is-danger:hover:not(:disabled) {
  color: var(--ks-rose);
  border-color: var(--ks-rose);
  background: rgba(240, 119, 157, 0.06);
}
.ks-tltb-btn-icon {
  font-size: 14px;
  line-height: 1;
  display: inline-block;
  width: 16px;
  text-align: center;
}
/* 文字 label 隐藏(仍在 DOM 里供 aria-label) —— 工具条只展示图标, 悬停看 tooltip */
.ks-tltb-btn-label {
  display: none;
}

/* 「更多」弹层 —— 低频操作折叠于此, 根治工具栏裁切 */
.ks-tltb-more-wrap { position: relative; flex-shrink: 0; display: inline-flex; }
.ks-tltb-more-btn.is-open {
  background: var(--ks-panel-elev);
  color: var(--ks-text);
  border-color: var(--ks-border-strong);
}
.ks-tltb-more {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  min-width: 196px;
  padding: 4px;
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  box-shadow: var(--ks-shadow-pop, 0 8px 24px rgba(0,0,0,0.4));
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ks-tltb-more-group {
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ks-text-faint);
  padding: 6px 8px 2px;
}
.ks-tltb-more-item {
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--ks-radius-sm);
  color: var(--ks-text-soft);
  font-size: 12px;
}
.ks-tltb-more-item:hover:not(:disabled) { background: var(--ks-panel-solid); color: var(--ks-text); }
.ks-tltb-more-item:disabled { opacity: 0.4; cursor: not-allowed; }
.ks-tltb-more-item.is-danger:hover:not(:disabled) { color: var(--ks-rose); }
.ks-tltb-more-item-icon { width: 16px; text-align: center; font-size: 13px; flex-shrink: 0; }
.ks-tltb-more-item-label { flex: 1 1 auto; white-space: nowrap; }
.ks-tltb-more-item-hint { font-size: 9.5px; color: var(--ks-text-faint); white-space: nowrap; }

/* 「?」帮助按钮 */
.ks-tltb-help {
  all: unset;
  cursor: pointer;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  font-size: 12px; font-weight: 700;
  color: var(--ks-text-dim);
  border: 1px solid var(--ks-border-soft);
  flex-shrink: 0;
}
.ks-tltb-help:hover { color: var(--ks-amber); border-color: var(--ks-amber); }

.ks-tltb-right {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  min-width: 0;
}
.ks-tltb-snap {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: var(--ks-radius-pill);
  font-size: 9px;
  letter-spacing: 0.15em;
  color: var(--ks-text-faint);
  border: 1px solid var(--ks-border-soft);
  white-space: nowrap;
}
.ks-tltb-snap.is-on {
  color: var(--ks-amber);
  border-color: var(--ks-amber);
  background: var(--ks-amber-soft);
}
.ks-tltb-snap-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 3px currentColor;
}

/* ── 总长（秒）数字输入 ─────────────────────────────────────── */
.ks-tltb-jump {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 18px; padding: 0;
  border: 1px solid var(--ks-border-soft); border-radius: var(--ks-radius-sm);
  background: var(--ks-surface-warm); color: var(--ks-text-dim);
  cursor: pointer; font-size: 11px;
}
.ks-tltb-jump:hover { color: var(--ks-text); border-color: var(--ks-amber); }
.ks-tltb-timecode {
  font-size: 10px; letter-spacing: 0.04em;
  color: var(--ks-text-dim); white-space: nowrap;
  padding: 0 2px; min-width: 118px; text-align: center;
}
.ks-tltb-num {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: var(--ks-radius-sm);
  border: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-solid);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--ks-text-faint);
  flex-shrink: 0;
}
.ks-tltb-num input {
  all: unset;
  width: 34px;
  text-align: right;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--ks-text);
}
.ks-tltb-num input::-webkit-outer-spin-button,
.ks-tltb-num input::-webkit-inner-spin-button { margin: 0; }
.ks-tltb-num-unit { color: var(--ks-text-faint); }

/* ── 缩放：读数按钮 + 滑块 ─────────────────────────────────── */
.ks-tltb-zoom {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.ks-tltb-zoom-fit {
  all: unset;
  cursor: pointer;
  min-width: 30px;
  text-align: center;
  padding: 3px 5px;
  border-radius: var(--ks-radius-sm);
  border: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-solid);
  font-size: 10px;
  color: var(--ks-text-soft);
  font-variant-numeric: tabular-nums;
}
.ks-tltb-zoom-fit:hover {
  color: var(--ks-text);
  border-color: var(--ks-border-strong);
}
.ks-tltb-zoom input[type='range'] {
  width: 84px;
  accent-color: var(--ks-amber);
  cursor: pointer;
}
`
injectStyleOnce('timeline-toolbar', css)
