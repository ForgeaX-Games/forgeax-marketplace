import { useEffect, useState, useCallback } from 'react'
import { StagePane } from '../editor/StagePane'
import { TimelineDock } from '../editor/timeline/TimelineDock'
import { Timeline } from '../editor/Timeline'
import { EffectsRail } from '../editor/fx/EffectsRail'
import type { TimelinePreview } from '../editor/timeline/timelinePreview'
import { loadDialoguePref } from '../editor/timeline/dialoguePref'
import { useScenarioStore } from '../scenario/scenarioStore'
import { injectStyleOnce } from '../styles/injectStyle'
import { TimelineTour } from '../editor/onboarding/TimelineTour'
import { HelpPanel } from '../editor/onboarding/HelpPanel'
import { useOnboardingStore } from '../editor/onboarding/onboardingStore'

/**
 * SceneDetailDrawer —— 在 StoryTree Tab 内弹出的场景详情编辑面板。
 *
 * 布局（v6.12「画面为王 · dock 归底带」，2026-06-15）：画面满幅 + 底部 band 横分
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  Stage (画面 / 视频) flex:1 —— 吃满整幅宽高     │
 *   ├───────────────────────────────┬──────────────┤
 *   │  素材库成品条 (标签+「打开素材库」 │              │
 *   │   按钮 + 成品图廊 sceneImages)    │  Dock 字幕/   │
 *   ├───────────────────────────────┤  QTE/分支/   │
 *   │  Timeline (多轨, 吃满 band 剩余) │  音频/小游戏  │
 *   └───────────────────────────────┴──────────────┘
 *        └──────── 底部 band(定高) ────────┘
 *
 * 关键变化（v6.13「素材库入口归位 · 时间轴上方」, 2026-06-15 作者反馈）：
 *   - 时间轴上方原「候选图条」(MultiVersionStrip) 改为**素材库成品条**: 醒目
 *     「打开素材库」按钮(→ forgeView='assets') + 本节点成品图(sceneImages)图廊,
 *     从素材库回来在这里就能看到成品并可拖入时间轴。素材库跟随当前选中节点。
 *   - Dock 仍在底部 band 右半, 高度与时间轴 band 平齐, 内部自滚。
 *   - 顶栏标题块压成一行 (SCENE·EDIT · 标题 · meta 横排), 顶部整体更扁。
 *   - 场景 BGM (SceneBgmPanel) 仍在 TimelineDock 的「音频」页。
 *   - 小游戏 tab 仍在 (字幕/QTE/分支/音频/小游戏 五页)。
 *
 * Timeline 状态（hoverMs / preview）保持不变，drawer 本地持有喂给子组件。
 */
interface Props {
  sceneId: string
  /**
   * dialog 模式必填；inline 模式可省 —— 剧情树「选中节点=编辑该节点」工作流
   * 不需要"关闭回空态"，省略即不渲染关闭按钮。
   */
  onClose?: () => void
  /**
   * 'dialog'（默认，旧）：居中浮层大卡 + scrim + 滑入/滑出动画 + ESC 关闭。
   * 'inline'（2026-06 重构）：铺满父容器的整页编辑视图，无 scrim / 无浮层卡 /
   *   无退出滑动 —— 由 StoryTreeTab 在右侧内容区直接全屏挂载。
   */
  variant?: 'dialog' | 'inline'
}

const SLIDE_DURATION_MS = 200

