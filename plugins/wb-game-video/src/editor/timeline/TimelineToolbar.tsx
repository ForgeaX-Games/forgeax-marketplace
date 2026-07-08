import { useEffect } from 'react'
import { useStore } from 'zustand'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { TimelineRestoreMenu } from './TimelineRestoreMenu'

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
  /** 一键清空当前场景时间轴（字幕 / QTE / 镜头 / 音频 / 场景素材库；剧情分支保留） */
  onClearAll: () => void
  /** 微调选中 clip 位置：dir=-1 左移 / +1 右移；stepMs 已计入 Shift/Alt 修饰 */
  onNudge: (dir: -1 | 1, stepMs: number) => void
  snapEnabled: boolean
  onToggleSnap: () => void
  /** 光标跟随模式 —— true 时时间线跟随鼠标，false 时锁定不动 */
  followCursor: boolean
  onToggleFollow: () => void
  /**
   * 台词 / 字幕轨可见性 —— 作者默认关掉（见 dialoguePref）。
   * 关闭时 DIA 轨在时间轴里被藏起来，同时画面预览也不叠字幕。
   * 这里工具条只负责切开关，具体轨道渲染和画面预览由父组件/兄弟消费同一个 flag。
   */
  showDialogue: boolean
  onToggleDialogue: () => void
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
          icon="⇤"
          label="镜头左对齐"
          hint="镜头左对齐 · 把所有 SHOT 段按顺序紧挨"
          onClick={props.onCompactShots}
        />
        <TbButton
          icon="♪"
          label="音频左对齐"
          hint="音频左对齐 · 各 audio role 内部紧挨"
          onClick={props.onCompactAudio}
          variant="ghost"
        />
        <span className="ks-tltb-sep" aria-hidden />
        <TbButton
          icon="◀"
          label="左移"
          hint="左移选中 clip · 默认 100ms · Shift=10ms · Alt=500ms"
          onClick={nudge(-1)}
          disabled={!canNudge}
          variant="ghost"
        />
        <TbButton
          icon="▶"
          label="右移"
          hint="右移选中 clip · 默认 100ms · Shift=10ms · Alt=500ms"
          onClick={nudge(1)}
          disabled={!canNudge}
          variant="ghost"
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
        <TbButton
          icon="⌫"
          label="清空"
          hint="一键清空当前场景时间轴：字幕 / QTE / 镜头 / 音频 / 场景素材库（图像 & 视频）。剧情分支保留不动 · 会弹确认"
          onClick={props.onClearAll}
          variant="danger"
        />
      </div>

      <div className="ks-tltb-right">
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
          className={`ks-tltb-snap ${props.showDialogue ? 'is-on' : ''}`}
          onClick={props.onToggleDialogue}
          title={
            props.showDialogue
              ? '台词 / 字幕轨已显示 · 画面预览也会叠字幕 · 点击字幕条 → 在右侧字幕面板修改文字 · 点击隐藏（刷新不丢）'
              : '台词 / 字幕轨已隐藏 · 画面预览也不叠字幕 · 点击显示后选中字幕可在右侧面板编辑'
          }
          aria-pressed={props.showDialogue}
        >
          <span className="ks-tltb-snap-dot" aria-hidden />
          <span className="ks-mono">DIA</span>
        </button>
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
  overflow: hidden;
}
.ks-tltb-left {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
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
