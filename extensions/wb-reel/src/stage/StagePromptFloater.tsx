import { useScenarioStore } from '../scenario/scenarioStore'
import { useShellStore } from '../shell/shellStore'
import { PromptTabs } from '../editor/PromptTabs'
import { ScenarioAssetLibrary } from '../editor/ScenarioAssetLibrary'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * StagePromptFloater —— Stage Tab 右侧的 Prompt 编辑面板。
 *
 * 两种形态（2026-04-30 布局重排后新增 panel 形态）：
 *
 *  variant="floater"（默认，兼容老 Stage Tab）——
 *    · 绝对定位浮层，右上角锚点
 *    · 默认闭合 → 圆药丸按钮；点击展开成玻璃卡片
 *    · 状态走 shellStore.promptFloaterOpen
 *
 *  variant="panel"（SceneDetailDrawer 用）——
 *    · 常驻面板，父容器 grid 里的一格
 *    · 不带开合 toggle（永远展开）
 *    · 与 Timeline/Dock 同属"画面一家子"，视觉上不再浮在画面上
 */
export function StagePromptFloater({
  variant = 'floater',
}: { variant?: 'floater' | 'panel' } = {}) {
  const scene = useScenarioStore((s) => s.scenario.scenes[s.selectedSceneId])
  const open = useShellStore((s) => s.promptFloaterOpen)
  const setOpen = useShellStore((s) => s.setPromptFloaterOpen)

  if (!scene) return null

  if (variant === 'panel') {
    return (
      <aside className="ks-prompt-panel" aria-label={`资产生成 · ${scene.id}`}>
        <header className="ks-prompt-panel-head">
          <span className="ks-mono ks-prompt-panel-title">
            资产生成 · {scene.id}
          </span>
        </header>
        {/*
         * v3.9.8 · 修复"素材库位置不固定"——
         *   旧版本 body 是单一 overflow:auto 容器，里面 PromptTabs + AssetLibrary
         *   垂直拼接。当 PromptTabs 的内容（prompt 文本、生成历史）变长时，
         *   整个 body 一起滚动，素材库会随之飘移，作者反馈"跟上方耦合"。
         *
         *   新版：body 拆成两段独立滚动区，素材库锚定在下半部分固定高度。
         *     · 上半 prompt-scroll：PromptTabs，自己 overflow-y，吃剩余高度
         *     · 下半 assets-dock：ScenarioAssetLibrary，固定 flex-basis 360px
         *       + 自己 overflow-y，位置不再随上方变化
         */}
        <div className="ks-prompt-panel-body ks-prompt-panel-body--split">
          <div className="ks-prompt-panel-prompt-scroll">
            <PromptTabs scene={scene} />
          </div>
          <div className="ks-prompt-panel-assets-dock">
            <ScenarioAssetLibrary />
          </div>
        </div>
      </aside>
    )
  }

  return (
    <div className={`ks-stage-floater ${open ? 'is-open' : 'is-closed'}`}>
      {open && (
        <>
          <header className="ks-stage-floater-head">
            <span className="ks-mono ks-stage-floater-title">
              PROMPT · {scene.id}
            </span>
            <button
              type="button"
              className="ks-stage-floater-toggle"
              onClick={() => setOpen(false)}
              aria-label="收起 Prompt 浮层"
              title="收起 (→)"
            >
              <span aria-hidden>›</span>
            </button>
          </header>
          <div className="ks-stage-floater-body ks-prompt-panel-body--split">
            <div className="ks-prompt-panel-prompt-scroll">
              <PromptTabs scene={scene} />
            </div>
            <div className="ks-prompt-panel-assets-dock">
              <ScenarioAssetLibrary />
            </div>
          </div>
        </>
      )}
      {!open && (
        <button
          type="button"
          className="ks-stage-floater-toggle ks-stage-floater-toggle--open"
          onClick={() => setOpen(true)}
          aria-label="展开 Prompt 浮层"
          title="Prompt 编辑 (‹)"
        >
          <span aria-hidden>‹</span>
        </button>
      )}
    </div>
  )
}