export function SceneDetailDrawer({ sceneId, onClose, variant = 'dialog' }: Props) {
  const inline = variant === 'inline'
  const selectScene = useScenarioStore((s) => s.selectScene)
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const scenario = useScenarioStore((s) => s.scenario)
  const setSceneIsEnding = useScenarioStore((s) => s.setSceneIsEnding)
  const [closing, setClosing] = useState(false)

  /**
   * Timeline 被提升出 StagePane 后，这两个态由 drawer 持有并同时灌给：
   *   · StagePane  —— 画面叠层（字幕预览 / QTE 打点）消费
   *   · Timeline   —— 光标位置 / 拖拽 preview 镜像
   */
  const [hoverMs, setHoverMs] = useState(0)
  const [preview, setPreview] = useState<TimelinePreview | null>(null)
  /**
   * DIA 轨 / 字幕预览联动开关 —— 真实 state 在 Timeline 内部（localStorage
   * 持久化），这里只做"镜像"给 StagePane 消费：Timeline 通过 onShowDialogueChange
   * 告诉我们当前值，我们把它灌给上方 StagePane 决定要不要渲染字幕 band。
   * 初值先读一次 localStorage，避免首帧 StagePane 闪一下字幕又消失。
   */
  const [showDialogue, setShowDialogue] = useState<boolean>(() => loadDialoguePref())
  /** 右侧「后期效果」检视栏是否收起（默认展开）。 */
  const [fxRailCollapsed, setFxRailCollapsed] = useState(false)

  // v3.9：切换 scene 时把时间线回到 0（场景起点）；跟"光标跟随"默认关掉
  // 一起用，满足"刷新/切场景时时间线不跟随、稳在起点"的作者需求。
  useEffect(() => {
    setHoverMs(0)
    setPreview(null)
  }, [sceneId])

  // 同步 scenarioStore.selectedSceneId —— StagePane 才能渲染到本抽屉目标场景
  useEffect(() => {
    selectScene(sceneId)
  }, [sceneId, selectScene])

  // 首次进入场景编辑器自动起新手引导（看过/跳过后不再自动弹；工具栏「?」可重看）。
  const maybeAutoStartTour = useOnboardingStore((s) => s.maybeAutoStart)
  useEffect(() => {
    maybeAutoStartTour()
  }, [maybeAutoStartTour])

  /**
   * 统一关闭入口 —— 先标记 closing 播退出动画，动画结束再通知父组件 unmount。
   * 用 setTimeout 而非 transitionend：
   *   - 动画跨越 scrim（背景）和 aside（主体）两层，transitionend 难挑哪层结束
   *   - 时长由 CSS 常量驱动，JS 直接用相同值 setTimeout 最可靠
   * closing 期间再次触发忽略，避免重复动画。
   */
  const beginClose = useCallback(() => {
    if (!onClose) return
    if (inline) {
      onClose()
      return
    }
    if (closing) return
    setClosing(true)
    window.setTimeout(onClose, SLIDE_DURATION_MS)
  }, [inline, closing, onClose])

  /**
   * ESC 关闭 —— 从 StoryTreeTab 迁移进来，这样按 ESC 也走 beginClose，
   * 退出动画有机会播完。之前在父层直接 onClose 会跳过动画。
   * inline 模式不是模态浮层，不抢 ESC（避免误关全屏编辑）。
   */
  useEffect(() => {
    if (inline) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') beginClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inline, beginClose])

  if (!scene) {
    return (
      <div
        className={`ks-scene-detail-scrim ${inline ? 'is-inline' : ''} ${closing ? 'is-closing' : ''}`}
        onClick={inline ? undefined : beginClose}
      >
        <aside
          className={`ks-scene-detail ${inline ? 'is-inline' : ''} ${closing ? 'is-closing' : ''}`}
          role={inline ? 'region' : 'dialog'}
          aria-label="场景详情"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="ks-scene-detail-bar">
            <span className="ks-mono">场景已被删除</span>
            <button
              type="button"
              className="ks-scene-detail-close"
              onClick={beginClose}
              aria-label="关闭"
            >
              ✕
            </button>
          </header>
        </aside>
      </div>
    )
  }

  return (
    <div
      className={`ks-scene-detail-scrim ${inline ? 'is-inline' : ''} ${closing ? 'is-closing' : ''}`}
      onClick={inline ? undefined : beginClose}
      aria-hidden
    >
      <aside
        className={`ks-scene-detail ${inline ? 'is-inline' : ''} ${closing ? 'is-closing' : ''}`}
        role={inline ? 'region' : 'dialog'}
        aria-label={`场景详情 · ${scene.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ks-scene-detail-bar">
          <div className="ks-scene-detail-titleblock">
            <div className="ks-scene-detail-kicker ks-mono">SCENE · EDIT</div>
            <div className="ks-scene-detail-title ks-cn">{scene.title}</div>
            <div className="ks-scene-detail-meta ks-mono">
              {scene.id} · {(scene.durationMs / 1000).toFixed(1)}s ·{' '}
              {scene.media.kind}
            </div>
          </div>
          <div className="ks-scene-detail-tools ks-mono">
            {/* v3.8.4 · "标为结局"开关 —— 控制 Player FIN 页该显示"回到起点"
             *   还是"换条路走"。字段写到 scene.isEnding，重连断链对话框
             *   和 reconnectOrphans.ts 也尊重此 flag。 */}
            <button
              type="button"
              className={`ks-scene-detail-ending ${scene.isEnding ? 'is-on' : ''}`}
              onClick={() => setSceneIsEnding(scene.id, !scene.isEnding)}
              title={
                scene.isEnding
                  ? '取消结局标记 · 玩家在此 FIN 时显示"换条路走"'
                  : '标为真结局 · 玩家在此 FIN 时显示"回到起点"'
              }
            >
              <span aria-hidden>{scene.isEnding ? '★' : '☆'}</span>
              <span>标为结局</span>
            </button>
            {inline ? (
              <span className="ks-faint">左栏点节点切换</span>
            ) : (
              <>
                <span className="ks-faint">ESC 关闭</span>
                <button
                  type="button"
                  className="ks-scene-detail-close"
                  onClick={beginClose}
                  aria-label="关闭"
                  title="关闭 (ESC)"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </header>
        <div className="ks-scene-detail-body">
          {/* 上行: 画面预览 + 右侧「后期效果」检视栏(可收起)，画面仍吃满剩余宽高 */}
          <div className="ks-scene-detail-stagerow">
            <StagePane
              sceneId={sceneId}
              hideHeader
              hideTimeline
              hoverMs={hoverMs}
              setHoverMs={setHoverMs}
              preview={preview}
              showDialogue={showDialogue}
            />
            <EffectsRail
              sceneId={sceneId}
              hoverMs={hoverMs}
              collapsed={fxRailCollapsed}
              onToggleCollapsed={() => setFxRailCollapsed((v) => !v)}
            />
          </div>
          {/*
           * 底部定高 band 横分: 左 = 素材库成品条 + 时间轴, 右 = dock(字幕/QTE/分支/
           *   音频/小游戏)。dock 高度与时间轴 band 平齐, 画面拿回整幅宽高。
           *   - 素材库成品条(band 左上): 醒目「打开素材库」按钮 + 本节点成品图廊。
           *   - 「素材库」(AssetsTab) 由该按钮进入, 跟随当前选中节点; 不再是侧栏 pill。
           *   - 场景 BGM (SceneBgmPanel) 仍在 TimelineDock 的「音频」页。
           */}
          <div className="ks-scene-detail-band">
            <div className="ks-scene-detail-band-left">
              {/*
               * 「素材库成品」已移入右侧 dock 的第一个 tab「素材库」(2026-06-16 作者反馈)。
               * band 左侧现在只放时间轴, 吃满整条 band 高度。
               */}
              <div className="ks-scene-detail-cell ks-scene-detail-cell-timeline">
                <Timeline
                  scene={scene}
                  hoverMs={hoverMs}
                  setHoverMs={setHoverMs}
                  onPreviewChange={setPreview}
                  onShowDialogueChange={setShowDialogue}
                />
              </div>
            </div>
            {/* 右: dock 与时间轴 band 等高, 内部自滚, 不侵占画面 */}
            <div className="ks-scene-detail-dock-col">
              <TimelineDock scenario={scenario} currentSceneId={sceneId} />
            </div>
          </div>
        </div>
        {/* 新手引导（首次自动起）+ 帮助速查（工具栏「?」打开）—— 挂在 aside 内，
            position:absolute 覆盖整个编辑器区域。 */}
        <TimelineTour />
        <HelpPanel />
      </aside>
    </div>
  )
}

const css = `
.ks-scene-detail-scrim {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ks-overlay-scrim);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  animation: ks-scene-detail-scrim-fade 200ms var(--ks-ease);
}
.ks-scene-detail-scrim.is-closing {
  animation: ks-scene-detail-scrim-fade-out 200ms var(--ks-ease) forwards;
}
@keyframes ks-scene-detail-scrim-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes ks-scene-detail-scrim-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
/*
 * 居中大卡 —— 2026-04-30 作者："不要从右边弹出，直接居中渐显，点空白消失"。
 * 尺寸保持和原右抽屉近似，但不再锁死 right:16；由 flex 居中。
 */
.ks-scene-detail {
  position: relative;
  width: min(calc(100% - 48px), 1400px);
  height: calc(100% - 48px);
  min-width: 0;
  max-height: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  background: var(--ks-surface-glass);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-xl);
  box-shadow: var(--ks-shadow-lift), var(--ks-shadow-inset-hi);
  animation: ks-scene-detail-pop 200ms var(--ks-ease);
  overflow: hidden;
  transform-origin: center center;
}
/*
 * 退出动画 —— 反向播同一轨迹（scale + 透明度）。
 * 'forwards' 让元素停在终态（scale(0.98), opacity:0），避免动画结束
 * 回跳到初始样式导致一瞬闪现。
 */
.ks-scene-detail.is-closing {
  animation: ks-scene-detail-pop-out 200ms var(--ks-ease) forwards;
}
@keyframes ks-scene-detail-pop {
  from { transform: scale(0.98); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}
@keyframes ks-scene-detail-pop-out {
  from { transform: scale(1);    opacity: 1; }
  to   { transform: scale(0.98); opacity: 0; }
}

/* ── inline 变体（2026-06）：铺满内容区右侧的整页编辑，无 scrim/浮卡/动画 ── */
.ks-scene-detail-scrim.is-inline {
  position: relative;
  inset: auto;
  z-index: auto;
  flex: 1;
  min-width: 0;
  min-height: 0;
  align-items: stretch;
  justify-content: stretch;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  animation: none;
}
.ks-scene-detail.is-inline {
  width: 100%;
  height: 100%;
  max-height: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  animation: none;
}
/*
 * inline「减少视觉重量」调校 —— header 收成一条贴边细栏（去掉粗底边、收紧内边距），
 * body 各功能格 border 减淡、阴影变轻、加 hover 微反馈，整体"感觉轻"。
 * 不动子组件内部，只在 inline 容器作用域下叠样式。
 */
.ks-scene-detail.is-inline > .ks-scene-detail-bar {
  padding: 8px 12px 8px 14px;
  border-bottom: 1px solid var(--ks-border-soft);
  background: transparent;
}
.ks-scene-detail.is-inline .ks-scene-detail-kicker { opacity: 0.85; }
.ks-scene-detail.is-inline > .ks-scene-detail-body {
  padding: 10px;
  gap: 10px;
}
.ks-scene-detail.is-inline .ks-scene-detail-stagerow > .ks-stage,
.ks-scene-detail.is-inline .ks-scene-detail-cell-assets,
.ks-scene-detail.is-inline .ks-scene-detail-cell-timeline {
  border-color: var(--ks-border-soft);
  box-shadow: none;
  transition: border-color 180ms var(--ks-ease), box-shadow 180ms var(--ks-ease);
}
.ks-scene-detail.is-inline .ks-scene-detail-cell-assets:hover,
.ks-scene-detail.is-inline .ks-scene-detail-cell-timeline:hover {
  border-color: var(--ks-border);
  box-shadow: var(--ks-shadow-inset-hi);
}
/* 画面主体留更纯净的呈现：去掉外框，只保留圆角裁切，让"画面是主角" */
.ks-scene-detail.is-inline .ks-scene-detail-stagerow > .ks-stage {
  background: var(--ks-canvas-deep, #000);
  border-color: transparent;
}


.ks-scene-detail-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--ks-border-soft);
  flex-shrink: 0;
}
/* v6.12: 标题块压成一行 —— kicker · 标题 · meta 横排, 顶栏整体变扁 */
.ks-scene-detail-titleblock {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}
.ks-scene-detail-kicker {
  flex: 0 0 auto;
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.26em;
  color: var(--ks-amber);
  text-transform: uppercase;
}
.ks-scene-detail-title {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--ks-font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--ks-text);
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Meta —— 与标题同排, 紧跟其后, 不再单独占一行 */
.ks-scene-detail-meta {
  flex: 0 0 auto;
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--ks-text-dim);
  white-space: nowrap;
}
.ks-scene-detail-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ks-text-dim);
}
/* v3.8.4 · "标为结局"开关 */
.ks-scene-detail-ending {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px 5px 9px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ks-text-dim);
  background: transparent;
  border: 1px solid var(--ks-border);
  border-radius: 999px;
  transition: all var(--ks-dur-fast) var(--ks-ease);
  font-family: var(--ks-font-cn, var(--ks-font-ui));
}
.ks-scene-detail-ending:hover {
  color: rgba(255, 205, 170, 0.96);
  border-color: rgba(255, 123, 61, 0.45);
  background: rgba(255, 123, 61, 0.08);
}
.ks-scene-detail-ending.is-on {
  color: var(--color-text-on-bright-primary);
  border-color: rgba(255, 123, 61, 0.88);
  background: rgba(255, 123, 61, 0.82);
}
.ks-scene-detail-ending.is-on:hover {
  background: rgba(255, 123, 61, 0.95);
}
.ks-scene-detail-close {
  all: unset;
  cursor: pointer;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--ks-text-soft);
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-scene-detail-close:hover,
.ks-scene-detail-close:focus-visible {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
  border-color: var(--ks-border-strong);
  outline: none;
}
.ks-scene-detail-body {
  position: relative;
  flex: 1;
  min-height: 0;
  /*
   * v6.12「画面为王 · dock 归底带」: 竖排 —— 画面吃满上方整幅, 底部一条定高 band
   *   横分 [版本+时间轴 | dock]。dock 高度与时间轴 band 平齐, 不再贴画面右侧抢宽。
   */
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  overflow: hidden;
}
/* 上行: 画面 + 效果栏 横排, 吃满 body 剩余高度 */
.ks-scene-detail-stagerow {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  gap: 10px;
  overflow: hidden;
}
/* 画面主体 —— stagerow 内左侧, 吃满剩余宽高 */
.ks-scene-detail-stagerow > .ks-stage {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-inset-hi);
  overflow: hidden;
}
/* 底部 band —— 定高, 横分 左(版本+时间轴) / 右(dock) */
.ks-scene-detail-band {
  flex: 0 0 auto;
  height: 280px;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: 10px;
  overflow: hidden;
}
/* band 左: 版本 strip(顶) + 时间轴(吃满剩余) 竖排 */
.ks-scene-detail-band-left {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}
/* 素材库成品 cell —— band 左上一条: 顶部入口条 + 成品图廊(内部滚动) */
.ks-scene-detail-cell-assets {
  flex: 0 0 auto;
  min-width: 0;
  max-height: 138px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
  padding: 6px 10px;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-inset-hi);
}
/* 入口条: 左「素材库成品」标签 + 右醒目「打开素材库」按钮 */
.ks-sd-assetsbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ks-sd-assetsbar-label {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ks-text-dim);
}
/* 成品图廊容器 —— 吃满 cell 剩余, 内部 SceneAssetGallery 自滚 */
.ks-sd-assets-strip {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
}
.ks-sd-assets-strip > .ks-asset-gallery {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.ks-scene-detail-assets-btn {
  all: unset;
  cursor: pointer;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 11.5px;
  font-weight: 700;
  color: #15110a;
  background: var(--ks-amber, #d4ff48);
  border-radius: 999px;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--ks-amber, #d4ff48) 35%, transparent);
  transition: transform var(--ks-dur-fast) var(--ks-ease), box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-scene-detail-assets-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--ks-amber, #d4ff48) 50%, transparent);
}
/* 时间轴格 —— 吃满 band 剩余高; Timeline 内部自滚 */
.ks-scene-detail-cell-timeline {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-inset-hi);
  overflow: hidden;
}
.ks-scene-detail-cell-timeline > .ks-timeline {
  flex: 1;
  min-height: 0;
  padding: 0;
}
/* 右: dock —— 与 band 等高(即与时间轴平齐), 固定宽, 内部自滚 */
.ks-scene-detail-dock-col {
  flex: 0 0 300px;
  min-width: 260px;
  max-width: 340px;
  min-height: 0;
  height: 100%;
  display: flex;
  overflow: hidden;
}
.ks-scene-detail-dock-col > .ks-dock {
  width: 100%;
  max-width: none;
  min-width: 0;
  height: 100%;
}
@media (max-width: 1040px) {
  .ks-scene-detail-dock-col {
    flex-basis: 250px;
    min-width: 220px;
  }
}
@media (max-width: 960px) {
  .ks-scene-detail {
    width: calc(100% - 16px);
    height: calc(100% - 16px);
    max-height: calc(100% - 16px);
  }
}
`
injectStyleOnce('scene-detail-drawer', css)