const css = `
.ks-stage-floater {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  transition: top 280ms var(--ks-ease),
              right 280ms var(--ks-ease),
              width 280ms var(--ks-ease),
              height 280ms var(--ks-ease),
              background 280ms var(--ks-ease),
              border-color 280ms var(--ks-ease),
              box-shadow 280ms var(--ks-ease);
  overflow: hidden;
}

/* 展开态 —— 面板 · 右上角锚 · 内含 header + tabs body */
.ks-stage-floater.is-open {
  top: 72px;
  right: 20px;
  width: 400px;
  max-height: calc(100% - 40px);
  background: var(--ks-surface-glass);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  box-shadow: var(--ks-shadow-lift), var(--ks-shadow-inset-hi);
}

/* 闭合态 —— 退化为一枚圆药丸按钮，定位上与展开态里的 toggle 几何中心重合
 *   floater(is-open) top=72 right=20 + header padding 10/14 + toggle 26×26
 *   → toggle 中心 (right:14+13=27, top:10+13=23) 距 floater 右上角
 *   闭合态 floater 自身 = 26×26，top=72+10=82, right=20+14=34
 *   这样"原地旋转方向"—— 按钮不位移，只换 glyph */
.ks-stage-floater.is-closed {
  top: 82px;
  right: 34px;
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  box-shadow: none;
  overflow: visible;
}

.ks-stage-floater-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ks-border-soft);
  flex-shrink: 0;
}
.ks-stage-floater-title {
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.22em;
  color: var(--ks-amber);
  text-transform: uppercase;
  font-weight: 600;
}

/* 两态共用的同款圆药丸 —— 唯一区别是 glyph 方向 */
.ks-stage-floater-toggle {
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  color: var(--ks-text-soft);
  border-radius: var(--ks-radius-pill);
  width: 26px;
  height: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-stage-floater-toggle > * {
  display: inline-block;
  /* "›" / "‹" 的 glyph 重心偏下 1px —— 抬回几何中线 */
  transform: translateY(-1px);
}
.ks-stage-floater-toggle:hover {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
  border-color: var(--ks-border-strong);
}
/* 闭合态按钮复用 toggle 样式 —— 只是 glyph 不同（‹ 而非 ›） */
.ks-stage-floater-toggle--open {
  box-shadow: var(--ks-shadow-soft);
}

.ks-stage-floater-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}
/*
 * v3.9.8 · panel/floater 共用的"上滚下固"两段布局
 *
 *   body 自身改成 flex 列，外层不再滚动；上半 prompt-scroll 吃剩余高度并自己
 *   滚，下半 assets-dock 固定 flex-basis 360px，把素材库**锚定**在面板底部。
 *
 *   关键点：
 *     - body--split 的 overflow:hidden + display:flex 取代了原来的 overflow:auto
 *       注意 .ks-stage-floater-body / .ks-prompt-panel-body 默认是 overflow-y:auto，
 *       这里靠 modifier class 选择更高优先级覆盖（同一规则集，靠声明顺序）
 *     - prompt-scroll 必须给 min-height:0，否则 flex item 默认 min-height:auto
 *       会让内容把容器顶大，外层依然撑不住
 *     - assets-dock 的高度按用户体验定 360px：
 *         · 太小（<280）则 byshot 视图里 1 个 shot 就要滚
 *         · 太大（>400）则 PromptTabs 太挤
 *         · 360 正好放下 2 行 thumb（≈ 2 * 90 + header + scope + kind）
 */
.ks-stage-floater-body.ks-prompt-panel-body--split,
.ks-prompt-panel-body.ks-prompt-panel-body--split {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 0;
}
.ks-prompt-panel-prompt-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}
.ks-prompt-panel-assets-dock {
  flex: 0 0 360px;
  min-height: 0;
  overflow-y: auto;
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid var(--ks-border-soft);
}
/*
 * 旧规则保留，给非 split 的 floater 形态（理论上现在没人用了，但留一手保护）
 * 走老路径时素材库与上方留 16px 气口。
 */
.ks-stage-floater-body:not(.ks-prompt-panel-body--split) > .ks-asset-lib,
.ks-prompt-panel-body:not(.ks-prompt-panel-body--split) > .ks-asset-lib {
  margin-top: 16px;
}

/* ── panel 形态（SceneDetailDrawer 内常驻 Prompt 栏）──────────── */
.ks-prompt-panel {
  display: flex;
  flex-direction: column;
  min-width: 260px;
  /* v3.9.7：从 360px 放开到 520 —— drawer 现在给右列 340-440，panel 会被
     .ks-scene-detail-cell-prompt > .ks-prompt-panel { max-width: none }
     放开继承容器宽度；floater 形态也别被硬卡住。 */
  max-width: 520px;
  height: 100%;
  background: var(--ks-surface-glass);
  backdrop-filter: var(--ks-glass-blur);
  -webkit-backdrop-filter: var(--ks-glass-blur);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  box-shadow: var(--ks-shadow-soft), var(--ks-shadow-inset-hi);
  overflow: hidden;
}
.ks-prompt-panel-head {
  padding: 10px 14px;
  border-bottom: 1px solid var(--ks-border-soft);
  flex-shrink: 0;
}
.ks-prompt-panel-title {
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.22em;
  color: var(--ks-amber);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-prompt-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
`
injectStyleOnce('stage-floater', css)
